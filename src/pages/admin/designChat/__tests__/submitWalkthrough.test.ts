import { describe, expect, it } from "vitest";
import { changedPages, checklistItems, internalLinkChip, parseReviewLinks, parseReviewPages, relayChangedPages, remaining } from "../submitWalkthrough";

const req = (o: any) => ({ id: o.id ?? "r", request: o.request ?? "Make it nicer", ...o });
describe("changed pages", () => {
  it("lists pages, not changes: de-duplicated, shared-object pages added, rejected and undo skipped", () => {
    const rows = changedPages([
      req({ id: "1", source: "chat", pages: [{ name: "About", path: "/about" }, { name: "Home", path: "/home" }] }),
      req({ id: "2", source: "content", page: { name: "About", path: "/about" } }),
      req({ id: "3", source: "developer", objects: ["Footer"] }),
      req({ id: "4", page: { name: "Gone", path: "/gone" }, decision: { reason: "No" } }),
      req({ id: "5", page: { name: "Undo", path: "/undo" }, isUndo: true }),
    ], { Footer: [{ name: "Home", path: "/" }, { name: "Brands", path: "/brands" }] });
    expect(rows.map((r) => r.key)).toEqual(["page:/about", "page:/", "page:/brands"]);
    expect(rows[0].how).toBe("Changed by the builder · Edited by hand");
    expect(rows[1].how).toBe("Changed by the builder · Changed through the shared object Footer");
    expect(JSON.stringify(rows)).not.toContain("Make it nicer");
  });
  it("collapses page-less changes into one row, skipping platform but retaining zero-site-file requests", () => {
    const rows = changedPages([
      req({ id: "a", request: "Hours" }), req({ id: "b", request: "Fonts", siteFiles: 3 }),
      req({ id: "c", source: "platform" }), req({ id: "d", siteFiles: 0 }),
    ] as any, {});
    expect(rows).toEqual([{ key: "other", page: null, how: "3 changes that aren't tied to one page", count: 3 }]);
    expect(changedPages([req({ source: "platform" })], {})).toEqual([]);
  });
});
describe("authoritative review pages", () => {
  const data = { ok: true, rows: [{ name: "Experiment", path: "/draft/experiment", paths: ["/draft/experiment"], how: ["chat", "content", "developer"], requestIds: ["1"], guess: true }], components: [{ name: "MailchimpForm", requestIds: ["1"] }], objects: [{ name: "Footer", requestIds: ["1"] }], sitewide: { files: ["src/index.css"], requestIds: ["1"] } };
  it("uses actual files instead of viewed Contact even with zero siteFiles, resolves Manager names and source labels", () => {
    const parsed = parseReviewPages(data);
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("invalid fixture");
    const rows = relayChangedPages(parsed, [{ name: "Experiment Page", path: "/draft/experiment", build_status: "draft" }], {}, [req({ id: "1", page: { name: "Contact", path: "/contact" }, siteFiles: 0, by: "brooklyn@example.com" })]);
    expect(rows.map((r) => r.key)).toEqual(["page:/draft/experiment", "other"]);
    expect(rows[0]).toMatchObject({ page: { name: "Experiment Page", path: "/draft/experiment" }, how: "Changed by the builder · Edited by hand · Changed by a developer", guess: true, by: "brooklyn" });
  });
  it("maps components and objects to extra unique pages, without adding a shared label to direct rows", () => {
    const parsed = parseReviewPages(data);
    if (!parsed) throw new Error("invalid fixture");
    const rows = relayChangedPages(parsed, [], { MailchimpForm: [{ name: "Contact", path: "/contact" }, { name: "Experiment", path: "/draft/experiment" }], Footer: [{ name: "Contact", path: "/contact" }, { name: "Home", path: "/home" }] }, []);
    expect(rows.map((r) => r.key)).toEqual(["page:/draft/experiment", "page:/contact", "page:/", "other"]);
    expect(rows[1].how).toBe("Shared piece: MailchimpForm · Shared piece: Footer");
    expect(rows[0].how).not.toContain("Shared piece");
  });
  it("an empty answered endpoint never adds platform, rejected or viewed-page requests", () => {
    const parsed = parseReviewPages({ ...data, rows: [], components: [], objects: [], sitewide: { files: [] } });
    if (!parsed) throw new Error("invalid fixture");
    expect(relayChangedPages(parsed, [], {}, [req({ source: "platform", page: { name: "Contact", path: "/contact" } }), req({ decision: { reason: "No" }, page: { name: "Gone", path: "/gone" } })])).toEqual([]);
  });
});
describe("internal link status", () => {
  const pages = [{ name: "Ready", path: "/r", build_status: "ready" }, { name: "Draft", path: "/d", build_status: "draft" }];
  it("uses the Manager page list", () => {
    expect(internalLinkChip("/r?x=1", pages).text).toBe("Page found");
    expect(internalLinkChip("/d", pages).text).toBe("Draft");
    expect(internalLinkChip("/nope", pages)).toEqual({ text: "Page not found", tone: "bad" });
  });
});
describe("checklist", () => {
  it("always requires four manual attestations even when prior steps are complete", () => {
    const items = checklistItems([], false, true, true);
    expect(items.map(i => i.id)).toEqual(["pages", "links", "phone", "unintended"]);
    expect(items.every(i => !i.locked)).toBe(true);
  });
  it("says what is left", () => {
    expect(remaining(2, 0, 0)).toBe("2 pages left to check");
    expect(remaining(0, 0, 0)).toBeNull();
  });
});
describe("link listing", () => {
  it("rejects unusable bodies", () => {
    expect(parseReviewLinks({ ok: false })).toBeNull();
    expect(parseReviewLinks({ ok: true, groups: [{ label: "A", page: null, links: [{ href: "https://x", kind: "external", status: { state: "broken" } }] }], unread: 2 })?.unread).toBe(2);
  });
});

import { dropRevertedHandEdits as dropRH, countHandEdits as countHE } from "../submitWalkthrough";
describe("reverted hand edits", () => {
  const row = (path: string, how: string) => ({ key: "page:" + path, page: { name: path, path }, how });
  it("hides a hand-edit-only page with no remaining edits", () => {
    const pages = [{ name: "Contact", path: "/contact", build_status: "ready", handEdits: countHE({}) }, { name: "Team", path: "/team", build_status: "ready", handEdits: countHE({ "orig:a": "x", a: "y" }) }];
    const out = dropRH([row("/contact", "Edited by hand"), row("/team", "Edited by hand"), row("/contact2", "Edited by hand")], pages);
    expect(out.map((r) => r.page!.path)).toEqual(["/team", "/contact2"]);
    expect(dropRH([row("/contact", "Edited by hand · Changed by the builder")], pages)).toHaveLength(1);
    expect(countHE({ "orig:a": "x" })).toBe(0);
  });
});
