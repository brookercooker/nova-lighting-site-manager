import type { DraftRequest } from "./helper";

/** Pure rules for the Submit for Review walkthrough (pages, links, checklist). */
export type PageRef = { name: string; path: string };
export type ChangedRow = { key: string; page: PageRef | null; how: string; count?: number };
export const OTHER_KEY = "other";
export type ManagerPage = { name: string; path: string; build_status: string };
export type LinkKind = "internal" | "external" | "mail" | "phone" | "anchor";
export type RelayLinkStatus = { state: "ok" | "redirect" | "broken" | "unconfirmed"; detail?: string } | null;
export type ReviewLink = { key: string; href: string; kind: LinkKind; label: string | null; requestIds: string[]; status: RelayLinkStatus };
export type LinkGroup = { page: PageRef | null; label: string; links: ReviewLink[] };
export type ReviewLinks = { groups: LinkGroup[]; unread: number; partial: boolean; truncated: boolean };
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
const noSiteFiles = (r: DraftRequest) => {
  const f = (r as { siteFiles?: unknown }).siteFiles;
  return f === 0 || (Array.isArray(f) && f.length === 0);
};

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
    if (!r || r.isUndo === true || isRejected(r)) continue;
    const direct = (Array.isArray(r.pages) ? r.pages : r.page ? [r.page] : []).filter(validPage);
    let any = false;
    for (const p of direct) { any = true; note(p, sourceLabel(r)); }
    for (const name of (Array.isArray(r.objects) ? r.objects : []).filter((o) => typeof o === "string" && o.trim())) {
      for (const p of (objectPages[name] ?? []).filter(validPage)) { any = true; note(p, `Changed through the shared object ${name}`); }
    }
    if (!any && r.source !== "platform" && !noSiteFiles(r)) other++;
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
        requestIds: Array.isArray(l.requestIds) ? l.requestIds.filter((x: unknown) => typeof x === "string") : [], status: st });
    }
    if (links.length) groups.push({ page, label: typeof g.label === "string" && g.label ? g.label : page?.name ?? "Other Links", links });
  }
  return { groups, unread: Number.isInteger(d.unread) && d.unread > 0 ? d.unread : 0, partial: d.partial === true, truncated: d.truncated === true };
}

/** Internal links are checked against the Manager's own page list. */
export function internalLinkChip(href: string, pages: ManagerPage[]): Chip {
  const path = normPath(href);
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
