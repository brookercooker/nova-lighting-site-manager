import { beforeEach, describe, expect, it } from "vitest";
import { mergeReviewLinks, type ManagerPage } from "../submitWalkthrough";
import { walk } from "../submitWalkthroughStore";

const relay = { groups: [{ page: { name: "Index", path: "/" }, label: "Index", links: [{ key: "/|/contact", href: "/contact", kind: "internal" as const, label: null, requestIds: ["r1"], status: null }] }], unread: 0, partial: false, truncated: false };
const pages: ManagerPage[] = [{ name: "Homepage", path: "/", build_status: "ready", inlineEdits: { "link:0.3.1": JSON.stringify({ href: "/gallery" }), "html:0.1": "x", "link:0.4": JSON.stringify({ unlinked: true }) } }];

beforeEach(() => walk.reset());
describe("Links step from the saved draft", () => {
  it("adds hand-set destinations on hand-edited pages as new rows and uses the friendly page name", () => {
    const out = mergeReviewLinks(relay, pages, new Set(["/"]));
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].label).toBe("Homepage");
    expect(out.groups[0].page?.name).toBe("Homepage");
    expect(out.groups[0].links.map(l => l.href)).toEqual(["/contact", "/gallery"]);
    expect(relay.groups[0].links).toHaveLength(1); // relay data is never mutated
  });
  it("ignores hand links on pages whose hand edits are not in the draft", () => {
    expect(mergeReviewLinks(relay, pages, new Set()).groups[0].links).toHaveLength(1);
  });
  it("a Change This Link save keeps that page's approval and confirmed links through the refetch", () => {
    walk.update(w => ({ ...w, approvals: { "page:/": "p1" }, ticked: ["page:/"], linkApprovals: { "/|/x": "l1" }, linkTicked: ["/|/x"] }));
    walk.startFix({ key: "/|/contact", fingerprint: "own", path: "/", pageName: "Homepage", address: "/contact" });
    walk.fixSaved(); walk.finishFix();
    expect(walk.get().step).toBe("links");
    expect(walk.get().linkReplaced).toEqual({ "/|/contact": "own" });
    walk.reconcile({ "page:/": "p2" }, { "/|/x": "l2" }, { "/|/contact": "own" });
    expect(walk.get().ticked).toContain("page:/");
    expect(walk.get().linkTicked).toContain("/|/x");
    expect(walk.get().approvals["page:/"]).toBe("p2");
    // Later changes are checked again as usual.
    walk.reconcile({ "page:/": "p3" }, { "/|/x": "l2" }, { "/|/contact": "own" });
    expect(walk.get().ticked).not.toContain("page:/");
  });
});
