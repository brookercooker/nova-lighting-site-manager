import { normPath, type ReviewLink, type ReviewLinks } from "./submitWalkthrough";

/** Original inventory position is stable across destination edits; fingerprints remain approval guards, not row ids. */
export function reviewLinkIdentity(link: ReviewLink, path: string): string {
  return link.elementKey && link.scope ? `${link.scope.startsWith("object:") ? "" : normPath(path) + "|"}${link.scope}|${link.elementKey}` : link.key;
}
export function stableReviewRows(base: ReviewLinks): ReviewLinks {
  return { ...base, groups: base.groups.map(g => {
    const rows = new Map<string, ReviewLink>();
    for (const link of g.links) { const key = reviewLinkIdentity(link, g.page?.path ?? "/"); rows.set(key, { ...link, key }); }
    return { ...g, links: [...rows.values()] };
  }) };
}