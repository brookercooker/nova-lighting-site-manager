import type { DraftRequest } from "./helper";

/** Pure rules for the Submit for Review walkthrough (pages, links, checklist). */
export type PageRef = { name: string; path: string };
export type ChangedRow = { key: string; page: PageRef | null; what: string; via?: string };
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
const truncate = (t: string, n = 90) => { const one = t.replace(/\s+/g, " ").trim(); return one.length > n ? one.slice(0, n - 1).trimEnd() + "…" : one; };
export const isRejected = (r: DraftRequest) => r.decision != null && typeof r.decision === "object";

export function whatChanged(r: DraftRequest): string {
  if (r.source === "content") return "Edited by hand";
  return truncate(r.request ?? "") || "Edited by hand";
}

/** Every changed page, de-duplicated by path; shared objects add the pages that use them. Rejected and undo requests are skipped. */
export function changedPages(requests: DraftRequest[] | undefined, objectPages: Record<string, PageRef[]>): ChangedRow[] {
  const rows = new Map<string, ChangedRow>();
  const other: ChangedRow[] = [];
  for (const r of requests ?? []) {
    if (!r || r.isUndo === true || isRejected(r)) continue;
    const what = whatChanged(r);
    const direct = (Array.isArray(r.pages) ? r.pages : r.page ? [r.page] : []).filter(validPage);
    let any = false;
    for (const p of direct) {
      any = true;
      const key = "page:" + normPath(p.path);
      const cur = rows.get(key);
      if (!cur) rows.set(key, { key, page: { name: p.name, path: normPath(p.path) }, what });
      else if (cur.via) rows.set(key, { ...cur, via: undefined, what });
    }
    for (const name of (Array.isArray(r.objects) ? r.objects : []).filter((o) => typeof o === "string" && o.trim())) {
      for (const p of (objectPages[name] ?? []).filter(validPage)) {
        any = true;
        const key = "page:" + normPath(p.path);
        if (!rows.has(key)) rows.set(key, { key, page: { name: p.name, path: normPath(p.path) }, what, via: name });
      }
    }
    if (!any) other.push({ key: "req:" + r.id, page: null, what: truncate(r.request ?? "", 120) || "Edited by hand" });
  }
  return [...rows.values(), ...other];
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
/** First person: "I will…" until ticked, then "I …ed" for the same action. At most five items. */
export function checklistItems(rows: ChangedRow[], hasLinks: boolean, pagesDone: boolean, linksDone: boolean): ChecklistItem[] {
  const names = pageNames(rows);
  const list = names ? ` (${names})` : "";
  const items: ChecklistItem[] = [
    { id: "pages", todo: `I will check the changed pages${list}.`, done: `I checked the changed pages${list}.`, locked: pagesDone },
  ];
  if (hasLinks) items.push({ id: "links", todo: "I will check the links I changed.", done: "I checked the links I changed.", locked: linksDone });
  items.push(
    { id: "phone", todo: "I will look at the page on a phone as well.", done: "I looked at the page on a phone as well.", locked: false },
    { id: "unintended", todo: "I will make sure nothing I didn't mean to change was changed.", done: "I made sure nothing I didn't mean to change was changed.", locked: false },
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
