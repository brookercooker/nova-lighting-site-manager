import { publicLinkAddress } from "../linkDisplay";
import type { ReviewLink, ReviewLinks } from "./submitWalkthrough";
import { isSiteLink } from "./siteLink";

/** Coded originalHref is not a published baseline. null explicitly means absent from a complete live inventory. */
export function publishedComparison(link: ReviewLink): "unknown" | "unchanged" | "changed" {
  if (link.publishedHref === undefined) return "unknown";
  return link.publishedHref !== null && publicLinkAddress(link.href) === publicLinkAddress(link.publishedHref) ? "unchanged" : "changed";
}
export function comparedReviewLinks(base: ReviewLinks): ReviewLinks {
  return { ...base, groups: base.groups.map(g => ({ ...g, links: g.links.filter(l => isSiteLink(l.href) && publishedComparison(l) !== "unchanged") })).filter(g => g.links.length) };
}