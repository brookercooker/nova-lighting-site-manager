import { act, cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignChatProvider, useDesignChat, NAV_FALLBACK_MS, NAV_SETTLE_MS } from "../DesignChatContext";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), navigate: vi.fn(() => false), ready: vi.fn(() => false) }));
vi.mock("../usePreview", () => ({ usePreview: mocks.preview }));
vi.mock("../useHelperState", () => ({ useHelperState: () => ({ state: { busy: true, job: { status: "working", startedAt: 1000 }, history: [] }, offline: false, refreshSoon: vi.fn() }) }));
vi.mock("../useWaitProgress", () => ({ useWaitProgress: () => null }));
vi.mock("../usePreviewNotifications", () => ({ usePreviewNotifications: vi.fn() }));
vi.mock("../usePreviewPage", () => ({ usePreviewPage: () => ({ page: null, loading: false, registrable: null }) }));
vi.mock("../useDrawing", () => ({ useDrawing: () => ({}) }));
vi.mock("../useChatReferences", () => ({ useChatReferences: () => ({}) }));
vi.mock("../useChatDraft", () => ({ useChatDraft: () => ({}) }));
vi.mock("../contentSync", () => ({ observeContentSyncState: vi.fn() }));
vi.mock("../../manifestPageSync", () => ({ syncManifestPages: vi.fn() }));
vi.mock("../ManifestReceiverFrame", () => ({ default: () => null }));
vi.mock("../previewNavigate", () => ({ notePreviewReady: mocks.ready, postPreviewNavigate: mocks.navigate }));

const key = "nova:design-chat:working-page";
const draft = { id: "draft-id", name: "Draft", path: "/draft" };
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter><DesignChatProvider>{children}</DesignChatProvider></MemoryRouter>;
beforeEach(() => {
  sessionStorage.clear();
  mocks.preview.mockReset();
  mocks.preview.mockReturnValue({ completedAt: 0, lastReloadAt: { current: 0 }, rememberPath: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe("preview Back confirmation", () => {
  it("waits for trusted readiness after an unavailable Back instead of immediately reloading", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(false);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/?__lovable_token=fixture"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    const report = (data: object) => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://site.example", data })));
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report({ source: "nova-site", type: "location", path: "/" }); report({ source: "nova-site", type: "location", path: "/brands" });
      act(() => hook.result.current.previewNav?.back());
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual([null, 0]);
      mocks.ready.mockReturnValueOnce(true); mocks.navigate.mockReturnValue(true);
      report({ type: "preview-ready" });
      expect(mocks.navigate).toHaveBeenLastCalledWith({ action: "to", path: "/" });
      report({ source: "nova-site", type: "location", path: "/" });
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS));
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual([null, 0]);
      hook.unmount();
    } finally { frame.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
  it("keeps the Back label and history after a matched report followed by a conflicting report, then Forward returns", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/brands"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    const report = (path: string) => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report("/"); report("/brands"); report("/showrooms");
      const label = () => hook.result.current.previewDestination ?? hook.result.current.previewLocation?.path;
      act(() => hook.result.current.previewNav?.back());
      expect(label()).toBe("/brands");
      act(() => vi.advanceTimersByTime(1300));
      report("/brands");
      act(() => vi.advanceTimersByTime(25)); report("/coming-soon");
      expect(label()).toBe("/brands");
      expect(hook.result.current.previewLocation?.path).toBe("/brands");
      expect(hook.result.current.previewNav?.canForward).toBe(true);
      const remembered = mocks.preview.mock.results.at(-1)?.value.rememberPath as ReturnType<typeof vi.fn>;
      expect(remembered).not.toHaveBeenCalledWith("/coming-soon");
      act(() => hook.result.current.previewNav?.forward());
      expect(label()).toBe("/showrooms");
      report("/showrooms"); report("/coming-soon");
      expect(label()).toBe("/showrooms");
      expect(hook.result.current.previewNav?.canForward).toBe(false);
      act(() => { hook.result.current.previewNav?.back(); hook.result.current.previewNav?.back(); }); report("/");
      expect(label()).toBe("/");
      expect(hook.result.current.previewNav?.canBack).toBe(false);
      hook.unmount();
    } finally { frame.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
  it("accepts in-frame navigation without a Manager request and after the non-extending settling window", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    const report = (path: string) => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report("/"); report("/coming-soon");
      expect(hook.result.current.previewLocation?.path).toBe("/coming-soon");
      act(() => hook.result.current.showPreviewPath("/brands")); report("/brands");
      act(() => vi.advanceTimersByTime(NAV_SETTLE_MS - 1)); report("/brands"); report("/coming-soon");
      expect(hook.result.current.previewLocation?.path).toBe("/brands");
      act(() => vi.advanceTimersByTime(1)); report("/coming-soon");
      expect(hook.result.current.previewLocation?.path).toBe("/coming-soon");
      act(() => hook.result.current.previewNav?.back());
      expect(hook.result.current.previewDestination).toBe("/brands");
      hook.unmount();
    } finally { frame.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
  it("does not apply an old preview settling guard to a replacement frame or Manual Edit frame", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    const other = document.createElement("iframe"); other.src = "https://site.example/"; other.dataset.siteEditor = "true"; document.body.appendChild(other);
    const report = (f: HTMLIFrameElement, path: string) => act(() => window.dispatchEvent(new MessageEvent("message", { source: f.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report(frame, "/"); act(() => hook.result.current.showPreviewPath("/brands")); report(frame, "/brands");
      act(() => hook.result.current.selectPage({ id: "about", name: "About", path: "/about" })); report(frame, "/about");
      act(() => hook.result.current.startEditing()); report(other, "/team");
      expect(hook.result.current.previewLocation?.path).toBe("/team");
      act(() => hook.result.current.stopEditing()); act(() => hook.result.current.showPreviewPath("/brands")); report(frame, "/brands");
      frame.remove(); other.removeAttribute("data-site-editor"); other.dataset.sitePreview = "true"; report(other, "/showrooms");
      expect(hook.result.current.previewLocation?.path).toBe("/showrooms");
      hook.unmount();
    } finally { frame.remove(); other.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
  it("updates destination and history immediately, delays the cue 150ms, and ignores superseded arrivals", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    const report = (path: string) => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report("/"); report("/about"); report("/team");
      act(() => hook.result.current.previewNav?.back());
      expect(hook.result.current.previewDestination).toBe("/about");
      expect(hook.result.current.previewNav?.canForward).toBe(true);
      expect(hook.result.current.previewNavigating).toBe(false);
      act(() => vi.advanceTimersByTime(149));
      expect(hook.result.current.previewNavigating).toBe(false);
      act(() => vi.advanceTimersByTime(1));
      expect(hook.result.current.previewNavigating).toBe(true);
      act(() => hook.result.current.previewNav?.forward());
      expect(hook.result.current.previewDestination).toBe("/team");
      expect(hook.result.current.previewNav?.canForward).toBe(false);
      report("/about");
      expect(hook.result.current.previewDestination).toBe("/team");
      report("/team");
      expect(hook.result.current.previewDestination).toBeNull();
      expect(hook.result.current.previewNavigating).toBe(false);
      act(() => { hook.result.current.previewNav?.back(); hook.result.current.previewNav?.back(); });
      expect(hook.result.current.previewDestination).toBe("/");
      expect(hook.result.current.previewNav?.canBack).toBe(false);
      report("/");
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS + 1));
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual([null, 0]);
      hook.unmount();
    } finally { frame.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
  it.each([
    ["/home/", "", "/", ""],
    ["/about/", "?b=2&a=1", "/about", "?a=1&b=2"],
  ])("resolves equivalent %s in place with no delayed reload", (path, search, arrival, arrivalSearch) => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe");
    frame.src = "https://site.example/"; frame.dataset.sitePreview = "true";
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    const report = (path: string, search = "") => act(() => {
      window.dispatchEvent(new MessageEvent("message", { source: win, origin: "https://site.example", data: { source: "nova-site", type: "location", path, search } }));
    });
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report(path, search); report("/team");
      act(() => hook.result.current.previewNav?.back());
      expect(mocks.navigate).toHaveBeenLastCalledWith({ action: "to", path: path + search });
      report(arrival, arrivalSearch);
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS + 100));
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual([null, 0]);
      expect(hook.result.current.previewNav?.canForward).toBe(true);
      expect(frame.src).toBe("https://site.example/");
      hook.unmount();
    } finally { frame.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
  it("retains one three-second fallback when the frame never confirms", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      for (const path of ["/", "/team"]) act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
      act(() => hook.result.current.previewNav?.back());
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS - 1));
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual([null, 0]);
      act(() => vi.advanceTimersByTime(1));
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual(["/", 1]);
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS));
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual(["/", 1]);
      hook.unmount();
    } finally { frame.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
  it("Forward also falls back exactly once when the frame never answers", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    const report = (path: string) => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report("/"); report("/team");
      act(() => hook.result.current.previewNav?.back());
      report("/");
      act(() => hook.result.current.previewNav?.forward());
      expect(mocks.navigate).toHaveBeenLastCalledWith({ action: "to", path: "/team" });
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS));
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual(["/team", 1]);
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS * 2));
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual(["/team", 1]);
      hook.unmount();
    } finally { frame.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
  it("Back/Forward after the frame is replaced by a fresh copy go straight to the addresses, with no reload", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const make = () => { const f = document.createElement("iframe"); f.src = "https://site.example/"; f.dataset.sitePreview = "true"; document.body.appendChild(f); return f; };
    let frame = make();
    const report = (path: string, search = "") => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path, search } })));
    const toCalls = (path: string) => (mocks.navigate.mock.calls as unknown as [{ action: string; path?: string }][]).filter(([nav]) => nav.action === "to" && nav.path === path).length;
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report("/", "?__lovable_token=secret"); report("/about"); report("/team");
      // loadPreview made a brand-new frame (no browser history) and dropped the old one; it opens on the remembered page.
      frame.remove(); frame = make(); report("/team");
      mocks.navigate.mockClear();
      act(() => hook.result.current.previewNav?.back());
      expect(mocks.navigate).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenLastCalledWith({ action: "to", path: "/about" });
      report("/about");
      act(() => hook.result.current.previewNav?.back());
      expect(mocks.navigate).toHaveBeenLastCalledWith({ action: "to", path: "/" });
      report("/", "?__lovable_token=secret");
      act(() => hook.result.current.previewNav?.forward());
      expect(mocks.navigate).toHaveBeenLastCalledWith({ action: "to", path: "/about" });
      report("/about");
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS * 3));
      expect(toCalls("/about")).toBe(2); // once for Back, once for Forward: never re-sent
      expect(mocks.preview.mock.calls.at(-1)?.slice(1)).toEqual([null, 0]); // no fallback reload
      expect(hook.result.current.previewNav?.canBack).toBe(true);
      expect(hook.result.current.previewNav?.canForward).toBe(true);
      act(() => hook.result.current.previewNav?.forward());
      expect(mocks.navigate).toHaveBeenLastCalledWith({ action: "to", path: "/team" });
      report("/team");
      expect(hook.result.current.previewNav?.canForward).toBe(false);
      const remembered = mocks.preview.mock.results.at(-1)?.value.rememberPath as ReturnType<typeof vi.fn>;
      expect(JSON.stringify(remembered.mock.calls)).not.toContain("__lovable");
      expect(JSON.stringify(mocks.navigate.mock.calls)).not.toContain("__lovable");
      hook.unmount();
    } finally { frame.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
});

describe("picked page follows the preview", () => {
  const setup = () => {
    mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    const report = (path: string, f: HTMLIFrameElement = frame) => act(() => window.dispatchEvent(new MessageEvent("message", { source: f.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
    return { frame, report };
  };
  const contact = { id: "contact-id", name: "Contact", path: "/contact" };
  afterEach(() => { document.querySelectorAll("iframe").forEach((f) => f.remove()); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); });

  it("clears the picked page after a settled report of a different path while not editing", () => {
    vi.useFakeTimers(); const { report } = setup();
    const hook = renderHook(useDesignChat, { wrapper });
    act(() => hook.result.current.selectPage(contact)); report("/contact");
    act(() => vi.advanceTimersByTime(NAV_SETTLE_MS));
    report("/experiment");
    expect(hook.result.current.workingPage).toBeNull();
    expect(hook.result.current.previewLocation?.path).toBe("/experiment");
  });
  it("keeps the picked page when the reported path matches", () => {
    vi.useFakeTimers(); const { report } = setup();
    const hook = renderHook(useDesignChat, { wrapper });
    act(() => hook.result.current.selectPage(contact)); report("/contact");
    act(() => vi.advanceTimersByTime(NAV_SETTLE_MS));
    report("/contact/"); report("/contact");
    expect(hook.result.current.workingPage).toEqual(contact);
  });
  it("keeps the picked page while editing", () => {
    vi.useFakeTimers(); const { report } = setup();
    const editor = document.createElement("iframe"); editor.src = "https://site.example/"; editor.dataset.siteEditor = "true"; document.body.appendChild(editor);
    const hook = renderHook(useDesignChat, { wrapper });
    act(() => hook.result.current.selectPage(contact)); report("/contact");
    act(() => hook.result.current.startEditing());
    act(() => vi.advanceTimersByTime(NAV_SETTLE_MS));
    report("/experiment"); report("/team", editor);
    expect(hook.result.current.workingPage).toEqual(contact);
    expect(hook.result.current.editing).toBe(true);
  });
  it("does not clear a fresh pick when the earlier page reports before the new one arrives", () => {
    vi.useFakeTimers(); const { report } = setup();
    const hook = renderHook(useDesignChat, { wrapper });
    report("/brands");
    act(() => hook.result.current.selectPage(contact));
    report("/brands");
    expect(hook.result.current.workingPage).toEqual(contact);
    report("/contact");
    expect(hook.result.current.workingPage).toEqual(contact);
    report("/brands"); // late duplicate inside the settling window
    expect(hook.result.current.workingPage).toEqual(contact);
  });
});

describe("picked page and Back/Forward", () => {
  const team = { id: "team-id", name: "Team", path: "/team" };
  const setup = () => {
    mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    return (path: string) => act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
  };
  afterEach(() => { document.querySelectorAll("iframe").forEach((f) => f.remove()); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); });
  const pickTeamThenLocations = (report: (p: string) => void) => {
    const hook = renderHook(useDesignChat, { wrapper });
    act(() => hook.result.current.selectPage(team)); report("/team");
    act(() => vi.advanceTimersByTime(NAV_SETTLE_MS));
    act(() => hook.result.current.selectPage({ name: "Locations", path: "/showrooms" })); report("/showrooms");
    act(() => vi.advanceTimersByTime(NAV_SETTLE_MS));
    return hook;
  };
  it("Back to a different page clears the pick", () => {
    vi.useFakeTimers(); const report = setup();
    const hook = pickTeamThenLocations(report);
    act(() => hook.result.current.previewNav?.back());
    expect(hook.result.current.workingPage).toBeNull();
    expect(hook.result.current.previewDestination).toBe("/team");
  });
  it("Forward to the picked page's own path keeps it", () => {
    vi.useFakeTimers(); const report = setup();
    const hook = pickTeamThenLocations(report);
    act(() => hook.result.current.previewNav?.back()); report("/team");
    act(() => vi.advanceTimersByTime(NAV_SETTLE_MS));
    act(() => hook.result.current.selectPage({ name: "Locations", path: "/showrooms" }));
    report("/showrooms"); act(() => vi.advanceTimersByTime(NAV_SETTLE_MS));
    act(() => hook.result.current.previewNav?.back()); report("/team");
    act(() => vi.advanceTimersByTime(NAV_SETTLE_MS));
    act(() => hook.result.current.selectPage({ name: "Locations", path: "/showrooms" }));
    act(() => hook.result.current.previewNav?.forward());
    expect(hook.result.current.previewDestination).toBe("/showrooms");
    expect(hook.result.current.workingPage).toEqual({ name: "Locations", path: "/showrooms" });
  });
  it("Back while editing is a no-op", () => {
    vi.useFakeTimers(); const report = setup();
    const hook = renderHook(useDesignChat, { wrapper });
    report("/showrooms");
    act(() => hook.result.current.selectPage(team)); report("/team");
    act(() => hook.result.current.startEditing());
    act(() => hook.result.current.previewNav?.back());
    expect(hook.result.current.workingPage).toEqual(team);
    expect(hook.result.current.editing).toBe(true);
  });
});

describe("leaving Manual Edit Mode", () => {
  it("stop editing keeps the preview on the edited path", () => {
    vi.useFakeTimers(); mocks.navigate.mockReturnValue(true);
    const frame = document.createElement("iframe"); frame.src = "https://site.example/"; frame.dataset.sitePreview = "true"; document.body.appendChild(frame);
    const editor = document.createElement("iframe"); editor.src = "https://site.example/contact"; editor.dataset.siteEditor = "true"; document.body.appendChild(editor);
    const report = (f: HTMLIFrameElement, path: string) => act(() => window.dispatchEvent(new MessageEvent("message", { source: f.contentWindow, origin: "https://site.example", data: { source: "nova-site", type: "location", path } })));
    const contact = { id: "contact-id", name: "Contact", path: "/contact" };
    try {
      const hook = renderHook(useDesignChat, { wrapper });
      report(frame, "/");
      act(() => hook.result.current.startEditing());
      act(() => hook.result.current.selectPage(contact));
      act(() => hook.result.current.startEditing());
      report(editor, "/contact"); // the editor arriving must not confirm the Chat preview's navigation
      act(() => hook.result.current.stopEditing());
      report(frame, "/"); // Chat preview still on Home: it is asked again, the pick is kept
      expect(mocks.navigate).toHaveBeenLastCalledWith({ action: "to", path: "/contact" });
      expect(hook.result.current.workingPage).toEqual(contact);
      act(() => vi.advanceTimersByTime(NAV_FALLBACK_MS));
      expect(mocks.preview.mock.calls.at(-1)?.[1]).toBe("/contact");
      report(frame, "/contact");
      expect(hook.result.current.previewLocation?.path).toBe("/contact");
      expect(hook.result.current.workingPage).toEqual(contact);
      hook.unmount();
    } finally { frame.remove(); editor.remove(); mocks.navigate.mockReturnValue(false); vi.useRealTimers(); }
  });
});

describe("picked page reload", () => {
  it("does not restore a stored working page or its preview path on load", () => {
    sessionStorage.setItem(key, JSON.stringify(draft));
    const hook = renderHook(useDesignChat, { wrapper });
    expect(hook.result.current.workingPage).toBeNull();
    expect(mocks.preview.mock.calls.at(-1)?.[1]).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });
  it("a pick lasts only for the session in memory, not across a reload", () => {
    const first = renderHook(useDesignChat, { wrapper });
    act(() => first.result.current.selectPage(draft));
    expect(first.result.current.workingPage).toEqual(draft);
    first.unmount();
    const again = renderHook(useDesignChat, { wrapper });
    expect(again.result.current.workingPage).toBeNull();
  });
  it("still selects and clears pages when tab storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Blocked"); });
    const hook = renderHook(useDesignChat, { wrapper });
    act(() => hook.result.current.selectPage(draft));
    expect(hook.result.current.workingPage).toEqual(draft);
    expect(hook.result.current.previewDestination).toBe("/draft");
    act(() => hook.result.current.clearWorkingPage());
    expect(hook.result.current.workingPage).toBeNull();
  });
});
