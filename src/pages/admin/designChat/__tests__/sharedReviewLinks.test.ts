import { describe, expect, it } from "vitest";
import { addSharedChromeRows, mergeSharedReviewLinks, stableReviewEdits } from "../sharedReviewLinks";
import { changeFingerprint } from "../submitWalkthrough";

const pages = [{ name: "About", path: "/about", build_status: "ready" }, { name: "Homepage", path: "/", build_status: "ready" }];
const base = { groups: [], unread: 0, partial: false, truncated: false };
describe("shared review links", () => {
  it("adds one Site Footer visual-review item for 37 pages, ignoring fingerprint-only restores", () => {
    const uses = Array.from({ length: 37 }, (_, i) => ({ name: `Page ${i}`, path: `/page-${i}`, build_status: "ready" }));
    const footer = { id: "footer", name: "Site Footer", pages: [], inlineEdits: { "link:0.1": '{"href":"/team"}' } };
    const rows = addSharedChromeRows([], [footer], uses);
    expect(rows).toHaveLength(1);
    expect(rows[0].how).toBe("Shared piece: Site Footer · used on 37 pages");
    expect(rows[0].shared?.pages).toHaveLength(37);
    expect(addSharedChromeRows([], [{ ...footer, inlineEdits: { "fp:0.1": "original" } }], uses)).toEqual([]);
    expect(mergeSharedReviewLinks(base, [footer], uses).groups[0].label).toBe("Shared: Site Footer");
  });
  it("lists coded Header changes once even without manual overrides", () => {
    const rows = addSharedChromeRows([{ key: "page:/", page: pages[1], how: "Shared piece: Header" }], [{ id: "header", name: "Site Header", componentKey: "Header", pages, inlineEdits: {} }], pages, ["Header"]);
    expect(rows.map(row => row.key)).toEqual(["shared:header"]);
  });
  it("lists the About Us location-to-contact override once across About and Homepage", () => {
    const result = mergeSharedReviewLinks(base, [{ id: "about-us", name: "About Us", inlineEdits: { "link:0.1": '{"href":"/contact"}' }, pages }], pages);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].shared?.pages.map(p => p.name)).toEqual(["About", "Homepage"]);
    expect(result.groups[0].links).toEqual([expect.objectContaining({ href: "/contact", scope: "object:about-us", elementKey: "0.1", key: "object:about-us|0.1|/contact" })]);
  });
  it.each(["Header", "Footer"])("includes %s object overrides and deduplicates inventory copies", name => {
    const link = { key: "/|/contact", href: "/contact", kind: "internal" as const, label: "Find a Location", requestIds: [], status: null, scope: "object:chrome", elementKey: "0.1" };
    const result = mergeSharedReviewLinks({ ...base, groups: pages.map(page => ({ page, label: page.name, links: [link] })) }, [{ id: "chrome", name, pages, inlineEdits: { "link:0.1": '{"href":"/contact"}' } }], pages);
    expect(result.groups.flatMap(g => g.links)).toHaveLength(1);
    expect(result.groups[0].links[0].label).toBe("Find a Location");
  });
  it("keeps distinct shared elements with the same destination separate", () => {
    const result = mergeSharedReviewLinks(base, [{ id: "about-us", name: "About Us", pages, inlineEdits: { "link:0.1": '{"href":"/contact"}', "link:0.2": '{"href":"/contact"}' } }], pages);
    expect(new Set(result.groups[0].links.map(l => l.key)).size).toBe(2);
  });
  it("fingerprint metadata arrival does not invalidate unchanged visual approvals", () => {
    const before = changeFingerprint(stableReviewEdits({ "link:0.1": '{"href":"/contact"}' }));
    expect(changeFingerprint(stableReviewEdits({ "fp:0.1": "newly reported fingerprint", "orig:0.1": "original text", "link:0.1": '{"href":"/contact"}' }))).toBe(before);
    expect(changeFingerprint(stableReviewEdits({ "link:0.1": '{"href":"/locations"}' }))).not.toBe(before);
  });
});