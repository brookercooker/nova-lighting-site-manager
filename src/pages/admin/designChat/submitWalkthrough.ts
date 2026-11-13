import type { DraftRequest } from "./helper";

/** Pure rules for the Submit for Review walkthrough (pages, links, checklist). */
export type PageRef = { name: string; path: string; sharedChange?: unknown };
export type ChangedRow = { key: string; page: PageRef | null; how: string; count?: number; guess?: boolean; by?: string; fingerprint?: string; shared?: { id: string; name: string; pages: PageRef[] } };
export const OTHER_KEY = "other";
export type ManagerPage = { name: string; path: string; build_status: string; handEdits?: number; inlineEdits?: unknown; content?: unknown };
/** Count of stored hand edits, ignoring orig: baseline metadata; undefined when unknown. */
export function countHandEdits(inline: unknown): number | undefined {
  if (!inline || typeof inline !== "object" || Array.isArray(inline)) return inline == null ? 0 : undefined;
  return Object.keys(inline).filter((k) => !k.startsWith("orig:") && !k.startsWith("fp:")).length;
}
/** Drop pages whose only change is a hand edit that has since been fully undone (stored hand edits now empty). */
export function dropRevertedHandEdits(rows: ChangedRow[], pages: ManagerPage[]): ChangedRow[] {
  return rows.filter((r) => {
    if (!r.page || r.how !== "Edited by hand") return true;
    const m = pages.find((p) => normPath(p.path) === normPath(r.page!.path));
    return !(m && m.handEdits === 0);
  });
}
export type LinkKind = "internal" | "external" | "mail" | "phone" | "anchor";
export type RelayLinkStatus = { state: "ok" | "redirect" | "broken" | "unconfirmed"; detail?: string } | null;
export type ReviewLink = { key: string; href: string; kind: LinkKind; label: string | null; ariaLabel?: string; target?: "_blank" | null; elementKey?: string; scope?: string; requestIds: string[]; status: RelayLinkStatus };
export type LinkGroup = { page: PageRef | null; label: string; links: ReviewLink[]; shared?: { id: string; name: string; pages: PageRef[] } };
export type ReviewLinks = { groups: LinkGroup[]; unread: number; partial: boolean; truncated: boolean };
/** Stable value fingerprint; object key order is not a change. */
export function changeFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(changeFingerprint).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${changeFingerprint(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export type Chip = { text: string; tone: "ok" | "warn" | "bad"; detail?: string };

const validPage = (p: unknown): p is PageRef => !!p && typeof p === "object" && typeof (p as PageRef).name === "string"
  && typeof (p as PageRef).path === "string" && (p as PageRef).path.startsWith("/");
export const normPath = (path: string) => {
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return bare === "/home" ? "/" : bare;
};
export const isRejected = (r: DraftRequest) => r.decision != null && typeof r.decision === "object";

const SOURCE_LABEL: Record<string, string> = { content: "Edited by hand", chat: "Changed by the builder", developer: "Changed by a developer" };
function sourceLabel(r: DraftRequest): string | null {
  const src = r.source ?? "chat";
  return SOURCE_LABEL[src] ?? (src === "platform" || src === "setup" ? null : "Changed by the builder");
}
export type ReviewPages = {
  rows: (PageRef & { how: string[]; requestIds: string[]; guess?: boolean })[];
  components: { name: string; requestIds: string[] }[];
  objects: { name: string; requestIds: string[] }[];
  sitewide: { files: string[]; requestIds: string[] };
};
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
export const requestAuthor = (by: unknown): string | null => typeof by === "string" && by.includes("@") && by.split("@")[0].trim() ? by.split("@")[0].trim() : null;

export function parseReviewPages(d: any): ReviewPages | null {
  if (!d || d.ok !== true || !Array.isArray(d.rows) || !Array.isArray(d.components) || !Array.isArray(d.objects) || !d.sitewide || !Array.isArray(d.sitewide.files)) return null;
  const pieces = (v: any[]) => v.filter((p) => p && typeof p.name === "string").map((p) => ({ name: p.name, requestIds: strings(p.requestIds) }));
  return {
    rows: d.rows.filter(validPage).map((p: any) => ({ name: p.name, path: p.path, how: strings(p.how), requestIds: strings(p.requestIds), guess: p.guess === true })),
    components: pieces(d.components), objects: pieces(d.objects), sitewide: { files: strings(d.sitewide.files), requestIds: strings(d.sitewide.requestIds) },
  };
}

/** An answered endpoint is authoritative: never add the viewed page or infer rows from requests. */
export function relayChangedPages(data: ReviewPages, pages: ManagerPage[], usages: Record<string, PageRef[]>, requests: DraftRequest[] | undefined): ChangedRow[] {
  const rows = new Map<string, ChangedRow>();
  const by = (ids: string[]) => [...new Set((requests ?? []).filter((r) => ids.includes(r.id) && !isRejected(r)).map((r) => requestAuthor(r.by)).filter(Boolean))].join(", ");
  const pageName = (p: PageRef): PageRef => ({ path: normPath(p.path), name: pages.find((m) => normPath(m.path) === normPath(p.path))?.name ?? p.name });
  for (const p of data.rows) {
    const key = "page:" + normPath(p.path);
    const prior = rows.get(key);
    const labels = p.how.map((h) => SOURCE_LABEL[h]).filter(Boolean);
    rows.set(key, { key, page: pageName(p), how: [...new Set([...(prior?.how ? prior.how.split(" · ") : []), ...labels])].join(" · "), guess: prior?.guess || p.guess, by: [...new Set([prior?.by, by(p.requestIds)].filter(Boolean))].join(", ") });
  }
  const direct = new Set(rows.keys());
  for (const piece of [...data.components, ...data.objects]) for (const p of usages[piece.name] ?? []) {
    const key = "page:" + normPath(p.path);
    if (direct.has(key)) continue;
    const prior = rows.get(key);
    rows.set(key, { key, page: pageName(p), how: [...new Set([...(prior?.how ? prior.how.split(" · ") : []), `Shared piece: ${piece.name}`])].join(" · "), by: by(piece.requestIds) || prior?.by });
  }
  if (data.sitewide.files.length) rows.set(OTHER_KEY, { key: OTHER_KEY, page: null, how: "", by: by(data.sitewide.requestIds) });
  return [...rows.values()];
}

/** One row per changed page (never per change), de-duplicated by path; shared objects add the pages that use them.
 * Rejected and undo requests are skipped; page-less site changes collapse into one "Other site changes" row. */
export function changedPages(requests: DraftRequest[] | undefined, objectPages: Record<string, PageRef[]>): ChangedRow[] {
  const rows = new Map<string, { page: PageRef; how: string[] }>();
  let other = 0;
  const note = (p: PageRef, label: string | null) => {
    const key = "page:" + normPath(p.path);
    const row = rows.get(key) ?? { page: { name: p.name, path: normPath(p.path) }, how: [] };
    if (label && !row.how.includes(label)) row.how.push(label);
    rows.set(key, row);
  };
  for (const r of requests ?? []) {
    if (!r || r.isUndo === true || isRejected(r) || r.source === "platform" || r.source === "setup") continue;
    const direct = (Array.isArray(r.pages) ? r.pages : r.page ? [r.page] : []).filter(validPage);
    let any = false;
    for (const p of direct) { any = true; note(p, sourceLabel(r)); }
    for (const name of (Array.isArray(r.objects) ? r.objects : []).filter((o) => typeof o === "string" && o.trim())) {
      for (const p of (objectPages[name] ?? []).filter(validPage)) { any = true; note(p, `Changed through the shared object ${name}`); }
    }
    if (!any) other++;
  }
  const list: ChangedRow[] = [...rows].map(([key, r]) => ({ key, page: r.page, how: r.how.join(" · ") }));
  if (other) list.push({ key: OTHER_KEY, page: null, how: `${other} ${other === 1 ? "change that isn't" : "changes that aren't"} tied to one page`, count: other });
  return list;
}

const KINDS: LinkKind[] = ["internal", "external", "mail", "phone", "anchor"];
const STATES = ["ok", "redirect", "broken", "unconfirmed"];
/** Validate the relay's /api/review-links body; returns null when it isn't usable. */
export function parseReviewLinks(d: any): ReviewLinks | null {
  if (!d || d.ok !== true || !Array.isArray(d.groups)) return null;
  const groups: LinkGroup[] = [];
  for (const g of d.groups) {
    if (!g || !Array.isArray(g.links)) continue;
    const page = validPage(g.page) ? { name: g.page.name, path: g.page.path } : null;
    const links: ReviewLink[] = [];
    for (const l of g.links) {
      if (!l || typeof l.href !== "string" || !l.href || !KINDS.includes(l.kind)) continue;
      const st = l.status && typeof l.status === "object" && STATES.includes(l.status.state)
        ? { state: l.status.state, detail: typeof l.status.detail === "string" ? l.status.detail : undefined } : null;
      links.push({ key: `${page?.path ?? ""}|${l.href}`, href: l.href, kind: l.kind, label: typeof l.label === "string" && l.label.trim() ? l.label : null,
        ...(typeof (l.elementKey ?? l.key) === "string" && /^(?:link:)?\d+(?:\.\d+)*$/.test(l.elementKey ?? l.key) ? { elementKey: (l.elementKey ?? l.key).replace(/^link:/, ""), scope: typeof l.scope === "string" ? l.scope : "page" } : {}),
        ...(l.target === null || l.target === "_blank" ? { target: l.target } : {}),
        ...(typeof l.ariaLabel === "string" && l.ariaLabel.trim() ? { ariaLabel: l.ariaLabel.trim().slice(0, 300) } : {}),
        requestIds: Array.isArray(l.requestIds) ? l.requestIds.filter((x: unknown) => typeof x === "string") : [], status: st });
    }
    if (links.length) groups.push({ page, label: typeof g.label === "string" && g.label ? g.label : page?.name ?? "Other Links", links });
  }
  return { groups, unread: Number.isInteger(d.unread) && d.unread > 0 ? d.unread : 0, partial: d.partial === true, truncated: d.truncated === true };
}

/** Internal links are checked against the Manager's own page list. */
export function internalLinkChip(href: string, pages: ManagerPage[]): Chip {
  const path = normPath(href.split(/[?#]/)[0] || "/");
  const page = pages.find((p) => normPath(p.path) === path);
  if (!page) return { text: "Page not found", tone: "bad" };
  return page.build_status === "ready" ? { text: "Page found", tone: "ok" } : { text: "Page isn't published yet", tone: "warn" };
}

export function linkChip(link: ReviewLink, pages: ManagerPage[]): Chip | null {
  if (link.kind === "internal" || link.kind === "anchor") {
    if (link.kind === "anchor" && link.href.startsWith("#")) return null;
    return internalLinkChip(link.href, pages);
  }
  if (link.kind !== "external" || !link.status) return null;
  const d = link.status.detail;
  switch (link.status.state) {
    case "ok": return { text: "Address answered", tone: "ok" };
    case "redirect": return { text: "Redirects", tone: "warn", detail: d };
    case "broken": return { text: "Page not found", tone: "bad" };
    default: return { text: "Couldn't check", tone: "warn", detail: d };
  }
}

/** "A, B, C and 2 more". */
export function pageNames(rows: ChangedRow[]): string {
  const names = rows.filter((r) => r.page).map((r) => r.page!.name);
  if (names.length <= 3) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join("");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

export type ChecklistItem = { id: string; todo: string; done: string; locked: boolean };
/** Imperative instruction until ticked, then first-person past tense for the same action. At most five items. */
export function checklistItems(rows: ChangedRow[], hasLinks: boolean, pagesDone: boolean, linksDone: boolean): ChecklistItem[] {
  const names = pageNames(rows);
  const list = names ? ` (${names})` : "";
  const items: ChecklistItem[] = rows.some((r) => r.page)
    ? [{ id: "pages", todo: `Check the changed pages${list}.`, done: `I checked the changed pages${list}.`, locked: pagesDone }] : [];
  if (hasLinks) items.push({ id: "links", todo: "Check the links that changed.", done: "I checked the links that changed.", locked: linksDone });
  items.push(
    { id: "phone", todo: "Check how it looks on a phone.", done: "I checked how it looks on a phone.", locked: false },
    { id: "unintended", todo: "Make sure nothing was changed by accident.", done: "I made sure nothing was changed by accident.", locked: false },
  );
  return items;
}

/** Whether an item counts as ticked: locked items follow the walkthrough, never a manual tick. */
export const itemTicked = (item: ChecklistItem, manual: string[]) => (item.id === "pages" || item.id === "links") ? item.locked : manual.includes(item.id);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** What is still left before Submit for Review is allowed, or null when nothing is. */
export function remaining(pagesLeft: number, linksLeft: number, checksLeft: number): string | null {
  const parts: string[] = [];
  if (pagesLeft) parts.push(plural(pagesLeft, "page", "pages") + " left to check");
  if (linksLeft) parts.push(plural(linksLeft, "link", "links") + " left to check");
  if (checksLeft) parts.push(plural(checksLeft, "checklist item", "checklist items") + " left to tick");
  return parts.length ? parts.join(", ") : null;
}

const handLinkKind = (href: string): LinkKind => /^mailto:/i.test(href) ? "mail" : /^tel:/i.test(href) ? "phone" : href.startsWith("#") ? "anchor" : /^\/(?!\/)/.test(href) ? "internal" : "external";
/** Hand-set destinations (link:<path> overrides) on pages whose saved hand edits are part of the draft. */
export function handLinks(pages: ManagerPage[], handPaths: Set<string>): { path: string; href: string; target: "_blank" | null; elementKey: string; scope: string }[] {
  const out: { path: string; href: string; target: "_blank" | null; elementKey: string; scope: string }[] = [];
  for (const p of pages) {
    if (!handPaths.has(normPath(p.path)) || !p.inlineEdits || typeof p.inlineEdits !== "object") continue;
    for (const [k, v] of Object.entries(p.inlineEdits as Record<string, unknown>)) {
      if (!k.startsWith("link:") || typeof v !== "string") continue;
      try { const e = JSON.parse(v); if (typeof e?.href === "string" && e.href && !e.unlinked) out.push({ path: normPath(p.path), href: e.href, target: e.target === "_blank" ? "_blank" : null, elementKey: k.slice(5), scope: "page" }); } catch { /* invalid stored value: not a link */ }
    }
  }
  return out;
}
/**
 * The Links step list: the relay's changed links plus hand-set destinations on hand-edited draft pages, with every page
 * group named as the Manager names that page ("Homepage", never a file name like "Index").
 */
export function mergeReviewLinks(relay: ReviewLinks, pages: ManagerPage[], handPaths: Set<string>): ReviewLinks {
  const friendly = (p: PageRef) => ({ path: p.path, name: pages.find(m => normPath(m.path) === normPath(p.path))?.name ?? p.name });
  const groups: LinkGroup[] = relay.groups.map(g => g.page ? { ...g, page: friendly(g.page), label: g.label === g.page.name ? friendly(g.page).name : g.label } : { ...g, links: [...g.links] });
  const stored = handLinks(pages, new Set(pages.map(p => normPath(p.path))));
  for (const g of groups) g.links = g.links.map(l => {
    if (!g.page) return l;
    const matches = stored.filter(h => h.path === normPath(g.page?.path ?? "") && h.href === l.href && (!l.elementKey || (h.elementKey === l.elementKey && h.scope === (l.scope ?? "page"))));
    return matches.length === 1 ? { ...l, target: matches[0].target, elementKey: matches[0].elementKey, scope: matches[0].scope } : l;
  });
  for (const h of handLinks(pages, handPaths)) {
    let g = groups.find(x => x.page && normPath(x.page.path) === h.path);
    if (!g) {
      const page = friendly({ name: h.path, path: h.path });
      g = { page, label: page.name, links: [] }; groups.push(g);
    } else if (g.links === relay.groups.find(x => x.page && normPath(x.page.path) === h.path)?.links) g.links = [...g.links];
    const key = `${g.page!.path}|${h.href}`;
    if (!g.links.some(l => l.key === key)) g.links.push({ key, href: h.href, target: h.target, elementKey: h.elementKey, scope: h.scope, kind: handLinkKind(h.href), label: null, requestIds: [], status: null });
  }
  return { ...relay, groups };
}
