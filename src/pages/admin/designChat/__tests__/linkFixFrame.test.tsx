import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditSelectLink } from "../linkFix";
import { diffInventories, loadNetLinks, netReviewLinks, parseInventory, requestInventory, requestFrameInventory } from "../linkInventory";
import { remoteSelection } from "../../remoteSelection";
import TextIconLinkPanel from "../../TextIconLinkPanel";
import { walk } from "../submitWalkthroughStore";

const post = vi.fn();
const win = { postMessage: post } as unknown as Window;
const attribute = vi.fn(() => "false");
const frame = { src: "https://site.example/", contentWindow: win, getAttribute: attribute } as unknown as HTMLIFrameElement;
const msg = (data: unknown, origin = "https://site.example", source: unknown = win) => act(() => {
  const e = new MessageEvent("message", { data, origin }); Object.defineProperty(e, "source", { value: source }); window.dispatchEvent(e);
});
beforeEach(() => { vi.clearAllMocks(); attribute.mockReturnValue("false"); walk.reset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const ready = () => {
  attribute.mockReturnValue("true");
  msg({ source: "nova-site", type: "edit-ready" });
  act(() => { vi.advanceTimersByTime(0); });
};

describe("edit-select-link", () => {
  it("inventory requests retry the synchronized frame and trust only its origin/window/path", async () => {
    vi.useFakeTimers();
    const promise = requestFrameInventory(frame, "https://site.example/", 3000);
    const inventory = { source: "nova-site", type: "link-inventory", v: 1, path: "/", links: [{ key: "0.5.0.0", scope: "page", href: "/inspiration-gallery" }] };
    msg(inventory, "https://evil.example");
    msg(inventory, "https://site.example", window);
    msg({ ...inventory, path: "/other" });
    vi.advanceTimersByTime(500);
    expect(post).toHaveBeenCalledTimes(2);
    msg(inventory);
    expect((await promise)?.links[0].key).toBe("0.5.0.0");
    vi.advanceTimersByTime(5000);
    expect(post).toHaveBeenCalledTimes(2);
  });
  it("waits for editor readiness and ignores wrong origin, window or href", () => {
    vi.useFakeTimers();
    const h = renderHook(() => useEditSelectLink("/contact", () => frame));
    act(() => { vi.advanceTimersByTime(7000); });
    expect(post).not.toHaveBeenCalled();
    msg({ source: "nova-site", type: "edit-ready" });
    act(() => { vi.advanceTimersByTime(0); });
    expect(post).not.toHaveBeenCalled(); // edit-init gate is still closed
    ready();
    expect(post).toHaveBeenCalledWith({ source: "nova-manager", type: "edit-select-link", href: "/contact" }, "https://site.example");
    msg({ source: "nova-site", type: "edit-select-link-result", href: "/contact", found: true }, "https://evil.example");
    msg({ source: "nova-site", type: "edit-select-link-result", href: "/contact", found: true }, "https://site.example", {});
    msg({ source: "nova-site", type: "edit-select-link-result", href: "/other", found: true });
    expect(h.result.current.state).toBe("pending");
    msg({ source: "nova-site", type: "edit-select-link-result", href: "/contact", found: false, count: 0 });
    expect(h.result.current.state).toBe("pending");
    msg({ source: "nova-site", type: "edit-select-link-result", href: "/contact", found: true, count: 1 });
    expect(h.result.current).toEqual({ state: "found", count: 1 });
  });
  it("retries every 500 ms after false replies until a later true reply, retaining the match count", () => {
    vi.useFakeTimers();
    const h = renderHook(() => useEditSelectLink("/contact", () => frame));
    post.mockImplementation(() => msg({ source: "nova-site", type: "edit-select-link-result", href: "/contact", found: post.mock.calls.length >= 4, count: post.mock.calls.length >= 4 ? 3 : 0 }));
    ready();
    expect(h.result.current.state).toBe("pending");
    act(() => { vi.advanceTimersByTime(499); });
    expect(post).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(post).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(h.result.current).toEqual({ state: "found", count: 3 });
    expect(post).toHaveBeenCalledTimes(4);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(post).toHaveBeenCalledTimes(4);
    expect(h.result.current.state).toBe("found");
    post.mockReset();
  });
  it("only reports missing after six seconds, stops retries, and accepts late success", () => {
    vi.useFakeTimers();
    const h = renderHook(() => useEditSelectLink("/contact", () => frame));
    ready();
    msg({ source: "nova-site", type: "edit-select-link-result", href: "/contact", found: false, count: 0 });
    act(() => { vi.advanceTimersByTime(5999); });
    expect(h.result.current.state).toBe("pending");
    expect(post).toHaveBeenCalledTimes(12);
    act(() => { vi.advanceTimersByTime(1); });
    expect(h.result.current.state).toBe("missing");
    const sends = post.mock.calls.length;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(post).toHaveBeenCalledTimes(sends);
    msg({ source: "nova-site", type: "edit-select-link-result", href: "/contact", found: true, count: 3 });
    expect(h.result.current).toEqual({ state: "found", count: 3 });
  });
  it("handles an already-ready editor and cancels retries when change-link mode closes", () => {
    vi.useFakeTimers(); attribute.mockReturnValue("true");
    const h = renderHook(() => useEditSelectLink("/contact", () => frame));
    expect(post).toHaveBeenCalledTimes(1);
    h.unmount();
    act(() => { vi.advanceTimersByTime(7000); });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("selection.link destination", () => {
  it("shows the card's destination and writes the override on the card, without the fallback hint", () => {
    walk.startFix({ key: "/|/contact", fingerprint: "f", path: "/", pageName: "Homepage", address: "/contact", href: "/contact" });
    const sel = remoteSelection({ key: "0.2.1", scope: "page", kind: "text", tag: "span", text: "Book a Consultation", link: { key: "0.2", scope: "page", tag: "a", attrs: { href: "/contact" } } } as any);
    const change = vi.fn();
    render(<TextIconLinkPanel sel={sel} edits={{}} onChange={change} onScopeChange={change} />);
    fireEvent.click(screen.getAllByText("Link")[0]);
    const input = screen.getByLabelText("Link Address") as HTMLInputElement;
    expect(input.value).toBe("/contact");
    expect(document.querySelector("[data-link-fix-hint]")).toBeNull();
    fireEvent.change(input, { target: { value: "/gallery" } }); fireEvent.keyDown(input, { key: "Enter" }); fireEvent.blur(input);
    expect(change).toHaveBeenCalledWith("page", expect.objectContaining({ "link:0.2": JSON.stringify({ href: "/gallery" }) }));
  });
  it("keeps the card explanation only when selection.link is absent", () => {
    walk.startFix({ key: "/|/contact", fingerprint: "f", path: "/", pageName: "Homepage", address: "/contact", href: "/contact" });
    const sel = remoteSelection({ key: "0.2.1", scope: "page", kind: "text", tag: "span", text: "Book a Consultation" } as any);
    render(<TextIconLinkPanel sel={sel} edits={{}} onChange={vi.fn()} />);
    fireEvent.click(screen.getAllByText("Link")[0]);
    expect(document.querySelector("[data-link-fix-hint]")).not.toBeNull();
  });
});

const inv = (path: string, links: [string, string][]) => ({ path, links: links.map(([key, href]) => ({ key, scope: "page", href, label: null })) });
describe("link inventory", () => {
  it("validates and caps inventories", () => {
    expect(parseInventory({ source: "nova-site", type: "link-inventory", v: 2, path: "/", links: [] })).toBeNull();
    const many = Array.from({ length: 600 }, (_, i) => ({ key: String(i), scope: "page", href: "/x" + i }));
    expect(parseInventory({ source: "nova-site", type: "link-inventory", v: 1, path: "/", links: many })!.links).toHaveLength(500);
  });
  it("lists new or changed destinations; links equal to live drop off", () => {
    const d = diffInventories(inv("/", [["0.1", "/contact"], ["0.2", "/gallery"], ["0.3", "/new"]]), inv("/", [["0.1", "/contact"], ["0.2", "/contact"]]));
    expect(d.map(l => l.href)).toEqual(["/gallery", "/new"]);
    const base = { groups: [{ page: { name: "Homepage", path: "/" }, label: "Homepage", links: [{ key: "/|/contact", href: "/contact", kind: "internal" as const, label: null, requestIds: ["r"], status: null }] }], unread: 0, partial: false, truncated: false };
    const out = netReviewLinks(base, { "/": d }, []);
    expect(out.groups[0].links.map(l => l.href)).toEqual(["/gallery", "/new"]);
    expect(netReviewLinks(base, { "/": [] }, []).groups).toHaveLength(0);
    expect(netReviewLinks(base, {}, [])).toEqual(base);
  });
  it("falls back when the frame doesn't answer, and compares draft with live when it does", async () => {
    const silent = vi.fn(async () => null);
    expect(await loadNetLinks(["/", "/b"], "https://live.example/", silent)).toEqual({});
    expect(silent).toHaveBeenCalledTimes(2); // only the first page is probed
    const answering = vi.fn(async (url: string) => url.startsWith("https://live.example") ? inv("/", [["0.1", "/contact"]]) : inv("/", [["0.1", "/gallery"]]));
    const out = await loadNetLinks(["/"], "https://live.example/", answering);
    expect(out["/"].map(l => l.href)).toEqual(["/gallery"]);
    expect(await loadNetLinks(["/"], null, answering)).toEqual({});
  });
  it("requestInventory resolves from its own frame and times out to null", async () => {
    vi.useFakeTimers();
    const p = requestInventory("https://site.example/a", 3000);
    const f = document.querySelector<HTMLIFrameElement>("iframe[title='Link Inventory']")!;
    const e = new MessageEvent("message", { data: { source: "nova-site", type: "link-inventory", v: 1, path: "/a", links: [{ key: "0", scope: "page", href: "/x" }] }, origin: "https://site.example" });
    Object.defineProperty(e, "source", { value: f.contentWindow }); window.dispatchEvent(e);
    expect((await p)?.links[0].href).toBe("/x");
    expect(document.querySelector("iframe[title='Link Inventory']")).toBeNull();
    const q = requestInventory("https://site.example/b", 3000);
    vi.advanceTimersByTime(3100);
    expect(await q).toBeNull();
    vi.useRealTimers();
  });
});
