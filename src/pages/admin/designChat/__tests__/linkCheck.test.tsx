import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLinkCheckReady, linkCheckList, linksNeedChecking, parseLinkClick, pageChecks } from "../linkCheck";
import { LinkCheckWindow, SubmitWalkthroughPanel } from "../SubmitWalkthrough";
import { useLinkCheckBridge } from "../useLinkCheckBridge";
import { walk, useWalk } from "../submitWalkthroughStore";

const m = vi.hoisted(() => ({ state: null as any, data: null as any, preview: null as any, show: vi.fn() }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, preview: m.preview, setReviewOpen: vi.fn(), refreshSoon: vi.fn(), showPreviewPath: m.show, selectPage: vi.fn() }) }));
vi.mock("../helper", () => ({ postToHelper: vi.fn() }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));

const ORIGIN = "https://site.example";
const team = { key: "/a|/team", href: "/team", kind: "internal", label: "Team", requestIds: ["r1"], status: null };
const row = { key: "page:/a", page: { name: "About", path: "/a" }, how: "Changed by the builder", fingerprint: "v1" };
beforeEach(() => {
  walk.reset();
  m.preview = null;
  m.state = { busy: false, publish: { ok: true, open: 1 }, review: { enabled: true } };
  m.data = { rows: [row], pages: [{ name: "Team", path: "/team", build_status: "ready" }], links: { status: "ok", unread: 0, partial: false, truncated: false, groups: [{ page: { name: "About", path: "/a" }, label: "About", links: [team] }] } };
});
afterEach(cleanup);

function frameWith(src = ORIGIN + "/a") {
  const f = document.createElement("iframe");
  f.src = src; f.setAttribute("data-site-preview", "true"); f.setAttribute("data-preview-shown", "true");
  document.body.appendChild(f);
  return f;
}
const click = (over: Record<string, unknown> = {}) => ({ source: "nova-site", type: "link-click", v: 2, match: "/team", raw: "/team", href: ORIGIN + "/team", kind: "internal", label: "Team", path: "/a", ...over });

describe("link-click validation", () => {
  it("accepts a well-formed click from the frame's exact origin and window", () => {
    const f = frameWith();
    expect(parseLinkClick(new MessageEvent("message", { data: click(), origin: ORIGIN, source: f.contentWindow }), f, ["/team"])).toMatchObject({ raw: "/team", kind: "internal", label: "Team" });
    f.remove();
  });
  it.each([
    ["wrong origin", { origin: "https://evil.example" }, {}],
    ["wrong source", { source: window }, {}],
    ["wrong kind", {}, { kind: "script" }],
    ["missing raw", {}, { raw: "" }],
    ["v1 click", {}, { v: 1 }],
    ["missing match", {}, { match: undefined }],
    ["unlisted match", {}, { match: "/other" }],
    ["wrong sender", {}, { source: "other" }],
    ["unsafe path", {}, { path: "//evil" }],
  ])("ignores %s", (_n, ev: any, data) => {
    const f = frameWith();
    expect(parseLinkClick(new MessageEvent("message", { data: click(data), origin: ORIGIN, source: f.contentWindow, ...ev }), f, ["/team"])).toBeNull();
    f.remove();
  });
});

describe("per-page checks", () => {
  it("lists only changed links; a page without links has no items", () => {
    expect(pageChecks(row as any, [], [], [])).toEqual([]);
    const link = pageChecks(row as any, [team as any], ["/a|/team"], []).at(-1)!;
    expect(link.done).toBe("I confirmed “Team” goes to /team.");
    expect(link.auto).toBe(true);
    expect(pageChecks(row as any, [team as any], [], []).map(i => i.todo)).toEqual(["Check that “Team” goes to /team."]);
  });
  it("ignores older saved general ticks without crashing", () => {
    walk.update(s => ({ ...s, pageChecks: { "page:/a": { fp: "v1", ids: ["phone"] } } } as any));
    expect(() => walk.reconcile({ "page:/a": "v2" })).not.toThrow();
  });
});

function Host() {
  const s = useWalk();
  return <>{s.open && <SubmitWalkthroughPanel onKeepEditing={() => walk.keepEditing()} />}<LinkCheckWindow /></>;
}
const panel = () => within(screen.getByRole("region", { name: "Submit for Review Walkthrough" }));
const win = () => within(screen.getByRole("dialog", { name: "Check This Link" }));
const openAbout = () => { act(() => walk.open("panel")); render(<Host />); fireEvent.click(panel().getAllByRole("button", { name: "About" })[0]); act(() => walk.reopen("pages")); };
const tickThree = () => { expect(panel().queryByRole("checkbox", { name: /phone|text that changed|images and layout/ })).toBeNull(); };

describe("Approve gating and the Check This Link window", () => {
  it("step 1 has no links and Approve needs only the open page", () => {
    openAbout();
    expect(panel().queryByRole("button", { name: "Check This Link" })).toBeNull();
    expect(panel().queryByText(/Dashed orange outlines/)).toBeNull();
    expect(panel().queryByText(/Links to Check/)).toBeNull();
    expect(panel().getByRole("button", { name: "Approve" })).toBeEnabled();
  });
  it("step 2: Check This Link confirms the link, updates the count and enables Next", () => {
    act(() => walk.update(s => ({ ...s, open: true, step: "links", ticked: ["page:/a"], viewed: ["page:/a"] })));
    render(<Host />);
    expect(panel().getByText(/Dashed orange outlines/)).toBeInTheDocument();
    const row = within(document.querySelector("[data-walk-link='/a|/team']") as HTMLElement);
    expect(row.getAllByRole("button").map(b => b.textContent)).toEqual(["Show on Page", "Check This Link"]);
    expect(panel().getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(row.getByRole("button", { name: "Check This Link" }));
    expect(win().getByText("A page on your site")).toBeInTheDocument();
    expect(win().getByText("Page found")).toBeInTheDocument();
    expect(win().getByRole("button", { name: "Confirm Link" })).toBeEnabled();
    fireEvent.click(win().getByRole("button", { name: "Confirm Link" }));
    expect(walk.get().linkTicked).toEqual(["/a|/team"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(row.getByText("Confirmed")).toBeInTheDocument();
    expect(panel().getByText(/1 of 1 link/)).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Next" })).toBeEnabled();
  });
  it("This Isn't Right marks the link and blocks Next until it changes", () => {
    act(() => walk.update(s => ({ ...s, open: true, step: "links", ticked: ["page:/a"], viewed: ["page:/a"] })));
    render(<Host />);
    fireEvent.click(panel().getByRole("button", { name: "Check This Link" }));
    fireEvent.click(win().getByRole("button", { name: "This Isn't Right" }));
    expect(panel().getByText("Marked as Wrong")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Next" })).toBeDisabled();
    m.data = { ...m.data, links: { ...m.data.links, groups: [{ ...m.data.links.groups[0], links: [{ ...team, requestIds: ["r1", "r2"] }] }] } };
    act(() => walk.update(s => ({ ...s })));
    expect(Object.keys(walk.get().linkWrong)).toEqual([]);
  });
  it("opens external HTTPS destinations directly without requiring a tab visit to confirm", () => {
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw: "https://other.example/x", href: "https://other.example/x", kind: "external", label: "Partner", path: "/a", page: "/a" } })));
    expect(win().getByText("A different website")).toBeInTheDocument();
    expect(win().getByRole("link", { name: "Open in New Tab" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(win().getByRole("link", { name: "Open in New Tab" })).toHaveAttribute("href", "https://other.example/x");
    expect(win().getByRole("link", { name: "Open in New Tab" })).toHaveAttribute("target", "_blank");
    expect(win().getByText("This link wasn't changed in this draft, so checking it here isn't counted.")).toBeInTheDocument();
    fireEvent.click(win().getByRole("button", { name: "Confirm Link" }));
    expect(walk.get().linkTicked).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each([["mail", "mailto:a@b.co", "a@b.co", "An email address"], ["phone", "tel:+15550100", "+15550100", "A phone number"]])("shows %s addresses without an open-tab or copy button", (kind, raw, address, text) => {
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw, href: raw, kind: kind as any, label: null, path: "/a", page: "/a" } })));
    expect(win().getByText(text)).toBeInTheDocument();
    expect(win().getAllByText(address).length).toBeGreaterThan(0);
    expect(win().queryByRole("link", { name: "Open in New Tab" })).toBeNull();
    expect(win().queryByRole("button", { name: "Copy Address" })).toBeNull();
  });
  it("opens internal destinations using the shown draft preview base, preserving its query", () => {
    m.preview = { shownId: 4, frames: [{ id: 4, url: "https://id-preview--aeb60cc1-b08d-4938-9d83-88c44335e167.lovable.app/a?fixture=draft" }] };
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw: "/team?view=all#people", href: "/team?view=all#people", kind: "internal", label: null, path: "/a", page: "/a" } })));
    const url = new URL(win().getByRole("link", { name: "Open in New Tab" }).getAttribute("href") ?? "");
    expect(url.origin).toBe("https://id-preview--aeb60cc1-b08d-4938-9d83-88c44335e167.lovable.app");
    expect(url.pathname + url.hash).toBe("/team#people");
    expect(url.searchParams.get("fixture")).toBe("draft");
    expect(url.searchParams.get("view")).toBe("all");
  });
  it("opens anchors in a new tab at their page", () => {
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw: "#faq", href: "#faq", kind: "anchor", label: "FAQ", path: "/a", page: "/a" } })));
    expect(win().getByText("A section of this page")).toBeInTheDocument();
    expect(win().getByRole("link", { name: "Open in New Tab" }).getAttribute("href")).toMatch(/\/a#faq$/);
  });
  it("Unconfirm returns a confirmed link to Needs Checking and blocks Next", () => {
    act(() => walk.update(s => ({ ...s, open: true, step: "links", ticked: ["page:/a"] })));
    render(<Host />);
    fireEvent.click(panel().getByRole("button", { name: "Check This Link" }));
    fireEvent.click(win().getByRole("button", { name: "Confirm Link" }));
    fireEvent.click(panel().getByRole("button", { name: "Check This Link" }));
    expect(win().getByText("Confirmed")).toBeInTheDocument();
    fireEvent.click(win().getByRole("button", { name: "Unconfirm" }));
    expect(walk.get().linkTicked).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(panel().getByText("Needs Checking")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Next" })).toBeDisabled();
  });
  it("Close without deciding preserves the unresolved state", () => {
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw: "/team", href: "/team", kind: "internal", label: null, path: "/a", page: "/a" } })));
    fireEvent.click(win().getAllByRole("button", { name: "Close" })[0]);
    expect(walk.get().linkTicked).toEqual([]);
    expect(walk.get().linkWrong).toEqual({});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("a page-not-found link may still be opened and confirmed intentionally", () => {
    m.data.pages = [];
    act(() => walk.update(s => ({ ...s, open: true, step: "links", ticked: ["page:/a"] })));
    render(<Host />);
    expect(panel().getByText("Fix this before submitting, or approve it if it is intended.")).toBeInTheDocument();
    fireEvent.click(panel().getByRole("button", { name: "Check This Link" }));
    expect(win().getByText("Page not found")).toBeInTheDocument();
    expect(win().getByRole("link", { name: "Open in New Tab" })).toBeInTheDocument();
    expect(win().getByRole("button", { name: "Confirm Link" })).toBeEnabled();
    fireEvent.click(win().getByRole("button", { name: "Confirm Link" }));
    expect(panel().getByText("Confirmed")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Next" })).toBeEnabled();
  });
  it("renders label text as text, never HTML", () => {
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw: "/team", href: "/team", kind: "internal", label: "<img src=x onerror=alert(1)>", path: "/a", page: "/a" } })));
    expect(win().getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

function Bridge({ active, links = [] }: { active: boolean; links?: any[] }) {
  const ref = useRef<HTMLElement>(document.body);
  useLinkCheckBridge(ref, active, "k", links);
  return null;
}
const ready = (v = 2) => ({ source: "nova-site", type: "link-check-ready", v, enabled: true });
describe("frame bridge", () => {
  const Wired = () => { const s = useWalk(); const links = linkCheckList(m.data.links.groups, s.linkTicked, s.linkWrong); return <Bridge active={s.checking?.kind === "page"} links={links} />; };
  it("sends the list on enable, re-sends on state change, opens only listed v2 clicks, and switches off on Keep Editing", () => {
    const f = frameWith();
    const post = vi.spyOn(f.contentWindow!, "postMessage");
    render(<><Wired /><LinkCheckWindow /></>);
    act(() => walk.update(s => ({ ...s, checking: { key: "page:/a", kind: "page", name: "About" } })));
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "link-check", enabled: true, links: [{ raw: "/team", state: "todo" }] }, ORIGIN);
    const send = (data: any, origin = ORIGIN) => act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin, source: f.contentWindow })); });
    send(click());
    expect(screen.queryByRole("dialog")).toBeNull(); // no v2 ready yet
    send(ready());
    send(click(), "https://evil.example");
    send(click({ match: "/other" }));
    send(click({ match: undefined }));
    expect(screen.queryByRole("dialog")).toBeNull();
    send(click());
    expect(win().getByText("Is this the correct destination?")).toBeInTheDocument();
    act(() => walk.confirmLink("/a|/team", "fp", true));
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "link-check", enabled: true, links: [{ raw: "/team", state: "done" }] }, ORIGIN);
    act(() => walk.markWrong("/a|/team", "fp"));
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "link-check", enabled: true, links: [{ raw: "/team", state: "wrong" }] }, ORIGIN);
    act(() => walk.keepEditing());
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "link-check", enabled: false }, ORIGIN);
    expect(screen.queryByRole("dialog")).toBeNull();
    f.remove();
  });
  it("treats a v1 ready reply as unsupported", () => {
    const f = frameWith();
    render(<><Wired /><LinkCheckWindow /></>);
    act(() => walk.update(s => ({ ...s, checking: { key: "page:/a", kind: "page", name: "About" } })));
    expect(isLinkCheckReady(new MessageEvent("message", { data: ready(1), origin: ORIGIN, source: f.contentWindow }), f)).toBe(false);
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: ready(1), origin: ORIGIN, source: f.contentWindow })); });
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: click(), origin: ORIGIN, source: f.contentWindow })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    f.remove();
  });
});

describe("links needing checks", () => {
  it("lists shared-piece links, caps at 100 and counts what is left", () => {
    const header = { ...team, key: "|/shop", href: "/shop", label: "Shop" };
    const groups = [{ page: { name: "About", path: "/a" }, label: "About", links: [team] }, { page: null, label: "Header", links: [header] }];
    expect(linkCheckList(groups as any, ["|/shop"], {})).toEqual([{ raw: "/team", state: "todo" }, { raw: "/shop", state: "done" }]);
    const many = Array.from({ length: 120 }, (_, i) => ({ ...team, key: "k" + i, href: "/p" + i }));
    expect(linkCheckList([{ page: null, label: "X", links: many }] as any, [], {})).toHaveLength(100);
    expect(linksNeedChecking([team, header] as any, ["|/shop"], {})).toBe("1 of 2 links need checking");
    expect(linksNeedChecking([team, header] as any, ["|/shop", "/a|/team"], {})).toBe("All links confirmed");
  });
  it("shows badges and Show on Page sends focus; the Links step says Needs Checking", () => {
    const f = frameWith();
    const post = vi.spyOn(f.contentWindow!, "postMessage");
    walk.update(s => ({ ...s, step: "links", ticked: ["page:/a"], linkWrong: {}, checking: { key: "/a|/team", kind: "link", name: "Team" } }));
    render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
    expect(screen.getAllByText("Needs Checking").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Show on Page" }));
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "link-check-focus", raw: "/team" }, ORIGIN);
    act(() => walk.confirmLink("/a|/team", "fp", true));
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    act(() => walk.markWrong("/a|/team", "fp"));
    expect(screen.getByText("Marked as Wrong")).toBeInTheDocument();
    act(() => walk.update(s => ({ ...s, step: "links", ticked: ["page:/a"], linkTicked: [], linkWrong: {} })));
    const link = document.querySelector("[data-walk-link='/a|/team']") as HTMLElement;
    expect(within(link).getByText("Needs Checking")).toBeInTheDocument();
    expect(within(link).queryByText("Not Reviewed")).toBeNull();
    f.remove();
  });
});
