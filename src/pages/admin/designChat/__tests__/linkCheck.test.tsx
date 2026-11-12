import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLinkClick, pageChecks } from "../linkCheck";
import { LinkCheckWindow, SubmitWalkthroughPanel } from "../SubmitWalkthrough";
import { useLinkCheckBridge } from "../useLinkCheckBridge";
import { walk, useWalk } from "../submitWalkthroughStore";

const m = vi.hoisted(() => ({ state: null as any, data: null as any, show: vi.fn() }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, setReviewOpen: vi.fn(), refreshSoon: vi.fn(), showPreviewPath: m.show, selectPage: vi.fn() }) }));
vi.mock("../helper", () => ({ postToHelper: vi.fn() }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));

const ORIGIN = "https://site.example";
const team = { key: "/a|/team", href: "/team", kind: "internal", label: "Team", requestIds: ["r1"], status: null };
const row = { key: "page:/a", page: { name: "About", path: "/a" }, how: "Changed by the builder", fingerprint: "v1" };
beforeEach(() => {
  walk.reset();
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
const click = (over: Record<string, unknown> = {}) => ({ source: "nova-site", type: "link-click", v: 1, raw: "/team", href: ORIGIN + "/team", kind: "internal", label: "Team", path: "/a", ...over });

describe("link-click validation", () => {
  it("accepts a well-formed click from the frame's exact origin and window", () => {
    const f = frameWith();
    expect(parseLinkClick(new MessageEvent("message", { data: click(), origin: ORIGIN, source: f.contentWindow }), f)).toMatchObject({ raw: "/team", kind: "internal", label: "Team" });
    f.remove();
  });
  it.each([
    ["wrong origin", { origin: "https://evil.example" }, {}],
    ["wrong source", { source: window }, {}],
    ["wrong kind", {}, { kind: "script" }],
    ["missing raw", {}, { raw: "" }],
    ["wrong version", {}, { v: 2 }],
    ["wrong sender", {}, { source: "other" }],
    ["unsafe path", {}, { path: "//evil" }],
  ])("ignores %s", (_n, ev: any, data) => {
    const f = frameWith();
    expect(parseLinkClick(new MessageEvent("message", { data: click(data), origin: ORIGIN, source: f.contentWindow, ...ev }), f)).toBeNull();
    f.remove();
  });
});

describe("per-page checks", () => {
  it("starts as instructions and reads in the past tense once ticked; a page without links says so", () => {
    const items = pageChecks(row as any, [], ["phone"], [], []);
    expect(items.map(i => i.ticked ? i.done : i.todo)).toEqual(["I checked how this page looks on a phone.", "Read the text that changed.", "Check the images and layout.", "No links changed on this page."]);
    const link = pageChecks(row as any, [team as any], [], ["/a|/team"], []).at(-1)!;
    expect(link.done).toBe("I confirmed “Team” goes to /team.");
    expect(pageChecks(row as any, [team as any], [], [], []).at(-1)!.todo).toBe("Check that “Team” goes to /team.");
  });
  it("ticks persist for the same fingerprint and reset when the page changes", () => {
    walk.tickPageCheck("page:/a", "v1", "phone", true);
    walk.reconcile({ "page:/a": "v1" });
    expect(walk.get().pageChecks["page:/a"].ids).toEqual(["phone"]);
    walk.reconcile({ "page:/a": "v2" });
    expect(walk.get().pageChecks["page:/a"]).toBeUndefined();
  });
});

function Host() {
  const s = useWalk();
  return <>{s.open && <SubmitWalkthroughPanel onKeepEditing={() => walk.keepEditing()} />}<LinkCheckWindow /></>;
}
const panel = () => within(screen.getByRole("region", { name: "Submit for Review Walkthrough" }));
const win = () => within(screen.getByRole("dialog", { name: "Check This Link" }));
const openAbout = () => { act(() => walk.open("panel")); render(<Host />); fireEvent.click(panel().getAllByRole("button", { name: "About" })[0]); act(() => walk.reopen("pages")); };
const tickThree = () => { for (const t of ["Check how this page looks on a phone.", "Read the text that changed.", "Check the images and layout."]) fireEvent.click(panel().getByRole("checkbox", { name: t })); };

describe("Approve gating and the Check This Link window", () => {
  it("needs the page opened, every item ticked, and the link confirmed (shared with the Links step)", () => {
    openAbout();
    tickThree();
    expect(panel().getByRole("button", { name: "Approve" })).toBeDisabled();
    fireEvent.click(panel().getByRole("button", { name: "Check This Link" }));
    expect(win().getByText("/team")).toBeInTheDocument();
    expect(win().getByText("A page on your site")).toBeInTheDocument();
    expect(win().getByText("Page found")).toBeInTheDocument();
    expect(win().getByTitle("Link Destination").getAttribute("src")).toMatch(/\/team$/);
    fireEvent.click(win().getByRole("checkbox", { name: "I checked that this goes to the right place" }));
    expect(win().getByText("I confirmed this link goes to /team")).toBeInTheDocument();
    expect(walk.get().linkTicked).toEqual(["/a|/team"]);
    expect(walk.get().linkOpened).toEqual(["/a|/team"]);
    fireEvent.click(win().getAllByRole("button", { name: "Close" })[0]);
    expect(panel().getByText("I confirmed “Team” goes to /team.")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Approve" })).toBeEnabled();
  });
  it("This Isn't Right marks the link and keeps Approve disabled until it is confirmed", () => {
    openAbout();
    tickThree();
    fireEvent.click(panel().getByRole("button", { name: "Check This Link" }));
    fireEvent.click(win().getByRole("button", { name: "This Isn't Right" }));
    expect(panel().getByText("Marked as wrong")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(panel().getByText("A link on this page is marked as wrong")).toBeInTheDocument();
    // A changed link clears the mark.
    m.data = { ...m.data, links: { ...m.data.links, groups: [{ ...m.data.links.groups[0], links: [{ ...team, requestIds: ["r1", "r2"] }] }] } };
    act(() => walk.update(s => ({ ...s })));
    expect(Object.keys(walk.get().linkWrong)).toEqual([]);
  });
  it("shows external links with Open in New Tab and a slow-frame note after 4 seconds", () => {
    vi.useFakeTimers();
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw: "https://other.example/x", href: "https://other.example/x", kind: "external", label: "Partner", path: "/a", page: "/a" } })));
    expect(win().getByText("A different website")).toBeInTheDocument();
    expect(win().getByRole("link", { name: "Open in New Tab" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(win().getByText("This link wasn't changed in this draft, so checking it here isn't counted.")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(win().getByText(/may not allow being shown here/)).toBeInTheDocument();
    fireEvent.click(win().getByRole("checkbox", { name: "I checked that this goes to the right place" }));
    expect(walk.get().linkTicked).toEqual([]);
    vi.useRealTimers();
  });
  it.each([["mail", "mailto:a@b.co", "a@b.co", "An email address"], ["phone", "tel:+15550100", "+15550100", "A phone number"]])("shows %s addresses with Copy Address and no frame", (kind, raw, address, text) => {
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw, href: raw, kind: kind as any, label: null, path: "/a", page: "/a" } })));
    expect(win().getByText(text)).toBeInTheDocument();
    expect(win().getAllByText(address).length).toBeGreaterThan(0);
    expect(win().getByRole("button", { name: "Copy Address" })).toBeInTheDocument();
    expect(win().queryByTitle("Link Destination")).toBeNull();
  });
  it("shows anchors as a section of this page, framed at that page", () => {
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw: "#faq", href: "#faq", kind: "anchor", label: "FAQ", path: "/a", page: "/a" } })));
    expect(win().getByText("A section of this page")).toBeInTheDocument();
    expect(win().getByTitle("Link Destination").getAttribute("src")).toMatch(/\/a#faq$/);
  });
  it("renders label text as text, never HTML", () => {
    render(<LinkCheckWindow />);
    act(() => walk.update(s => ({ ...s, linkCheck: { raw: "/team", href: "/team", kind: "internal", label: "<img src=x onerror=alert(1)>", path: "/a", page: "/a" } })));
    expect(win().getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });
});

function Bridge({ active }: { active: boolean }) {
  const ref = useRef<HTMLElement>(document.body);
  useLinkCheckBridge(ref, active, "k");
  return null;
}
describe("frame bridge", () => {
  it("switches link checks on while checking, opens the window on a click, and off on Keep Editing", () => {
    const f = frameWith();
    const post = vi.spyOn(f.contentWindow!, "postMessage");
    const Wired = () => { const s = useWalk(); return <Bridge active={s.checking?.kind === "page"} />; };
    render(<><Wired /><LinkCheckWindow /></>);
    act(() => walk.update(s => ({ ...s, checking: { key: "page:/a", kind: "page", name: "About" } })));
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "link-check", enabled: true }, ORIGIN);
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: click(), origin: "https://evil.example", source: f.contentWindow })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { window.dispatchEvent(new MessageEvent("message", { data: click(), origin: ORIGIN, source: f.contentWindow })); });
    expect(win().getByText("Is this the correct destination?")).toBeInTheDocument();
    act(() => walk.keepEditing());
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "link-check", enabled: false }, ORIGIN);
    expect(screen.queryByRole("dialog")).toBeNull();
    f.remove();
  });
});
