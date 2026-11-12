import { describe, expect, it } from "vitest";
import { blockChangeLines, inlineChangeLines, mergeChangeLines } from "../changeLines";

const h1 = { tag: "h1", text: "Light transforms everything.", style: { fontSize: "88px", fontFamily: "\"Cormorant Garamond\", serif" } };
const noCss = (lines: string[]) => lines.forEach(l => expect(l).not.toMatch(/font-size|font-family|style:|html:|fp:|objectSwap|\b0\.1\b|[{}]/));

describe("change lines", () => {
  it("describes a wording change with old → new text", () => {
    const lines = inlineChangeLines("Homepage", { "fp:0.1": "x" }, { "0.1": "Light changes everything.", "fp:0.1": "y" }, { "0.1": h1 });
    expect(lines).toEqual(['Homepage: changed the heading "Light transforms everything." to "Light changes everything."']);
  });
  it("merges several style edits on one element into one line, with plain names and units", () => {
    const lines = inlineChangeLines("Homepage", {}, { "style:0.1": JSON.stringify({ "font-size": "90px", "font-family": "Figtree, sans-serif" }) }, { "0.1": h1 });
    expect(lines).toEqual(['Homepage: heading "Light transforms everything." text size 88 → 90 px, font Cormorant Garamond → Figtree']);
    noCss(lines);
  });
  it("uses the previous saved value as old and ignores layout helpers", () => {
    const before = { "style:2": JSON.stringify({ color: "red" }) };
    const after = { "style:2": JSON.stringify({ color: "blue", display: "flex" }) };
    expect(inlineChangeLines("About", before, after, { "2": { tag: "p", text: "Hi" } })).toEqual(['About: paragraph "Hi" text colour red → blue']);
  });
  it("describes links, pictures and long text with an ellipsis", () => {
    const lines = inlineChangeLines("Homepage", {}, { "link:3": JSON.stringify({ href: "/sale" }), "img:4": "/a.webp" },
      { "3": { tag: "a", kind: "button", text: "See What's Possible" }, "4": { tag: "img", text: "" } });
    expect(lines).toContain('Homepage: Changed link: See What\'s Possible to /sale');
    expect(lines).toContain("Homepage: replaced the picture");
    const long = inlineChangeLines("P", { "1": "x".repeat(80) }, { "1": "y" })[0];
    expect(long).toContain("…");
  });
  it("describes made copies by the original name", () => {
    expect(inlineChangeLines("Homepage", {}, { "objectSwap:cats": "id-9" }, {}, { cats: "Categories" })).toEqual(['Homepage: made its own copy of "Categories"']);
  });
  it("describes added, removed and moved sections", () => {
    const a = { id: "a", type: "object", name: "About Us" }, b = { id: "b", type: "image", url: "/x/b.webp" }, v = { id: "v", type: "object", name: "Visit Us" };
    expect(blockChangeLines("Homepage", [a, b, v], [b, a])).toEqual([
      'Homepage: removed the object "Visit Us"', 'Homepage: moved the object "About Us" down',
    ]);
    expect(blockChangeLines("Homepage", [a], [a, { id: "t", type: "object", name: "Team Preview" }])).toEqual(['Homepage: added the object "Team Preview"']);
    expect(blockChangeLines("Homepage", [a], [{ id: "a", type: "object", name: "About Us" }, { id: "page-content", type: "page" }])).toEqual(['Homepage: moved the object "About Us" up']);
  });
  it("merges lines from several saves without duplicates, capped at 30", () => {
    expect(mergeChangeLines(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeChangeLines(Array.from({ length: 40 }, (_, i) => `l${i}`))).toHaveLength(30);
  });
});
