import { expect, it } from "vitest";
import { comparedReviewLinks, publishedComparison } from "../publishedLinkComparison";
import { diffInventories, reviewPageInventory, loadNetLinks, parseInventory } from "../linkInventory";
import type { ReviewLink } from "../submitWalkthrough";
const link: ReviewLink = { key: "/|page|0", href: "/contact", kind: "internal", label: "Card link", requestIds: [], status: null };
it("excludes unknown published baselines, even when the coded original differs", () => {
  expect(publishedComparison({ ...link, originalHref: "/gallery" })).toBe("unknown");
});
it("excludes both restored Homepage card and consultation destinations", () => {
  const base = { unread: 0, partial: false, truncated: false, groups: [{ page: { name: "Homepage", path: "/" }, label: "Homepage", links: [{ ...link, publishedHref: "/contact" }, { ...link, key: "consultation", label: "Book a Consultation", publishedHref: "/contact" }, { ...link, key: "image", href: "/gallery", publishedHref: "/contact" }] }] };
  expect(comparedReviewLinks(base).groups[0].links.map(l => l.key)).toEqual(["image"]);
});
it("a complete published inventory proves a new link, unlike a missing baseline", () => {
  const links = diffInventories({ path: "/", links: [{ key: "0", scope: "page", href: "/contact", label: "Contact" }] }, { path: "/", links: [] });
  expect(links[0].publishedHref).toBeNull();
  expect(publishedComparison({ ...link, publishedHref: links[0].publishedHref })).toBe("changed");
});
const pricing = { path: "/draft/pricing", links: [
  { key: "0", scope: "page", href: "/brands", label: "Discuss pricing", originalHref: "/contact" },
  { key: "1", scope: "page", href: "/contact", label: "Contact" },
  { key: "2", scope: "page", href: "/gallery", label: "Gallery" },
  { key: "0", scope: "object:Header", href: "/contact", label: "Contact" },
  { key: "0", scope: "object:Footer", href: "/brands", label: "Brands" },
] };
it("verifies all three real page-owned links on an explicitly never-published Pricing page", () => {
  const result = reviewPageInventory(pricing, { path: pricing.path, published: false, links: pricing.links });
  expect(result.map(l => l.href)).toEqual(["/brands", "/contact", "/gallery"]);
  expect(result.every(l => l.publishedHref === null && l.originalHref === undefined)).toBe(true);
});
it("falls back to all page-owned links when the published version cannot be determined", () => {
  expect(reviewPageInventory(pricing, null).map(l => l.key)).toEqual(["0", "1", "2"]);
});
it("keeps net-zero filtering for a published page", () => {
  expect(reviewPageInventory(pricing, pricing)).toEqual([]);
});
it("retains authoritative published comparisons even when the live frame is unavailable", () => {
  expect(reviewPageInventory({ path: "/", links: [
    { key: "0", scope: "page", href: "/contact", publishedHref: "/contact", label: "Restored" },
    { key: "1", scope: "page", href: "/brands", publishedHref: "/gallery", label: "Changed" },
  ] }, null).map(link => link.key)).toEqual(["1"]);
});
it("accepts explicit publication absence only from a validated inventory payload", () => {
  expect(parseInventory({ source: "nova-site", type: "link-inventory", v: 1, ...pricing, published: false })?.published).toBe(false);
});
it("loads Pricing independently when the first changed page does not answer", async () => {
  const result = await loadNetLinks(["/", pricing.path], null, async url => new URL(url).pathname === pricing.path ? pricing : null);
  expect(result[pricing.path].map(l => l.href)).toEqual(["/brands", "/contact", "/gallery"]);
});