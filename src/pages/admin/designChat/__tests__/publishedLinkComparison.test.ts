import { expect, it } from "vitest";
import { comparedReviewLinks, publishedComparison } from "../publishedLinkComparison";
import { diffInventories } from "../linkInventory";
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