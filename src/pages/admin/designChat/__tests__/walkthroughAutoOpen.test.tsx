import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render as renderUI, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitConfirmDialog, SubmitWalkthroughPanel, WalkthroughCheckBar } from "../SubmitWalkthrough";
import { walk, useWalk } from "../submitWalkthroughStore";
import { linkCheckActive, linkText } from "../linkCheck";

const post = vi.fn();
const frame = { src: "https://site.example/a", contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
const m = vi.hoisted(() => ({ state: null as any, show: vi.fn(), data: null as any }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, setReviewOpen: vi.fn(), refreshSoon: vi.fn(), showPreviewPath: m.show, selectPage: vi.fn() }) }));
vi.mock("../helper", () => ({ postToHelper: vi.fn() }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));
vi.mock("../trustedDomains", () => ({ useTrustedDomains: () => ({ domains: [], isAdmin: false, pending: false, error: "", change: vi.fn() }), TrustedDomainList: () => null }));
vi.mock("../previewNavigate", async (orig) => ({ ...(await orig<any>()), shownPreviewFrame: () => frame }));
// Walkthrough regressions enter through the restored introduction.
const render = (ui: ReactNode) => {
  const result = renderUI(ui);
  const next = screen.queryByRole("button", { name: "Continue to Review" });
  if (next) fireEvent.click(next);
  return result;
};
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
  const [intro, setIntro] = useState(true);
  return <><SubmitConfirmDialog open={intro} onOpenChange={setIntro} />{s.open && <SubmitWalkthroughPanel onKeepEditing={() => walk.keepEditing()} />}<WalkthroughCheckBar /></>;
}
const ready = () => { const e = new Event("message") as any; Object.assign(e, { data: { source: "nova-site", type: "link-check-ready", v: 2, enabled: true }, origin: "https://site.example", source: frame.contentWindow }); window.dispatchEvent(e); };

describe("walkthrough auto-open and link lines", () => {
  it("opens the first real page once on desktop, and again after Return to Edit then Submit", () => {
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
  it("Approve advances and the last approval returns to Design Check, never Verify Changed Links", () => {
    m.data.rows = [page("/a", "About"), page("/b", "Blog")];
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(walk.get().ticked).toEqual(["page:/a"]);
    expect(m.show).toHaveBeenLastCalledWith("/b");
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(walk.get().ticked).toEqual(["page:/a", "page:/b"]);
    expect(walk.get().checking).toBeNull();
    expect(walk.get().step).toBe("pages");
  });
  it("Next Page skips without approving", () => {
    m.data.rows = [page("/a", "About"), page("/b", "Blog")];
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    expect(walk.get().ticked).toEqual([]);
    expect(walk.get().checking?.key).toBe("page:/b");
  });
  it("revisiting an approved page keeps its approval and advances through the same control", () => {
    m.data.rows = [page("/a", "About"), page("/b", "Blog")];
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    act(() => walk.update(w => ({ ...w, checking: { key: "page:/a", kind: "page", name: "About" } })));
    expect(screen.getByRole("button", { name: "Next Page" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    expect(walk.get().ticked).toEqual(["page:/a"]);
    expect(walk.get().checking?.key).toBe("page:/b");
  });
  it("page navigation remains enabled while link comparisons refresh", () => {
    m.data.rows = [page("/a", "About"), page("/b", "Blog")];
    m.data.links = { status: "loading" };
    render(<Host />);
    expect(screen.getByRole("button", { name: "Next Page" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });
  it("last-page Done returns to the list without approving", () => {
    m.data.rows = [page("/a", "About"), page("/b", "Blog")];
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(walk.get().checking).toBeNull();
    expect(walk.get().open).toBe(true);
    expect(walk.get().step).toBe("pages");
    expect(walk.get().ticked).toEqual([]);
  });
  it("enables Next after both page approvals once up-front link collection completes", () => {
    m.data.rows = [page("/a", "About"), page("/b", "Blog")];
    m.data.links = { status: "loading" };
    const h = render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(walk.get().ticked).toEqual(["page:/a", "page:/b"]);
    expect(screen.getByRole("button", { name: /^Next$/ })).toBeDisabled();
    m.data = { ...m.data, links: { status: "ok", groups: [{ page: { name: "About", path: "/a" }, label: "About", links: [link] }], unread: 0, partial: false, truncated: false } };
    h.rerender(<Host />);
    expect(screen.getByRole("button", { name: /^Next$/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^Next$/ }));
    expect(walk.get().step).toBe("links");
    expect(walk.get().ticked).toEqual(["page:/a", "page:/b"]);
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
  it("opens the first page on phones and collapses review with Back to Review available", () => {
    (window as any).innerWidth = 390;
    render(<Host />);
    expect(m.show).toHaveBeenCalledWith("/a");
    expect(walk.get().checking?.key).toBe("page:/a");
    expect(walk.get().open).toBe(false);
    expect(walk.get().viewed).toContain("page:/a");
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect(walk.get().open).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Approve About" })).toBeEnabled();
    expect(m.show).toHaveBeenCalledTimes(1);
  });
  it("step 1 Approve needs only the open page, with no link content", () => {
    render(<Host />);
    act(() => walk.reopen("pages"));
    const blog = within(screen.getByRole("button", { name: /^Blog / }).closest("li")!);
    expect(blog.getByRole("checkbox", { name: "Approve Blog" })).toBeDisabled();
    const about = within(screen.getByRole("button", { name: /^About / }).closest("li")!);
    expect(about.getByRole("checkbox", { name: "Approve About" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Show on Page" })).toBeNull();
    expect(walk.get().ticked).toEqual([]);
    expect(document.body).not.toHaveTextContent("Tick every check first");
  });
  it("Show on Page on step 2 opens the link's page, then focuses once the frame is ready", () => {
    act(() => { walk.reopen("links"); walk.update(w => ({ ...w, ticked: ["page:/a", "page:/b"], viewed: ["page:/a", "page:/b"], checking: null })); });
    m.data.links.groups = [{ page: { name: "Blog", path: "/b" }, label: "Blog", links: [{ ...link, key: "/b|/gallery" }] }];
    render(<Host />);
    post.mockClear(); m.show.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Show Card link to /gallery on the page" }));
    expect(m.show).toHaveBeenLastCalledWith("/b");
    expect(walk.get().checking?.key).toBe("/b|/gallery");
    expect(post).not.toHaveBeenCalled();
    act(() => ready());
    expect(walk.get().checking?.key).toBe("/b|/gallery");
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
    expect(screen.getAllByText("Card link to /gallery").length).toBeGreaterThan(0);
  });
  it("shortens card labels and treats an address-only label as unnamed", () => {
    expect(linkText({ href: "/gallery", kind: "internal", label: "/gallery" }, m.data.pages)).toBe("Link to Inspiration Gallery");
    expect(linkText({ href: "/contact", kind: "internal", visibleText: "Lighting Design Services", label: "Lighting Design Services Work one-on-one with our expert designers to create a custom lighting plan tailored to your home — complimentary with any project. BOOK A CONSULTATION" })).toBe("Lighting Design Services");
    expect(linkText({ href: "/contact", kind: "internal", label: "Long card wording that contains several sentences without a short call to action at the end." }).length).toBeLessThanOrEqual(40);
    expect(linkText({ href: "/contact", kind: "internal", label: "Lots of card wording", ariaLabel: "Book a Consultation" })).toBe("Lots of card wording");
  });
});
