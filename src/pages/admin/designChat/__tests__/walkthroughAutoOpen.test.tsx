import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitConfirmDialog, SubmitWalkthroughPanel, WalkthroughCheckBar, LinkCheckWindow } from "../SubmitWalkthrough";
import { walk, useWalk } from "../submitWalkthroughStore";
import { linkCheckActive, linkText } from "../linkCheck";

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
  it("step 1 Approve needs only the open page, with no link content", () => {
    render(<Host />);
    act(() => walk.reopen("pages"));
    const blog = within(screen.getByRole("button", { name: "Blog" }).closest("li")!);
    expect(blog.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(blog.getByText("Open the page first")).toBeInTheDocument();
    const about = within(screen.getByRole("button", { name: "About" }).closest("li")!);
    expect(about.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Show on Page" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(document.body).not.toHaveTextContent("Tick every check first");
  });
  it("Show on Page on step 2 opens the link's page, then focuses once the frame is ready", () => {
    act(() => { walk.reopen("links"); walk.update(w => ({ ...w, ticked: ["page:/a", "page:/b"], viewed: ["page:/a", "page:/b"], checking: null })); });
    m.data.links.groups = [{ page: { name: "Blog", path: "/b" }, label: "Blog", links: [{ ...link, key: "/b|/gallery" }] }];
    render(<Host />);
    post.mockClear(); m.show.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Show on Page" }));
    expect(m.show).toHaveBeenLastCalledWith("/b");
    expect(walk.get().checking?.key).toBe("/b|/gallery");
    expect(post).not.toHaveBeenCalled();
    act(() => ready());
    expect(post).toHaveBeenCalledWith({ source: "nova-manager", type: "link-check-focus", raw: "/gallery" }, "https://site.example");
  });
  it("runs the link bridge only on the Links step while something is being checked", () => {
    const c = { key: "x", kind: "link" as const, name: "X" };
    expect(linkCheckActive({ step: "pages", checking: c }, true, false)).toBe(false);
    expect(linkCheckActive({ step: "links", checking: c }, true, false)).toBe(true);
    expect(linkCheckActive({ step: "links", checking: null }, true, false)).toBe(false);
    expect(linkCheckActive({ step: "links", checking: c }, true, true)).toBe(false);
  });
  it("uses a friendly link text fallback", () => {
    const pages = m.data.pages;
    expect(linkText({ href: "/gallery", kind: "internal", label: null }, pages)).toBe("Link to Inspiration Gallery");
    expect(linkText({ href: "/missing", kind: "internal", label: null }, pages)).toBe("/missing");
    expect(linkText({ href: "/gallery", kind: "internal", label: "See More" }, pages)).toBe("See More");
    act(() => walk.reopen("links"));
    render(<Host />);
    expect(screen.getAllByText("Link to Inspiration Gallery").length).toBeGreaterThan(0);
  });
  it("shows the suggestions as plain bullets on the step and in the bar", () => {
    render(<Host />);
    act(() => walk.close());
    const bar = within(screen.getByRole("region", { name: "Checking Changes" }));
    const inBar = bar.getByText("Things to Look At on Each Page").parentElement!;
    expect(within(inBar).getAllByRole("listitem").map(l => l.textContent)).toEqual(["How the page looks on a phone", "That the text that changed reads correctly", "That the images and layout look right"]);
    expect(within(inBar).queryByRole("checkbox")).toBeNull();
    act(() => walk.reopen("pages"));
    const step = screen.getByRole("region", { name: "Submit for Review Walkthrough" }).querySelector("[data-page-suggestions]") as HTMLElement;
    expect(within(step).getAllByRole("listitem")).toHaveLength(3);
    expect(within(step).queryByRole("checkbox")).toBeNull();
  });
});
