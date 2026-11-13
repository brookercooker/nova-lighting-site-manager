import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLinkCheckReady, linkCheckList, linksNeedChecking, parseLinkClick, pageChecks } from "../linkCheck";
import { SubmitWalkthroughPanel, linkFingerprints, ownLinkPrint, walkProgress } from "../SubmitWalkthrough";
import { LinkCheckBridge, useLinkCheckBridge } from "../useLinkCheckBridge";
import { walk, useWalk } from "../submitWalkthroughStore";

const m = vi.hoisted(() => ({ state: null as any, data: null as any, preview: null as any, show: vi.fn(), review: vi.fn() }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, preview: m.preview, setReviewOpen: m.review, refreshSoon: vi.fn(), showPreviewPath: m.show, selectPage: vi.fn() }) }));
vi.mock("../helper", () => ({ postToHelper: vi.fn() }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));

const ORIGIN = "https://site.example";
const team = { key: "/a|/team", href: "/team", kind: "internal" as const, label: "Team", requestIds: ["r1"], status: null };
const row = { key: "page:/a", page: { name: "About", path: "/a" }, how: "Changed by the builder", fingerprint: "v1" };
beforeEach(() => {
  m.review.mockClear();
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
const click = (over: Record<string, unknown> = {}) => ({ source: "nova-site", type: "link-click", v: 2, match: "/team", raw: "/team", href: ORIGIN + "/team", kind: "internal" as const, label: "Team", path: "/a", ...over });

describe("link-click validation", () => {
  it("accepts a well-formed click from the frame's exact origin and window", () => {
    const f = frameWith();
    expect(parseLinkClick(new MessageEvent("message", { data: click(), origin: ORIGIN, source: f.contentWindow }), f, ["/team"])).toMatchObject({ raw: "/team", kind: "internal" as const, label: "Team" });
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
    expect(pageChecks(row as any, [], [])).toEqual([]);
    const link = pageChecks(row as any, [team as any], ["/a|/team"]).at(-1)!;
    expect(link.done).toBe("I confirmed “Team” goes to /team.");
    expect(link.auto).toBe(true);
    expect(pageChecks(row as any, [team as any], []).map(i => i.todo)).toEqual(["Check that “Team” goes to /team."]);
  });
  it("ignores older saved general ticks without crashing", () => {
    walk.update(s => ({ ...s, pageChecks: { "page:/a": { fp: "v1", ids: ["phone"] } } } as any));
    expect(() => walk.reconcile({ "page:/a": "v2" })).not.toThrow();
  });
});

function Host() {
  const s = useWalk();
  return <>{s.open && <SubmitWalkthroughPanel onKeepEditing={() => walk.keepEditing()} />}</>;
}
const panel = () => within(screen.getByRole("region", { name: "Submit for Review Walkthrough" }));
const openLinks = () => { act(() => walk.update(s => ({ ...s, open: true, step: "links", ticked: ["page:/a"], autoOpen: false }))); render(<Host />); };
describe("inline link verification", () => {
  it("requires opening before ticking and permits unchecking", () => {
    openLinks();
    const box = screen.getByRole("button", { name: /^Confirmed:/ });
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("aria-describedby");
    fireEvent.click(screen.getByRole("link", { name: "Open Link to Verify" }));
    expect(box).toBeEnabled();
    fireEvent.click(box);
    expect(walk.get().linkTicked).toEqual([team.key]);
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    fireEvent.click(box);
    expect(walk.get().linkTicked).toEqual([]);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("opening one row never unlocks another", () => {
    m.data.links.groups[0].links.push({ ...team, key: "other", href: "/other", kind: "external" });
    openLinks();
    fireEvent.click(screen.getByRole("link", { name: "Open Link to Verify" }));
    const boxes = screen.getAllByRole("button", { name: /^Confirmed:/ });
    expect(boxes[0]).toBeEnabled(); expect(boxes[1]).toBeDisabled();
  });
  it("missing pages cannot approve even with a legacy Keep decision", () => {
    m.data.pages = []; openLinks();
    fireEvent.click(screen.getByRole("link", { name: "Open Link to Verify" }));
    act(() => { walk.confirmLink(team.key, "fp", true); walk.update(s => ({ ...s, keptMissing: { [team.key]: "old" } })); });
    expect(screen.getByRole("button", { name: /^Confirmed:/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
  it.each([["mail", "mailto:a@b.co"], ["phone", "tel:+15550100"]])("keeps %s address verification immediate", (kind, href) => {
    m.data.links.groups[0].links = [{ ...team, kind, href }]; openLinks();
    expect(screen.queryByRole("link", { name: "Open Link to Verify" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Confirmed:/ })).toBeEnabled();
  });
  it("keeps draft tokens only in safe opening URLs", () => {
    m.preview = { shownId: 4, frames: [{ id: 4, url: "https://id-preview--aeb60cc1-b08d-4938-9d83-88c44335e167.lovable.app/a?__lovable_token=test-credential" }] };
    openLinks();
    const link = screen.getByRole("link", { name: "Open Link to Verify" });
    expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.getAttribute("href")).toContain("__lovable_token=test-credential");
    expect(document.body.textContent).not.toContain("test-credential");
  });
  it("clears opening permission when a link fingerprint changes", () => {
    openLinks(); fireEvent.click(screen.getByRole("link", { name: "Open Link to Verify" }));
    act(() => walk.reconcile({}, undefined, { [team.key]: "new" }));
    expect(screen.getByRole("button", { name: /^Confirmed:/ })).toBeDisabled();
  });
});

function Bridge({ active, links = [] }: { active: boolean; links?: any[] }) {
  const ref = useRef<HTMLElement>(document.body);
  useLinkCheckBridge(ref, active, "k", links);
  return null;
}
const ready = (v = 2) => ({ source: "nova-site", type: "link-check-ready", v, enabled: true });
describe("frame bridge row selection", () => {
  it("reopens the phone review panel through the real bridge without navigating the preview", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const f = frameWith();
    const ref = { current: document.body };
    m.show.mockClear();
    act(() => walk.update(s => ({ ...s, step: "links", checking: { key: team.key, kind: "link", name: "Team" } })));
    render(<><LinkCheckBridge root={ref} frameKey="phone" /><Host /></>);
    for (const data of [ready(), click()]) act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN, source: f.contentWindow })); });
    expect(m.review).toHaveBeenCalledWith(true);
    expect(walk.get().open).toBe(true);
    expect(screen.getByRole("link", { name: "Open Link to Verify" })).toHaveFocus();
    expect(m.show).not.toHaveBeenCalled();
    expect(f.src).toBe(ORIGIN + "/a");
    f.remove(); Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  });
  it.each([1280, 390])("selects and scrolls the matching row and opens review at width %s", width => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
    const f = frameWith();
    const post = vi.spyOn(f.contentWindow as Window, "postMessage");
    const root = { current: document.body };
    const send = (data: any) => act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN, source: f.contentWindow })); });
    function Wired() { useLinkCheckBridge(root, true, "k", [{ raw: "/team", state: "todo" }], () => walk.selectLink(team.key)); return <Host />; }
    render(<Wired />);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ interceptAll: true }), ORIGIN);
    send(ready()); send(click());
    expect(walk.get().open).toBe(true);
    expect(walk.get().step).toBe("links");
    expect(walk.get().selectedLink?.key).toBe(team.key);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(screen.getByRole("link", { name: "Open Link to Verify" })).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
    f.remove(); Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  });
  it("shows an inline note for an unchanged click and ignores forged origins", () => {
    const f = frameWith(); render(<><Bridge active links={[{ raw: "/team", state: "todo" }]} /><Host /></>);
    const send = (data: any, origin = ORIGIN) => act(() => { window.dispatchEvent(new MessageEvent("message", { data, origin, source: f.contentWindow })); });
    send(ready()); send(click(), "https://evil.example");
    expect(walk.get().selectedLink).toBeNull();
    send(click({ raw: "/unchanged", href: ORIGIN + "/unchanged", match: null }));
    expect(screen.getByRole("status")).toHaveTextContent("This link wasn't changed, so it doesn't need checking.");
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
    walk.update(s => ({ ...s, step: "links", ticked: ["page:/a"], checking: { key: "/a|/team", kind: "link", name: "Team" } }));
    render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
    expect(screen.getAllByText("Needs Checking").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Show Team on the page" }));
    expect(post).toHaveBeenLastCalledWith({ source: "nova-manager", type: "link-check-focus", raw: "/team" }, ORIGIN);
    act(() => walk.confirmLink("/a|/team", "fp", true));
    expect(screen.getAllByText("Confirmed")[0]).toBeInTheDocument();
    act(() => walk.update(s => ({ ...s, step: "links", ticked: ["page:/a"], linkTicked: [] })));
    const link = document.querySelector("[data-walk-link='/a|/team']") as HTMLElement;
    expect(within(link).getByText("Needs Checking")).toBeInTheDocument();
    expect(within(link).queryByText("Not Reviewed")).toBeNull();
    f.remove();
  });
});

it("retains Contact approval through another link save, page revision and session restore", () => {
  const contact = { ...team, key: "/a|/contact", href: "/contact", label: null, elementKey: "0.1", scope: "page", target: null };
  const gallery = { ...team, key: "/a|/gallery", href: "/gallery", elementKey: "0.2", scope: "page" };
  m.data.links.groups[0].links = [contact, gallery];
  walk.confirmLink(contact.key, ownLinkPrint(contact), true);
  walk.openedVerification(contact.key, ownLinkPrint(contact));
  walk.editLink({ link: gallery as any, group: m.data.links.groups[0], rows: [], fingerprint: ownLinkPrint(gallery) });
  walk.savedLink("/a", { ...gallery, key: "/a|/team", href: "/team" } as any);
  m.data.rows[0].fingerprint = "new page";
  m.data.links.groups[0].links.push({ ...gallery, key: "/a|/team", href: "/team" });
  m.data.links.groups[0].links[0] = { ...contact, requestIds: ["new request"] };
  walk.reconcile({ "page:/a": "new page" }, linkFingerprints(m.data), linkFingerprints(m.data));
  expect(walk.get().linkTicked).toEqual([contact.key]);
  expect(walk.get().verificationOpened[contact.key]).toBe(ownLinkPrint(contact));
  walk.restoreSession();
  walk.reconcile({ "page:/a": "new page" }, linkFingerprints(m.data), linkFingerprints(m.data));
  expect(walk.get().linkTicked).toEqual([contact.key]);
});
it.each([{ href: "/changed" }, { target: "_blank" }, { elementKey: "0.9" }, { scope: "object:x" }])("invalidates only the changed link for %j even during repin", change => {
  const contact = { ...team, key: "/a|/contact", href: "/contact", elementKey: "0.1", scope: "page" };
  walk.confirmLink(team.key, ownLinkPrint(team as any), true);
  walk.confirmLink(contact.key, ownLinkPrint(contact as any), true);
  walk.update(s => ({ ...s, repin: { path: "/a", until: Date.now() + 10000 } }));
  const prints = { [team.key]: ownLinkPrint({ ...team, ...change } as any), [contact.key]: ownLinkPrint(contact as any) };
  walk.reconcile({}, prints, prints);
  expect(walk.get().linkTicked).toEqual([contact.key]);
  expect(walk.get().changed).toContain(team.key);
});

describe("unchanged clicks without a readiness dependency", () => {
  it.each([375, 1280])("real Manager bridge opens the note for exact-frame match:null before ready at %s", width => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    const f = frameWith();
    m.review.mockClear(); m.show.mockClear();
    act(() => walk.update(s => ({ ...s, step: "links", open: false, checking: { key: team.key, kind: "link", name: "Team" } })));
    render(<><LinkCheckBridge root={{ current: document.body }} frameKey="early-click" /><Host /></>);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: click({ match: null, raw: "/wall-sconces", href: ORIGIN + "/wall-sconces", label: "Wall & Sconces" }), origin: ORIGIN, source: f.contentWindow })));
    expect(walk.get().open).toBe(true);
    expect(walk.get().selectedLink).toBeNull();
    expect(m.review).toHaveBeenCalledWith(true);
    expect(walk.get().linkNote).toBe("This link wasn't changed, so it doesn't need checking.");
    expect(m.show).not.toHaveBeenCalled();
    f.remove(); Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  });
  it("rejects missing match and forged window/origin even before ready", () => {
    const f = frameWith();
    render(<Bridge active links={[{ raw: "/team", state: "todo" }]} />);
    for (const [source, origin, match] of [[f.contentWindow, ORIGIN, undefined], [window, ORIGIN, null], [f.contentWindow, "https://evil.example", null]] as const) {
      act(() => window.dispatchEvent(new MessageEvent("message", { data: click({ match }), origin, source })));
    }
    expect(walk.get().open).toBe(false);
    expect(walk.get().linkNote).toBeNull();
    f.remove();
  });
  it("redacts preview credentials in trusted dev diagnostics", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const f = frameWith(); render(<Bridge active links={[{ raw: "/team", state: "todo" }]} />);
    act(() => window.dispatchEvent(new MessageEvent("message", { data: click({ match: null, raw: "/wall?__lovable_token=private-value", href: ORIGIN + "/wall?access_token=private-value" }), origin: ORIGIN, source: f.contentWindow })));
    expect(debug).toHaveBeenCalledWith("[review-link] received link-click", expect.objectContaining({ match: null, accepted: true, kind: "internal" }));
    expect(JSON.stringify(debug.mock.calls)).not.toContain("private-value");
    debug.mockRestore(); f.remove();
  });
});

it.each(["Enter", " "])("card keyboard activation %s opens its page without approving", key => {
  m.show.mockClear(); openLinks();
  fireEvent.keyDown(screen.getByRole("button", { name: "Show Team on the page" }), { key });
  expect(m.show).toHaveBeenCalledWith("/a");
  expect(walk.get().checking?.key).toBe(team.key);
  expect(walk.get().linkTicked).toEqual([]);
});
it("inner verification, confirmation and Correct never activate the card", () => {
  m.show.mockClear(); openLinks();
  fireEvent.click(screen.getByRole("link", { name: "Open Link to Verify" }));
  const confirm = screen.getByRole("button", { name: "Confirmed: Team" });
  fireEvent.click(confirm);
  expect(confirm).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(confirm);
  expect(confirm).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: "Correct link: Team" }));
  expect(walk.get().reviewEdit?.link.key).toBe(team.key);
  expect(m.show).not.toHaveBeenCalled();
});
it("phone card activation closes the review even when the same link was already checked", () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  openLinks();
  act(() => walk.update(s => ({ ...s, checking: { key: team.key, kind: "link", name: "Team" } })));
  fireEvent.click(screen.getByRole("button", { name: "Show Team on the page" }));
  expect(walk.get().open).toBe(false);
  expect(walk.get().checking?.key).toBe(team.key);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
});
