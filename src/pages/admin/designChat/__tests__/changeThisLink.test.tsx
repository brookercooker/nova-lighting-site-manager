import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmitWalkthroughPanel, walkProgress, ownLinkPrint } from "../SubmitWalkthrough";
import { walk, useWalk } from "../submitWalkthroughStore";
import { fixPage, linkCheckList, linkState } from "../linkCheck";
import { LinkFixBanner, useClearFixOnExit } from "../linkFix";
import { CONTENT_SAVED } from "../contentSavedEvent";

const m = vi.hoisted(() => ({ state: null as any, data: null as any, editing: false, select: vi.fn(), start: vi.fn(), review: vi.fn(), register: vi.fn() }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({ state: m.state, editing: m.editing, setReviewOpen: m.review, refreshSoon: vi.fn(), showPreviewPath: vi.fn(), selectPage: m.select, startEditing: m.start }) }));
vi.mock("../helper", () => ({ postToHelper: vi.fn() }));
vi.mock("../reviewLinkSave", () => ({ resolveReviewLink: vi.fn(async () => { throw new Error("We couldn't find this link on the page"); }), FIND_LINK_ERROR: "We couldn't find this link on the page", saveReviewLink: vi.fn() }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => m.data }));
vi.mock("../trustedDomains", () => ({ useTrustedDomains: () => ({ domains: [], isAdmin: false, pending: false, error: "", change: vi.fn() }), TrustedDomainList: () => null }));
vi.mock("../pageSelection", () => ({ workingPageFrom: (p: any) => ({ id: p.id, name: p.name, path: p.path }) }));
vi.mock("../usePreviewPage", () => ({ registerPreviewPage: (p: any) => { m.register(p); return Promise.resolve({ id: "id" + p.path, ...p }); } }));

const link = (href: string, page = "/a") => ({ key: `${page}|${href}`, href, kind: "internal", label: null, requestIds: [] });
const groups = (links: any[]) => [{ page: { name: "About", path: "/a" }, label: "About", links }];
function setData(links: any[], extra: any[] = []) {
  m.data = { rows: [{ key: "page:/a", page: { name: "About", path: "/a" }, how: "x" }], pages: [], pagesStatus: "ok",
    links: { status: "ok", groups: [...groups(links), ...extra], unread: 0, partial: false, truncated: false } };
}
function Host() { const s = useWalk(); useClearFixOnExit(m.editing); return <>{s.open && <SubmitWalkthroughPanel onKeepEditing={() => walk.keepEditing()} />}<LinkFixBanner /></>; }
const toLinks = () => act(() => { walk.open("panel"); walk.update(w => ({ ...w, step: "links", ticked: ["page:/a"], autoOpen: false, checking: null })); });

beforeEach(() => { vi.clearAllMocks(); walk.reset(); m.editing = false; m.state = { busy: false, publish: { ok: true, open: 1 }, review: { enabled: true } }; setData([link("/gallery")]); });
afterEach(cleanup);

async function changeWrong(h: ReturnType<typeof render>) {
  fireEvent.click(screen.getByRole("button", { name: /^Correct link:/ }));
  await screen.findByRole("button", { name: "Open in Manual Edit" });
  fireEvent.click(screen.getByRole("button", { name: "Open in Manual Edit" }));
  await waitFor(() => expect(m.start).toHaveBeenCalled());
  m.editing = true; h.rerender(<Host />);
}

describe("Edit Link Destination", () => {
  it("opens the inline panel directly from an unresolved or confirmed row", async () => {
    render(<Host />); toLinks();
    act(() => walk.confirmLink("/a|/gallery", "fp", true));
    fireEvent.click(screen.getByRole("button", { name: /^Correct link:/ }));
    expect(walk.get().reviewEdit?.link.href).toBe("/gallery");
    expect(m.start).not.toHaveBeenCalled();
    expect(walk.get().fix).toBeNull();
  });
  it("resolution fallback opens Manual Edit Mode on the link's page and shows the banner", async () => {
    const h = render(<Host />); toLinks();
    await changeWrong(h);
    expect(m.register).toHaveBeenCalledWith({ path: "/a", name: "About" });
    expect(m.select).toHaveBeenCalledWith({ id: "id/a", name: "About", path: "/a" });
    expect(walk.get().open).toBe(false);
    expect(walk.get().fix).toMatchObject({ key: "/a|/gallery", path: "/a", saved: false });
    expect(screen.getByRole("button", { name: "Back to Review" })).toBeTruthy();
  });
  it("Back to Review without a save leaves the link needing checking", async () => {
    const h = render(<Host />); toLinks();
    await changeWrong(h);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Back to Review" })); });
    expect(walk.get().fix).toBeNull();
    expect(walk.get().open).toBe(true);
    expect(walk.get().step).toBe("links");
    expect(linkState("/a|/gallery", walk.get().linkTicked, walk.get().linkReplaced)).toBe("todo");
  });
  it("after a save becomes Replaced by Hand, counts as approved and unblocks Next; the new link needs checking", async () => {
    const h = render(<Host />); toLinks();
    await changeWrong(h);
    act(() => { window.dispatchEvent(new Event(CONTENT_SAVED)); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Done, Back to Review" })); });
    m.editing = false;
    // The refetch lists the new destination alongside the old one, whose fingerprint is unchanged.
    const old = m.data.links.groups[0].links[0];
    const { linkFingerprints } = await import("../SubmitWalkthrough");
    setData([old, link("/gallery-new")]);
    m.data.pages = [{ name: "Gallery", path: "/gallery-new", build_status: "ready" }];
    h.rerender(<Host />);
    expect(linkState(old.key, walk.get().linkTicked, walk.get().linkReplaced)).toBe("replaced");
    expect(linkState("/a|/gallery-new", walk.get().linkTicked, walk.get().linkReplaced)).toBe("todo");
    expect(screen.getByText("1 of 2 links approved")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("link", { name: /^Open link to verify / })).toHaveLength(2);
    const p = walkProgress(m.data, walk.get());
    expect(p.linksLeft).toBe(1);
    act(() => walk.confirmLink("/a|/gallery-new", linkFingerprints(m.data)["/a|/gallery-new"], true));
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
    expect(linkCheckList(m.data.links.groups, walk.get().linkTicked, walk.get().linkReplaced).map(e => e.raw)).toEqual(["/gallery-new"]);
  });
  it("a fingerprint change clears Replaced by Hand", () => {
    act(() => walk.update(w => ({ ...w, linkReplaced: { "/a|/gallery": "old" } })));
    walk.reconcile({}, { "/a|/gallery": "x" }, { "/a|/gallery": "old" });
    expect(walk.get().linkReplaced).toEqual({ "/a|/gallery": "old" });
    walk.reconcile({}, { "/a|/gallery": "x" }, { "/a|/gallery": "new" });
    expect(walk.get().linkReplaced).toEqual({});
  });
  it("Return to Edit and leaving Manual Edit Mode clear the return point", () => {
    walk.startFix({ key: "k", fingerprint: "f", path: "/a", pageName: "About", address: "/x" });
    walk.keepEditing();
    expect(walk.get().fix).toBeNull();
    walk.startFix({ key: "k", fingerprint: "f", path: "/a", pageName: "About", address: "/x" });
    m.editing = true; const h = render(<Host />);
    m.editing = false; h.rerender(<Host />);
    expect(walk.get().fix).toBeNull();
  });
  it("shared-piece groups use the first changed page", () => {
    const rows = [{ key: "other", page: null, how: "x" }, { key: "page:/b", page: { name: "Blog", path: "/b" }, how: "x" }] as any;
    expect(fixPage({ page: null, label: "Header", links: [] }, rows)).toEqual({ path: "/b", name: "Blog" });
    expect(fixPage({ page: null, label: "Header", links: [] }, [])).toEqual({ path: "/", name: "Home" });
    expect(fixPage({ page: { name: "About", path: "/a" }, label: "About", links: [] }, rows)).toEqual({ path: "/a", name: "About" });
  });
});
describe("Links step with nothing left", () => {
  it("says so and lets the reviewer continue", async () => {
    render(<Host />); toLinks();
    act(() => walk.update(w => ({ ...w, linkReplaced: { "/a|/gallery": ownLinkPrint(m.data.links.groups[0].links[0]) } })));
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
