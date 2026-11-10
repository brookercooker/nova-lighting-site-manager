import { describe, expect, it } from "vitest";
import { groupLinkRows, isScannablePath, linkMatches } from "../linkAuditGroups";

const row = (i: number, o: Partial<{ location: string; destination: string; status: string; link_text: string }> = {}) =>
  ({ id: `r${i}`, location: "/", destination: "/full-vendor-list", status: "Registered", link_text: `Vendor ${i}`, ...o });

describe("groupLinkRows", () => {
  it("collapses 157 same-destination links into one group of 157", () => {
    const items = groupLinkRows(Array.from({ length: 157 }, (_, i) => row(i)));
    expect(items).toHaveLength(1);
    expect(items[0].kind === "group" && items[0].rows.length).toBe(157);
  });
  it("keeps 4 matching links as separate rows", () => {
    const items = groupLinkRows(Array.from({ length: 4 }, (_, i) => row(i)));
    expect(items.map((i) => i.kind)).toEqual(["row", "row", "row", "row"]);
  });
  it("never merges different statuses or locations", () => {
    const rows = [...Array.from({ length: 5 }, (_, i) => row(i)), ...Array.from({ length: 5 }, (_, i) => row(10 + i, { status: "Pending" })),
      ...Array.from({ length: 5 }, (_, i) => row(20 + i, { location: "/about" }))];
    const items = groupLinkRows(rows);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.kind === "group" && i.rows.length === 5)).toBe(true);
  });
  it("search matches link text inside a group", () => {
    const rows = Array.from({ length: 157 }, (_, i) => row(i));
    expect(rows.filter((r) => linkMatches(r, "vendor 42"))).toHaveLength(1);
    const items = groupLinkRows(rows.filter((r) => linkMatches(r, "vendor")));
    expect(items).toHaveLength(1);
  });
});

describe("isScannablePath", () => {
  it("excludes the wildcard Not Found route and parameter routes", () => {
    expect(isScannablePath("*")).toBe(false);
    expect(isScannablePath("/blog/*")).toBe(false);
    expect(isScannablePath("/products/:id")).toBe(false);
    expect(isScannablePath("/")).toBe(true);
    expect(isScannablePath("/full-vendor-list")).toBe(true);
  });
});
