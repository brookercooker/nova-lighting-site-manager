import { normPath, type PageRef, type ReviewLinks, type ReviewLink, type ManagerPage, type ChangedRow } from "./submitWalkthrough";

export type SharedReviewObject = { id: string; name: string; componentKey?: string; inlineEdits: unknown; content?: unknown; pages: PageRef[] };
/** One stored object link per scope/key, regardless of how many pages render it. */
export function mergeSharedReviewLinks(base: ReviewLinks, objects: SharedReviewObject[], pages: ManagerPage[]): ReviewLinks {
  const groups = base.groups.map(g => ({ ...g, links: [...g.links] }));
  for (const object of objects) {
    const locations = object.pages.length ? object.pages : /^(?:Site )?(?:Header|Footer)$/i.test(object.name) ? pages : [];
    const uses = [...new Map<string, PageRef>(locations.map(p => [normPath(p.path), { path: normPath(p.path), name: pages.find(m => normPath(m.path) === normPath(p.path))?.name ?? p.name }] as const)).values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!uses.length || !object.inlineEdits || typeof object.inlineEdits !== "object") continue;
    const links = new Map<string, ReviewLink>();
    const scope = `object:${object.id}`;
    for (const g of groups) {
      for (const l of g.links.filter(l => l.scope === scope && l.elementKey)) links.set(l.elementKey ?? "", { ...l, key: `${scope}|${l.elementKey}|${l.href}` });
      g.links = g.links.filter(l => l.scope !== scope);
    }
    for (const [key, value] of Object.entries(object.inlineEdits)) {
      if (!/^link:\d+(?:\.\d+)*$/.test(key) || typeof value !== "string") continue;
      try {
        const override = JSON.parse(value);
        if (override.unlinked || typeof override.href !== "string" || !override.href) continue;
        const elementKey = key.slice(5), href = override.href;
        const prior = links.get(elementKey);
        const kind = /^mailto:/i.test(href) ? "mail" : /^tel:/i.test(href) ? "phone" : href.startsWith("#") ? "anchor" : /^\/(?!\/)/.test(href) ? "internal" : "external";
        links.set(elementKey, { ...prior, key: `${scope}|${elementKey}|${href}`, href, kind, elementKey, scope, target: override.target === "_blank" ? "_blank" : null, label: prior?.label ?? null, requestIds: prior?.requestIds ?? [], status: prior?.status ?? null });
      } catch { /* malformed stored overrides never authorize a write */ }
    }
    if (links.size) groups.push({ page: uses[0], shared: { id: object.id, name: object.name, pages: uses }, label: `Shared: ${object.name}`, links: [...links.values()] });
  }
  return { ...base, groups: groups.filter(g => g.links.length) };
}

/** Site chrome is reviewed once on a representative page, not once per usage. */
export function addSharedChromeRows(rows: ChangedRow[], objects: SharedReviewObject[], pages: ManagerPage[], changedNames: string[] = []): ChangedRow[] {
  const chrome = objects.filter(object => /^(?:Site )?(?:Header|Footer)$/i.test(object.name) && (Object.keys(stableReviewEdits(object.inlineEdits) as object).length > 0 || changedNames.includes(object.name) || !!object.componentKey && changedNames.includes(object.componentKey)));
  const remaining = rows.filter(row => !chrome.some(object => row.how === `Shared piece: ${object.name}` || row.how === `Shared piece: ${object.componentKey}`));
  return [...remaining, ...chrome.map(object => {
    const uses = object.pages.length ? object.pages : pages;
    return { key: `shared:${object.id}`, page: uses[0] ?? null, shared: { id: object.id, name: object.name, pages: uses }, how: `Shared piece: ${object.name} · used on ${uses.length} pages` };
  })];
}

/** Fingerprint metadata arrival is not a visual edit; actual override/content changes remain authoritative. */
export function stableReviewEdits(edits: unknown): unknown {
  if (!edits || typeof edits !== "object" || Array.isArray(edits)) return edits ?? {};
  return Object.fromEntries(Object.entries(edits).filter(([key]) => !key.startsWith("fp:") && !key.startsWith("orig:")));
}