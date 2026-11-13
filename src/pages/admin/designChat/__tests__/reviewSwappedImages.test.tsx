import { beforeEach, describe, expect, it } from "vitest";
import { diffInventories, netReviewLinks, type Inventory } from "../linkInventory";
import { mergeReviewLinks, changeFingerprint, type ReviewLinks, type ReviewLink } from "../submitWalkthrough";
import { mergeSavedReviewLinks } from "../useWalkthroughData";
import { stableReviewRows } from "../reviewLinkIdentity";
import { groupRisks } from "../linkRisk";
import { walk } from "../submitWalkthroughStore";

const labels = ["Softly lit living room with layered lighting", "Home plans and lighting design options", "Book a Consultation"];
const live: Inventory = { path: "/", links: labels.map((label, i) => ({ key: `0.${i}`, scope: "page", href: i === 0 ? "/inspiration-gallery" : "/contact", label, target: null, ...(i < 2 ? { image: { alt: label, src: `https://example.com/${i}.jpg` } } : {}) })) };
const base: ReviewLinks = { groups: [], unread: 0, partial: false, truncated: false };
const pages = [{ name: "Homepage", path: "/", build_status: "ready" }];
const draft = (href: string): Inventory => ({ path: "/", links: live.links.map((l, i) => ({ ...l, originalHref: l.href, href: i === 0 ? "/contact" : i === 1 ? "/inspiration-gallery" : href })) });
const rebuild = (href: string) => stableReviewRows(netReviewLinks(base, { "/": diffInventories(draft(href), live) }, pages));
const prints = (rows: ReviewLinks) => Object.fromEntries(rows.groups.flatMap(g => g.links.map(l => [l.key, changeFingerprint({ href: l.href, key: l.key })])));
function assertImages(rows: ReviewLinks, count: number) {
  const group = rows.groups[0]; expect(group.links).toHaveLength(count);
  const [a, b] = group.links;
  expect(a).toMatchObject({ key: "/|page|0.0", label: labels[0], image: live.links[0].image, originalHref: "/inspiration-gallery", href: "/contact" });
  expect(b).toMatchObject({ key: "/|page|0.1", label: labels[1], image: live.links[1].image, originalHref: "/contact", href: "/inspiration-gallery" });
  const risks = groupRisks(group, Object.fromEntries(group.links.map(l => [l.key, l.label ?? ""])), [], []);
  expect(risks[a.key].find(f => f.kind === "swap")?.otherKey).toBe(b.key);
  expect(risks[b.key].find(f => f.kind === "swap")?.otherKey).toBe(a.key);
  expect(walk.get().changed).toEqual([]);
}
beforeEach(() => walk.reset());
describe("Homepage swapped image regression", () => {
  it("edits the consultation three times and restores without touching either image, then rebuilds after reload", () => {
    let rows = rebuild("https://google.com"); assertImages(rows, 3);
    for (const href of ["https://google.com/maps", "/about", "https://google.com/three", "/contact"]) {
      const group = rows.groups[0]; const third = group.links.find(l => l.elementKey === "0.2"); if (!third) throw new Error("missing consultation");
      walk.editLink({ link: third, group, rows: [], fingerprint: "third" });
      // Historical destination keys must not replace the image sharing /contact.
      walk.savedLink("/", { ...third, key: "/|/contact", href });
      rows = stableReviewRows(mergeSavedReviewLinks(rows, walk.get().savedReviewLinks.map(x => ({ ...x, replacedKeys: [...(x.replacedKeys ?? []), "/|page|0.0"] })), pages, {}));
      const own = prints(rows); walk.reconcile({}, own, own); assertImages(rows, 3);
    }
    rows = stableReviewRows(mergeSavedReviewLinks(rebuild("/contact"), walk.get().savedReviewLinks, pages, { "/": diffInventories(draft("/contact"), live) }));
    assertImages(rows, 2);
    walk.restoreSession(); expect(walk.get().savedReviewLinks).toEqual([]);
    const persisted = JSON.parse(JSON.stringify(draft("/contact"))) as Inventory;
    rows = stableReviewRows(netReviewLinks(base, { "/": diffInventories(persisted, live) }, pages));
    const own = prints(rows); walk.reconcile({}, own, own); assertImages(rows, 2);
  });
  it("stored overrides with a common destination do not borrow each other's element key or label", () => {
    const rows = rebuild("https://google.com");
    const result = stableReviewRows(mergeReviewLinks(rows, [{ ...pages[0], inlineEdits: { "link:0.0": '{"href":"/contact"}', "link:0.1": '{"href":"/inspiration-gallery"}', "link:0.2": '{"href":"/contact"}' } }], new Set(["/"])));
    assertImages(result, 3); expect(result.groups[0].links[2].label).toBe(labels[2]);
  });
  it("keeps distinct same-destination elements and disambiguates duplicate fallback inventory keys", () => {
    const d: Inventory = { path: "/", links: [draft("/other").links[0], { ...draft("/other").links[1], key: "0.0", href: "/contact" }] };
    const result = stableReviewRows(netReviewLinks(base, { "/": diffInventories(d, { path: "/", links: live.links.slice(0,2).map(l => ({ ...l, key: "0.0" })) }) }, pages));
    expect(result.groups[0].links.map(l => l.key)).toEqual(["/|page|0.0|index:0"]);
    const both = stableReviewRows(netReviewLinks(base, { "/": diffInventories(d, { path: "/", links: [] }) }, pages));
    expect(both.groups[0].links.map(l => l.key)).toEqual(["/|page|0.0|index:0", "/|page|0.0|index:1"]);
  });
  it("warns only for an actual previous approval whose own fingerprint changed", () => {
    const rows = rebuild("https://google.com"), own = prints(rows);
    walk.reconcile({}, own, own); expect(walk.get().changed).toEqual([]);
    walk.confirmLink(rows.groups[0].links[0].key, own[rows.groups[0].links[0].key], true);
    const next = { ...own, [rows.groups[0].links[0].key]: "new fingerprint" };
    walk.reconcile({}, next, next); expect(walk.get().changed).toEqual([rows.groups[0].links[0].key]);
  });
  it("computes swaps from unchanged inventory partners without adding them to review", () => {
    const a = rebuild("/contact").groups[0].links[0];
    const b = { ...draft("/contact").links[1], inventoryPath: "/" };
    const group = { page: pages[0], label: "Homepage", links: [a] };
    const risks = groupRisks(group, {}, [], [], [b]);
    expect(risks[a.key].find(f => f.kind === "swap")?.reason).toBe(`Looks swapped with ${labels[1]}`);
    expect(group.links).toHaveLength(1);
    expect(groupRisks(group, {}, [], [], [{ ...b, inventoryPath: "/about" }])[a.key].some(f => f.kind === "swap")).toBe(false);
  });
});