import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitConfirmDialog, SubmitWalkthroughPanel, WalkthroughCheckBar, LinkCheckWindow } from "../SubmitWalkthrough";
import { walk, useWalk } from "../submitWalkthroughStore";
import { linkText } from "../linkCheck";

const post = vi.fn();
const frame = { src: "https://site.example/a", contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
const m = vi.hoisted(() => ({ state: null as any, show: vi.fn(), data: null as any }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, setReviewOpen: vi.fn(), refreshSoon: vi.fn(), showPreviewPath: m.show, selectPage: vi.fn() }) }));
vi.mock("../helper", () => ({ postToHelper: vi.fn() }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));
vi.mock("../previewNavigate", async (orig) => ({ ...(await orig<any>()), shownPreviewFrame: () => frame }));
const page = (key: string, name: string) => ({ key: "page:" + key, page: { name, path: key }, how: "Changed by the builder" });
const link = { key: "/a|/gallery", href: "/gallery", kind: "internal", label: null, requestIds: [] };
beforeEach(() => {
  vi.clearAllMocks(); walk.reset(); (window as any).innerWidth = 1280;
  m.state = { busy: false, publish: { ok: true, open: 1 }, review: { enabled: true } };
  m.data = { rows: [{ key: "other", page: null, how: "x", count: 1 }, page("/a", "About"), page("/b", "Blog")], pages: [{ name: "Inspiration Gallery", path: "/gallery", build_status: "ready" }], pagesStatus: "ok",
    links: { status: "ok", groups: [{ page: { name: "About", path: "/a" }, label: "About", links: [link] }], unread: 0, partial: false, truncated: false } };
});
afterEach(() => { cleanup(); (window as any).innerWidth = 1280; });

function Host() {
  const s = useWalk();
  return <><SubmitConfirmDialog open onOpenChange={() => {}} />{s.open && <SubmitWalkthroughPanel onKeepEditing={() => walk.keepEditing()} />}<WalkthroughCheckBar /><LinkCheckWindow /></>;
}
const ready = () => { const e = new Event("message") as any; Object.assign(e, { data: { source: "nova-site", type: "link-check-ready", v: 2, enabled: true }, origin: "https://site.example", source: frame.contentWindow }); window.dispatchEvent(e); };

describe("walkthrough auto-open and link lines", () => {
  it("opens the first real page once on desktop, and again after Keep Editing then Submit", () => {
    const h = render(<Host />);
    expect(m.show).toHaveBeenCalledTimes(1);
    expect(m.show).toHaveBeenCalledWith("/a");
    expect(walk.get().checking?.key).toBe("page:/a");
    expect(walk.get().viewed).toContain("page:/a");
    act(() => walk.reopen("pages"));
    expect(m.show).toHaveBeenCalledTimes(1); // not after Back to Review
    act(() => walk.update(w => ({ ...w })));
    expect(m.show).toHaveBeenCalledTimes(1); // not on refresh
    h.unmount(); act(() => walk.keepEditing());
    render(<Host />);
    expect(m.show).toHaveBeenCalledTimes(2);
  });
  it("waits for the pages list", () => {
    m.data.pagesStatus = "loading";
    const h = render(<Host />);
    expect(m.show).not.toHaveBeenCalled();
    m.data = { ...m.data, pagesStatus: "ok" }; h.rerender(<Host />);
    expect(m.show).toHaveBeenCalledWith("/a");
  });
  it("does not open when a page is already being checked", () => {
    act(() => { walk.open("panel"); walk.update(w => ({ ...w, checking: { key: "page:/b", kind: "page", name: "Blog" } })); });
    render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
    expect(m.show).not.toHaveBeenCalled();
    expect(walk.get().autoOpen).toBe(false);
  });
  it("does not open on phones", () => {
    (window as any).innerWidth = 390;
    render(<Host />);
    expect(m.show).not.toHaveBeenCalled();
    expect(walk.get().checking).toBeNull();
  });
  it("never shows Tick every check first while Approve stays disabled", () => {
    render(<Host />);
    act(() => walk.reopen("pages"));
    const region = screen.getByRole("region", { name: "Submit for Review Walkthrough" });
    const row = within(screen.getByRole("button", { name: "About" }).closest("li")!);
    expect(row.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(document.body).not.toHaveTextContent("Tick every check first");
    expect(region).toHaveTextContent("Open the page first"); // Blog is not opened yet
  });
  it("Show on Page opens an unchecked page, then focuses once the frame is ready", () => {
    m.data.links.groups = [{ page: { name: "Blog", path: "/b" }, label: "Blog", links: [{ ...link, key: "/b|/gallery" }] }];
    render(<Host />);
    act(() => walk.reopen("pages"));
    const row = within(screen.getByRole("button", { name: "Blog" }).closest("li")!);
    post.mockClear();
    fireEvent.click(row.getByRole("button", { name: "Show on Page" }));
    expect(m.show).toHaveBeenLastCalledWith("/b");
    expect(walk.get().checking?.key).toBe("page:/b");
    expect(post.mock.calls.some(c => c[0].type === "link-check-focus")).toBe(false);
    act(() => ready());
    expect(post).toHaveBeenCalledWith({ source: "nova-manager", type: "link-check-focus", raw: "/gallery" }, "https://site.example");
  });
  it("uses a friendly link text fallback", () => {
    const pages = m.data.pages;
    expect(linkText({ href: "/gallery", kind: "internal", label: null }, pages)).toBe("Link to Inspiration Gallery");
    expect(linkText({ href: "/missing", kind: "internal", label: null }, pages)).toBe("/missing");
    expect(linkText({ href: "/gallery", kind: "internal", label: "See More" }, pages)).toBe("See More");
    render(<Host />);
    act(() => walk.reopen("pages"));
    expect(screen.getAllByText("Link to Inspiration Gallery").length).toBeGreaterThan(0);
  });
});
