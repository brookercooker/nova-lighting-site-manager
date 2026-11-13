import { afterEach, expect, it, vi } from "vitest";
import { loadNetLinks, requestInventory, INVENTORY_LOAD_TIMEOUT_MS } from "../linkInventory";

afterEach(() => { vi.useRealTimers(); document.querySelectorAll('iframe[title="Link Inventory"]').forEach(frame => frame.remove()); });
const inventory = (path: string, count: number) => ({ path, complete: true, links: Array.from({ length: count }, (_, i) => ({ key: String(i), scope: "page", href: `/target-${i}`, publishedHref: null, label: null })) });
const reply = (frame: HTMLIFrameElement, path: string, complete = true) => {
  const event = new MessageEvent("message", { origin: "https://site.example", data: { source: "nova-site", type: "link-inventory", v: 1, ...inventory(path, 4), complete } });
  Object.defineProperty(event, "source", { value: frame.contentWindow });
  window.dispatchEvent(event);
};

it("waits for a slow hidden document then repeats requests until its complete page reply", async () => {
  vi.useFakeTimers();
  const pending = requestInventory("https://site.example/", 3000);
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Link Inventory"]');
  if (!frame?.contentWindow) throw new Error("no inventory frame");
  const post = vi.spyOn(frame.contentWindow, "postMessage");
  let finished = false; void pending.then(() => { finished = true; });
  await vi.advanceTimersByTimeAsync(4000);
  expect(finished).toBe(false);
  frame.dispatchEvent(new Event("load"));
  reply(frame, "/", false);
  reply(frame, "/wrong");
  await vi.advanceTimersByTimeAsync(1000);
  expect(finished).toBe(false);
  expect(post).toHaveBeenCalledTimes(3);
  reply(frame, "/");
  expect((await pending)?.links).toHaveLength(4);
  await vi.advanceTimersByTimeAsync(4000);
  expect(post).toHaveBeenCalledTimes(3);
  expect(document.querySelector('iframe[title="Link Inventory"]')).toBeNull();
});

it("bounds genuinely unresponsive hidden documents", async () => {
  vi.useFakeTimers();
  const pending = requestInventory("https://site.example/", 3000);
  await vi.advanceTimersByTimeAsync(INVENTORY_LOAD_TIMEOUT_MS);
  expect(await pending).toBeNull();
});

it.each([false, true])("collects Homepage 4 and Pricing 3 serially, viewed=%s, retrying the failed page only once", async viewed => {
  let active = 0; let maxActive = 0;
  const attempts = new Map<string, number>();
  const request = vi.fn(async (url: string) => {
    active++; maxActive = Math.max(active, maxActive);
    await Promise.resolve();
    const path = new URL(url).pathname;
    const attempt = (attempts.get(path) ?? 0) + 1; attempts.set(path, attempt);
    active--;
    if (path === "/draft/pricing" && attempt === 1) return null;
    return inventory(path, path === "/" ? 4 : 3);
  });
  const frame = viewed ? document.createElement("iframe") : null;
  if (frame) frame.src = "https://unrelated.example/";
  const result = await loadNetLinks(["/", "/draft/pricing"], null, request, frame, "https://id-preview--aeb60cc1-b08d-4938-9d83-88c44335e167.lovable.app/?__lovable_token=test");
  expect(maxActive).toBe(1);
  expect(result["/"]).toHaveLength(4);
  expect(result["/draft/pricing"]).toHaveLength(3);
  expect(attempts.get("/")).toBe(1);
  expect(attempts.get("/draft/pricing")).toBe(2);
  expect(request.mock.calls.every(([url]) => new URL(url).searchParams.get("__lovable_token") === "test")).toBe(true);
});

it("only leaves a page missing after both draft attempts fail", async () => {
  const request = vi.fn(async () => null);
  expect(await loadNetLinks(["/"], null, request)).toEqual({});
  expect(request).toHaveBeenCalledTimes(2);
});