import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FramedPageEditor, { type FramedEditorController, type FramedPageEditorProps } from "../FramedPageEditor";
import { editFrameUrl } from "../framedPageProtocol";
import { remoteSelection, remoteExpansion, remoteTextRestore, selectionComputedStyle, selectionLinkOriginal } from "../remoteSelection";
import { originalLink } from "@/lib/inlineEditCore";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const defaults = (): FramedPageEditorProps => ({ base: "https://public.example.com/?embed=fixture", path: "/draft", edits: {}, objectEdits: {}, collapsed: new Set(), selectedKey: null, onChange: vi.fn(), onSelect: vi.fn(), onToggle: vi.fn(), onReorder: vi.fn(), onOpenObject: vi.fn() });
function setup(patch: Partial<FramedPageEditorProps> = {}) {
  const props = { ...defaults(), ...patch };
  const view = render(<FramedPageEditor {...props} />);
  const frame = view.container.querySelector("iframe");
  if (!frame?.contentWindow) throw new Error("Expected public frame");
  const frameWindow = frame.contentWindow;
  Object.defineProperty(frame, "contentWindow", { configurable: true, get: () => frameWindow });
  const send = vi.spyOn(frameWindow, "postMessage").mockImplementation(() => {});
  const receive = (type: string, payload = {}, origin = "https://public.example.com", source: MessageEventSource | null = frame.contentWindow) => act(() => { window.dispatchEvent(new MessageEvent("message", { origin, source, data: { source: "nova-site", type, ...payload } })); });
  return { ...view, props, frame, send, receive };
}
describe("public edit-frame guards", () => {
  it.each([null, undefined, "", "/draft", "http://public.example.com", window.location.origin + "/draft"])("never creates a frame for %s", (base) => {
    expect(editFrameUrl(base, "/draft")).toBeNull();
    const view = render(<FramedPageEditor {...defaults()} base={base ?? null} />);
    expect(view.container.querySelector("iframe")).toBeNull();
  });
  it("never frames from a nested manager", () => {
    vi.stubGlobal("top", {});
    expect(editFrameUrl("https://public.example.com", "/draft")).toBeNull();
    const view = render(<FramedPageEditor {...defaults()} />);
    expect(view.container.querySelector("iframe")).toBeNull();
  });
  it("preserves embed query and uses the exact public origin", () => {
    expect(editFrameUrl("https://public.example.com/?embed=fixture", "/draft")).toBe("https://public.example.com/draft?embed=fixture&nova-edit=1");
  });
  it("does not reload or create another frame after a failing load", () => {
    vi.useFakeTimers();
    const { frame, container } = setup();
    fireEvent.error(frame);
    act(() => vi.advanceTimersByTime(60000));
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")).toBe(frame);
  });
  it("times out visibly and reloads only on explicit Retry", () => {
    vi.useFakeTimers();
    const s = setup();
    act(() => vi.advanceTimersByTime(15000));
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't reach the public page");
    expect(s.container.querySelector("iframe")).toBe(s.frame);
    act(() => vi.advanceTimersByTime(60000));
    expect(s.container.querySelector("iframe")).toBe(s.frame);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(s.container.querySelector("iframe")).not.toBe(s.frame);
    expect(s.container.querySelectorAll("iframe")).toHaveLength(1);
  });
});
describe("edit-frame protocol", () => {
  it.each(["page", "object:fixture"])("retains first reported coded wording for %s text changes", (scope) => {
    const s = setup(); s.receive("edit-ready");
    s.receive("edit-select", { selection: { key: "0", scope, kind: "text", tag: "p", text: "Original code", style: {}, rect: {} } });
    s.receive("edit-select", { selection: { key: "0", scope, kind: "text", tag: "p", text: "Typed once", style: {}, rect: {} } });
    s.receive("edit-change", { scope, next: { "0": "My edit" } });
    expect(s.props.onChange).toHaveBeenLastCalledWith(scope, { "0": "My edit", "orig:0": "Original code" });
  });
  it("restores stale wording with the current baseline through the normal save callback", () => {
    const s = setup({ edits: { "0": "My edit", "orig:0": "Old code" } }); s.receive("edit-ready");
    s.receive("edit-select", { selection: { key: "0", scope: "page", kind: "text", tag: "p", text: "New code", originalText: "New code", style: {}, rect: {} } });
    s.receive("edit-stale", { keys: ["0"], current: { "0": "New code" } }, "https://wrong.example");
    let selected = vi.mocked(s.props.onSelect).mock.lastCall?.[0];
    if (!selected) throw new Error("Expected selection");
    expect(remoteTextRestore(selected.el)).toBeUndefined();
    s.receive("edit-stale", { keys: ["0"], current: { "0": "New code" } });
    selected = vi.mocked(s.props.onSelect).mock.lastCall?.[0];
    if (!selected) throw new Error("Expected stale selection");
    act(() => remoteTextRestore(selected.el)?.restore());
    expect(s.send).toHaveBeenCalledWith({ source: "nova-manager", type: "edit-restore", key: "0", orig: "New code" }, "https://public.example.com");
    expect(s.props.onChange).toHaveBeenLastCalledWith("page", { "0": "My edit", "orig:0": "New code" });
  });
  it("gates expansion on capability and current selection without changing edits", () => {
    const s = setup();
    const selection = { key: "0.1", scope: "page", kind: "text", tag: "button", style: {}, rect: {}, expandable: { path: "0", open: false } };
    s.receive("edit-ready", { capabilities: { expandableContent: true } });
    s.receive("edit-select", { selection }, "https://wrong.example");
    expect(s.props.onSelect).not.toHaveBeenCalled();
    s.receive("edit-select", { selection });
    const selected = vi.mocked(s.props.onSelect).mock.lastCall?.[0];
    if (!selected) throw new Error("Expected selection");
    act(() => remoteExpansion(selected.el)?.setOpen(true));
    expect(s.send).toHaveBeenLastCalledWith({ source: "nova-manager", type: "edit-expand", scope: "page", path: "0", open: true }, "https://public.example.com");
    expect(s.props.onChange).not.toHaveBeenCalled();
    s.receive("edit-select", { selection: null });
    s.send.mockClear();
    act(() => remoteExpansion(selected.el)?.setOpen(false));
    expect(s.send).not.toHaveBeenCalled();
  });
  it("ignores invalid expansion metadata and exposes no action on older frames", () => {
    const s = setup(); s.receive("edit-ready");
    const selection = { key: "0.1", scope: "page", kind: "text", tag: "button", style: {}, rect: {}, expandable: { path: "0", open: false } };
    s.receive("edit-select", { selection: { ...selection, expandable: { path: "body > button", open: false } } });
    expect(s.props.onSelect).not.toHaveBeenCalled();
    s.receive("edit-select", { selection });
    const selected = vi.mocked(s.props.onSelect).mock.lastCall?.[0];
    if (!selected) throw new Error("Expected selection");
    expect(remoteExpansion(selected.el)).toBeUndefined();
  });
  it("routes exact Delete/Backspace messages only for the current image with origin/source guards", () => {
    const onImageDelete = vi.fn(); const s = setup({ onImageDelete }); s.receive("edit-ready");
    s.receive("edit-key", { key: "Delete" }); expect(onImageDelete).not.toHaveBeenCalled();
    s.receive("edit-select", { selection: { key: "0.2", scope: "page", kind: "image", tag: "img", style: {}, rect: {} } });
    s.receive("edit-key", { key: "Delete" }, "https://wrong.example");
    s.receive("edit-key", { key: "Delete" }, "https://public.example.com", window);
    expect(onImageDelete).not.toHaveBeenCalled();
    s.receive("edit-key", { key: "Delete" }); s.receive("edit-key", { key: "Backspace" });
    expect(onImageDelete).toHaveBeenCalledTimes(2);
    s.receive("edit-select", { selection: null }); s.receive("edit-key", { key: "Delete" });
    expect(onImageDelete).toHaveBeenCalledTimes(2);
  });
  it("includes swap snapshots on init and update, including saved copies", () => {
    const object = { status: "Ready", name: "Categories (Homepage)", component_key: "Categories", content: { sections: [] }, inline_edits: { "0": "Original" } };
    const s = setup({ objectSwaps: { "code:home-categories": "copy" }, heldObjects: { copy: object } });
    s.receive("edit-ready");
    expect(s.send).toHaveBeenCalledWith(expect.objectContaining({ type: "edit-init", objectSwaps: { "code:home-categories": { id: "copy", ...object } } }), "https://public.example.com");
    const updated = { ...object, inline_edits: { "0": "Updated" } };
    s.rerender(<FramedPageEditor {...s.props} heldObjects={{ copy: updated }} />);
    expect(s.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "edit-update", objectSwaps: { "code:home-categories": { id: "copy", ...updated } } }), "https://public.example.com");
  });
  it("ignores wrong origins and sources, then initializes and synchronizes", () => {
    const s = setup();
    s.receive("edit-ready", {}, "https://evil.example");
    s.receive("edit-ready", {}, "https://public.example.com", window);
    expect(s.send).not.toHaveBeenCalled();
    s.receive("edit-ready");
    expect(s.send).toHaveBeenCalledWith({ source: "nova-manager", type: "edit-init", edits: {}, objectEdits: {}, collapsed: [], selectedKey: null, objectSwaps: {} }, "https://public.example.com");
    s.rerender(<FramedPageEditor {...s.props} edits={{ "0": "Changed" }} collapsed={new Set(["0"])} selectedKey="page|0" />);
    expect(s.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "edit-update", edits: { "0": "Changed" }, collapsed: ["0"], selectedKey: "page|0" }), "https://public.example.com");
    expect(s.container.querySelector("iframe")).toBe(s.frame);
  });
  it("routes valid scoped changes to the supplied changeScope callback only after ready", () => {
    const s = setup();
    s.receive("edit-change", { scope: "page", next: { "0": "No" } });
    expect(s.props.onChange).not.toHaveBeenCalled();
    s.receive("edit-ready");
    s.receive("edit-change", { scope: "page", next: { "0": "Example Header" } });
    s.receive("edit-change", { scope: "Header", next: { "style:0": '{"font-weight":"700"}' } });
    expect(s.props.onChange).toHaveBeenCalledWith("page", { "0": "Example Header" });
    expect(s.props.onChange).toHaveBeenCalledWith("Header", { "style:0": '{"font-weight":"700"}' });
    s.receive("edit-change", { scope: "page", next: { "link:0": '{"href":"javascript:alert(1)"}' } });
    expect(s.props.onChange).toHaveBeenCalledTimes(2);
  });
  it("adapts selections, reorder, collapse and object entry", () => {
    const s = setup(); s.receive("edit-ready");
    s.receive("edit-select", { selection: { key: "0", scope: "page", kind: "text", tag: "h1", text: "Example Header", rect: { width: 600, height: 48 }, style: { fontSize: "40px" } } });
    expect(s.props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: "0", scope: "page", kind: "text", el: expect.any(HTMLElement) }));
    s.receive("edit-toggle", { key: "0" });
    expect(s.props.onToggle).toHaveBeenCalledWith("0");
    s.receive("edit-open-object", { key: "Categories", section: "0" });
    expect(s.props.onOpenObject).toHaveBeenCalledWith("Categories", "0");
    s.receive("edit-reorder", { from: "0", to: "1", after: true, all: [{ key: "0", parent: "" }, { key: "1", parent: "" }] });
    expect(s.props.onReorder).toHaveBeenCalledWith(expect.objectContaining({ key: "0", parent: "" }), expect.objectContaining({ key: "1", parent: "" }), true, expect.any(Array));
  });
  it("sends edit-exit on discard/exit and once on unmount", () => {
    const apiRef = { current: null as FramedEditorController | null };
    const s = setup({ apiRef }); s.receive("edit-ready");
    act(() => apiRef.current?.exit());
    s.receive("edit-change", { scope: "page", next: { "0": "Late" } });
    expect(s.props.onChange).not.toHaveBeenCalled();
    s.unmount();
    expect(s.send.mock.calls.filter(([message]) => message.type === "edit-exit")).toHaveLength(1);
    expect(s.send).toHaveBeenLastCalledWith({ source: "nova-manager", type: "edit-exit" }, "https://public.example.com");
  });
  it("sends edit-exit when leaving without explicit discard", () => {
    const s = setup(); s.receive("edit-ready"); s.unmount();
    expect(s.send).toHaveBeenLastCalledWith({ source: "nova-manager", type: "edit-exit" }, "https://public.example.com");
  });
  it("reloads exactly once for a held section revision, not inline edits or failing loads", () => {
    vi.useFakeTimers();
    const s = setup({ sectionRevision: 0 }); s.receive("edit-ready");
    s.rerender(<FramedPageEditor {...s.props} sectionRevision={1} />);
    const changed = s.container.querySelector("iframe");
    expect(changed).not.toBe(s.frame);
    expect(s.container.querySelectorAll("iframe")).toHaveLength(1);
    s.rerender(<FramedPageEditor {...s.props} sectionRevision={1} edits={{ "0": "Held text" }} />);
    expect(s.container.querySelector("iframe")).toBe(changed);
    if (!changed) throw new Error("Missing reloaded frame");
    fireEvent.error(changed);
    act(() => vi.advanceTimersByTime(60000));
    expect(s.container.querySelector("iframe")).toBe(changed);
    expect(s.container.querySelectorAll("iframe")).toHaveLength(1);
  });
  it("uses correlated queries for missing computed style and measurements", async () => {
    const s = setup(); s.receive("edit-ready");
    s.receive("edit-select", { selection: { key: "0", scope: "page", kind: "image", tag: "img", attrs: { src: "/test.jpg" } } });
    const messages = s.send.mock.calls.map(([m]) => m).filter((m) => m.type === "edit-query");
    expect(messages.map((m) => m.op)).toEqual(["computed", "measure"]);
    await act(async () => {
      for (const m of messages) s.receive("edit-reply", { id: m.id, ok: true, result: m.op === "computed" ? { objectFit: "contain" } : { width: 800, height: 400 } });
    });
    const selection = vi.mocked(s.props.onSelect).mock.calls.at(-1)?.[0];
    if (!selection) throw new Error("Missing selection");
    expect(selectionComputedStyle(selection.el).objectFit).toBe("contain");
    expect(selection.el.getBoundingClientRect().width).toBe(800);
  });
});
it("builds inert panel-compatible text, link, geometry and computed data from a snapshot", () => {
  const selection = remoteSelection({ key: "0.1", scope: "Header", kind: "text", tag: "span", text: "Example Header", html: "<strong>Example Header</strong>", rect: { width: 400, height: 50 }, attrs: { alt: "Test" }, style: { fontSize: "32px", "border-top-width": "2px" }, link: { key: "0", scope: "Header", attrs: { href: "/contact", target: "_blank" } } });
  expect(selection.el.textContent).toBe("Example Header");
  expect(selection.el.innerHTML).toBe("<strong>Example Header</strong>");
  expect(selection.el.getBoundingClientRect().height).toBe(50);
  expect(selectionComputedStyle(selection.el).fontSize).toBe("32px");
  expect(selectionComputedStyle(selection.el).getPropertyValue("border-top-width")).toBe("2px");
  expect(selection.el.closest("a")).toBe(selection.link?.el);
  if (!selection.link) throw new Error("Missing link");
  expect(originalLink(selection.link.el)).toEqual({ href: "/contact", target: "_blank" });
  expect(selection.el.isConnected).toBe(false);
});
it("resolves a shared object's pre-replay original from the exact editor frame inventory", async () => {
  const s = setup({ objectEdits: { "object:about": { "link:0": '{"href":"/contact"}' } } });
  s.receive("edit-ready");
  s.receive("edit-select", { selection: { key: "0", scope: "object:about", kind: "text", tag: "a", attrs: { href: "/contact" }, style: {}, rect: {} } });
  let selection = vi.mocked(s.props.onSelect).mock.calls.at(-1)?.[0];
  if (!selection?.link) throw new Error("Missing selection");
  expect(selectionLinkOriginal(selection.link.el)).toBeNull();
  await act(async () => {
    s.receive("link-inventory", { v: 1, path: "/draft", links: [{ key: "0", scope: "object:about", href: "/contact", originalHref: "/locations" }] });
  });
  selection = vi.mocked(s.props.onSelect).mock.calls.at(-1)?.[0];
  if (!selection?.link) throw new Error("Missing selection");
  expect(selectionLinkOriginal(selection.link.el)).toEqual({ href: "/locations", target: null });
});