import { describe, expect, it } from "vitest";
import { changedPages, checklistItems, internalLinkChip, parseReviewLinks, remaining } from "../submitWalkthrough";

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
  it("collapses page-less changes into one row, skipping platform and zero-site-file requests", () => {
    const rows = changedPages([
      req({ id: "a", request: "Hours" }), req({ id: "b", request: "Fonts", siteFiles: 3 }),
      req({ id: "c", source: "platform" }), req({ id: "d", siteFiles: 0 }),
    ] as any, {});
    expect(rows).toEqual([{ key: "other", page: null, how: "2 changes that aren't tied to one page", count: 2 }]);
    expect(changedPages([req({ source: "platform" })], {})).toEqual([]);
  });
});
describe("internal link status", () => {
  const pages = [{ name: "Ready", path: "/r", build_status: "ready" }, { name: "Draft", path: "/d", build_status: "draft" }];
  it("uses the Manager page list", () => {
    expect(internalLinkChip("/r?x=1", pages).text).toBe("Page found");
    expect(internalLinkChip("/d", pages).text).toBe("Page isn't published yet");
    expect(internalLinkChip("/nope", pages)).toEqual({ text: "Page not found", tone: "bad" });
  });
});
describe("checklist", () => {
  it("names at most three pages and hides the links item without links", () => {
    const rows = ["A", "B", "C", "D", "E"].map((n) => ({ key: n, page: { name: n, path: "/" + n }, how: "" }));
    const items = checklistItems(rows, false, true, true);
    expect(items[0].todo).toBe("Check the changed pages (A, B, C and 2 more).");
    expect(items[0].done).toBe("I checked the changed pages (A, B, C and 2 more).");
    expect(items.some((i) => i.id === "links")).toBe(false);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(checklistItems([...rows, { key: "other", page: null, how: "" }], false, true, true)[0].todo).not.toContain("Other");
    expect(checklistItems([{ key: "other", page: null, how: "" }], false, true, true).some((i) => i.id === "pages")).toBe(false);
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
