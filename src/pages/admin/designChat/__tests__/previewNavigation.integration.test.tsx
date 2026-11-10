import { act, cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { DesignChatProvider, useDesignChat, NAV_FALLBACK_MS } from "../DesignChatContext";

vi.mock("@/lib/authGate", () => ({ hasManagerUser: async () => true }));
vi.mock("../helper", async (importOriginal) => ({ ...(await importOriginal<typeof import("../helper")>()), EMBED_FN: "https://service.example/embed", SUPABASE_KEY: "" }));
vi.mock("../useHelperState", () => ({ useHelperState: () => ({ state: null, offline: true, refreshSoon: vi.fn() }) }));
vi.mock("../useWaitProgress", () => ({ useWaitProgress: () => null }));
vi.mock("../usePreviewNotifications", () => ({ usePreviewNotifications: vi.fn() }));
vi.mock("../usePreviewPage", () => ({ usePreviewPage: () => ({ page: null, loading: false, registrable: null }) }));
vi.mock("../useDrawing", () => ({ useDrawing: () => ({}) }));
vi.mock("../useChatReferences", () => ({ useChatReferences: () => ({}) }));
vi.mock("../useChatDraft", () => ({ useChatDraft: () => ({}) }));
vi.mock("../contentSync", () => ({ observeContentSyncState: vi.fn() }));
vi.mock("../../manifestPageSync", () => ({ syncManifestPages: vi.fn() }));
vi.mock("../../siteManifest", () => ({ MANIFEST_CHANGED: "manifest", setManifestBase: vi.fn(), resetSiteManifestCache: vi.fn(), isSafePublicFrameUrl: (url: string) => url.startsWith("https://") }));
vi.mock("../ManifestReceiverFrame", () => ({ default: () => null }));
const ORIGIN = "https://public.example";
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter><DesignChatProvider>{children}</DesignChatProvider></MemoryRouter>;
afterEach(() => { cleanup(); document.querySelectorAll("iframe").forEach(f => f.remove()); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("real preview hooks and tokenised frame protocol", () => {
  it.each([true, false])("nested ready frame retains Back/Forward; replies=%s", async (reply) => {
    vi.useFakeTimers(); vi.stubEnv("VITE_PUBLIC_SITE_URL", ORIGIN);
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embed_url: `${ORIGIN}/?__lovable_token=fixture`, expires_at: "2099-01-01" }) });
    vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(useDesignChat, { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(hook.result.current.preview.frames).toHaveLength(1);
    const frame = document.createElement("iframe"); frame.src = hook.result.current.preview.frames[0].url; frame.dataset.sitePreview = "true"; frame.dataset.previewShown = "true"; document.body.appendChild(frame);
    const win = frame.contentWindow; if (!win) throw new Error("Missing preview window");
    const post = vi.spyOn(win, "postMessage");
    const report = (data: object) => act(() => window.dispatchEvent(new MessageEvent("message", { source: win, origin: ORIGIN, data })));
    act(() => hook.result.current.preview.finish(1));
    report({ type: "preview-ready" });
    for (const path of ["/", "/brands", "/locations"]) report({ source: "nova-site", type: "location", path, search: "?__lovable_token=fixture" });
    act(() => hook.result.current.previewNav?.back());
    expect(hook.result.current.previewDestination).toBe("/brands");
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "preview-navigate", action: "to", path: "/brands" }, ORIGIN);
    expect(hook.result.current.preview.frames).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    if (reply) {
      report({ source: "nova-site", type: "location", path: "/brands" });
      act(() => hook.result.current.previewNav?.forward());
      expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "preview-navigate", action: "to", path: "/locations" }, ORIGIN);
      report({ source: "nova-site", type: "location", path: "/locations" });
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS * 2));
      expect(hook.result.current.preview.frames).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(hook.result.current.previewNav?.canForward).toBe(false);
      expect(document.querySelector("iframe")).toBe(frame);
    } else {
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS - 1));
      expect(hook.result.current.preview.frames).toHaveLength(1);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(hook.result.current.preview.frames).toHaveLength(2);
      expect(hook.result.current.preview.shownId).toBe(1);
      expect(hook.result.current.preview.frames[1].url).toContain("/brands?");
      await act(async () => { vi.advanceTimersByTime(NAV_FALLBACK_MS * 2); });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
    hook.unmount();
  });
});