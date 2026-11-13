import { normPath, type ReviewLink, type ReviewLinks } from "./submitWalkthrough";

/** Original inventory position is stable across destination edits; fingerprints remain approval guards, not row ids. */
export function reviewLinkIdentity(link: ReviewLink, path: string): string {
  return link.elementKey && link.scope ? `${link.scope.startsWith("object:") ? "" : normPath(path) + "|"}${link.scope}|${link.elementKey}${link.inventoryIndex === undefined ? "" : `|index:${link.inventoryIndex}`}` : `${normPath(path)}|legacy:${link.key}`;
}
export function sameReviewLink(a: ReviewLink, b: ReviewLink, path: string): boolean {
  if (a.elementKey || b.elementKey) return !!a.elementKey && !!b.elementKey && reviewLinkIdentity(a, path) === reviewLinkIdentity(b, path);
  return a.key === b.key;
}
export function stableReviewRows(base: ReviewLinks): ReviewLinks {
  return { ...base, groups: base.groups.map(g => {
    const rows = new Map<string, ReviewLink>();
    for (const link of g.links) { const key = link.elementKey ? reviewLinkIdentity(link, g.page?.path ?? "/") : link.key; const prior = rows.get(key); rows.set(key, { ...prior, ...link, label: link.label || prior?.label || null, originalHref: link.originalHref ?? prior?.originalHref, visibleText: link.visibleText || prior?.visibleText, image: link.image || prior?.image, key }); }
    return { ...g, links: [...rows.values()] };
  }) };
}