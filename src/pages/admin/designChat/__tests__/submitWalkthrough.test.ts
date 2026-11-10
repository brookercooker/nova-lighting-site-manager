import { describe, expect, it } from "vitest";
import { changedPages, checklistItems, internalLinkChip, parseReviewLinks, remaining } from "../submitWalkthrough";

const req = (o: any) => ({ id: o.id ?? "r", request: o.request ?? "Make it nicer", ...o });
describe("changed pages", () => {
  it("de-duplicates by path, adds shared-object pages and skips rejected and undo requests", () => {
    const rows = changedPages([
      req({ id: "1", pages: [{ name: "About", path: "/about" }, { name: "Home", path: "/home" }] }),
      req({ id: "2", page: { name: "About", path: "/about" } }),
      req({ id: "3", objects: ["Footer"] }),
      req({ id: "4", page: { name: "Gone", path: "/gone" }, decision: { reason: "No" } }),
      req({ id: "5", page: { name: "Undo", path: "/undo" }, isUndo: true }),
      req({ id: "6", request: "Change the hours" }),
    ], { Footer: [{ name: "Home", path: "/" }, { name: "Brands", path: "/brands" }] });
    expect(rows.map((r) => r.key)).toEqual(["page:/about", "page:/", "page:/brands", "req:6"]);
    expect(rows[2].via).toBe("Footer");
    expect(rows[1].via).toBeUndefined();
    expect(rows[3].page).toBeNull();
  });
  it("labels hand edits", () => {
    expect(changedPages([req({ source: "content", page: { name: "A", path: "/a" } })], {})[0].what).toBe("Edited by hand");
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
    const rows = ["A", "B", "C", "D", "E"].map((n) => ({ key: n, page: { name: n, path: "/" + n }, what: "" }));
    const items = checklistItems(rows, false, true, true);
    expect(items[0].todo).toBe("I will check the changed pages (A, B, C and 2 more).");
    expect(items[0].done).toBe("I checked the changed pages (A, B, C and 2 more).");
    expect(items.some((i) => i.id === "links")).toBe(false);
    expect(items.length).toBeLessThanOrEqual(5);
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
