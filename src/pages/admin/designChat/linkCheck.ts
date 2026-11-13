import { normPath, type ManagerPage, type ChangedRow, type LinkGroup, type LinkKind, type ReviewLink } from "./submitWalkthrough";

/** Verify Changed Links: the frame bridge and the per-page checks of the Submit for Review walkthrough. */
export type LinkClick = { raw: string; href: string; kind: LinkKind; label: string | null; path: string | null; match?: string | null; elementKey?: string; scope?: string; inventoryIndex?: number };
const KINDS: LinkKind[] = ["internal", "external", "mail", "phone", "anchor"];
export const KIND_TEXT: Record<LinkKind, string> = { internal: "A page on your site", external: "A different website", mail: "An email address", phone: "A phone number", anchor: "A section of this page" };

/** Exact https cross-origin origin of a frame, or null when it must not be messaged. */
export function frameOrigin(frame: HTMLIFrameElement | null): string | null {
  if (!frame) return null;
  try {
    const url = new URL(frame.src);
    return url.protocol === "https:" && url.origin !== "null" && url.origin !== window.location.origin ? url.origin : null;
  } catch { return null; }
}
const fromFrame = (event: MessageEvent, frame: HTMLIFrameElement | null) =>
  !!frame?.contentWindow && event.source === frame.contentWindow && frameOrigin(frame) === event.origin;

export type LinkState = "todo" | "done" | "replaced";
/** Frame entries never carry "replaced": links replaced by hand are omitted from the frame list. */
export type LinkCheckEntry = { raw: string; state: Exclude<LinkState, "replaced"> };
export const MAX_LISTED_LINKS = 100;
export const linkState = (key: string, linkTicked: string[], replaced: Record<string, string> = {}): LinkState =>
  key in replaced ? "replaced" : linkTicked.includes(key) ? "done" : "todo";
const RANK: Record<LinkCheckEntry["state"], number> = { todo: 1, done: 0 };
/** Every changed link (page and shared-piece groups) for the frame, one entry per raw href, capped at 100. Replaced by Hand links are omitted. */
export function linkCheckList(groups: LinkGroup[], linkTicked: string[], replaced: Record<string, string> = {}): LinkCheckEntry[] {
  const out = new Map<string, LinkCheckEntry["state"]>();
  for (const l of groups.flatMap(g => g.links)) {
    const st = linkState(l.key, linkTicked, replaced);
    if (st === "replaced") continue;
    const prev = out.get(l.href);
    if (prev === undefined ? out.size < MAX_LISTED_LINKS : RANK[st] > RANK[prev]) out.set(l.href, st);
  }
  return [...out].map(([raw, state]) => ({ raw, state }));
}
function post(frame: HTMLIFrameElement | null, message: Record<string, unknown>): boolean {
  const origin = frameOrigin(frame);
  if (!origin || !frame?.contentWindow) return false;
  try { frame.contentWindow.postMessage({ source: "nova-manager", ...message }, origin); return true; }
  catch { return false; } // a frame removed mid-teardown
}
export function postLinkCheck(frame: HTMLIFrameElement | null, enabled: boolean, links: LinkCheckEntry[] = []): boolean {
  return post(frame, enabled ? { type: "link-check", enabled, interceptAll: true, links: links.slice(0, MAX_LISTED_LINKS) } : { type: "link-check", enabled });
}
/** Asks the public frame to scroll to and flash a listed link. */
export function postLinkFocus(frame: HTMLIFrameElement | null, raw: string): boolean {
  return post(frame, { type: "link-check-focus", raw });
}
/** Sends link-check-focus once the shown frame reports v2 link-check-ready, or after a short timeout so it never hangs. */
export function focusWhenReady(getFrame: () => HTMLIFrameElement | null, raw: string, timeoutMs = 4000): () => void {
  let done = false;
  const finish = () => { if (done) return; done = true; window.removeEventListener("message", receive); clearTimeout(t); postLinkFocus(getFrame(), raw); };
  const receive = (event: MessageEvent) => { if (isLinkCheckReady(event, getFrame())) finish(); };
  window.addEventListener("message", receive);
  const t = setTimeout(finish, timeoutMs);
  return () => { done = true; window.removeEventListener("message", receive); clearTimeout(t); };
}
export function isLinkCheckReady(event: MessageEvent, frame: HTMLIFrameElement | null): boolean {
  const d = event.data;
  return fromFrame(event, frame) && !!d && d.source === "nova-site" && d.type === "link-check-ready" && d.v === 2 && d.enabled === true;
}
const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);
/** A validated v2 link-click whose match is one of the listed links, or null for anything else. */
export function parseLinkClick(event: MessageEvent, frame: HTMLIFrameElement | null, listed: string[], allowUnmatched = false): LinkClick | null {
  const d = event.data;
  if (!fromFrame(event, frame) || !d || typeof d !== "object" || d.source !== "nova-site" || d.type !== "link-click" || d.v !== 2) return null;
  if (!(typeof d.match === "string" && listed.includes(d.match)) && !(allowUnmatched && d.match === null)) return null;
  if (!str(d.raw, 2048) || !str(d.href, 2048) || !KINDS.includes(d.kind)) return null;
  if (d.label != null && typeof d.label !== "string") return null;
  if (d.path != null && !(str(d.path, 300) && /^\/(?!\/)/.test(d.path))) return null;
  const label = typeof d.label === "string" && d.label.trim() ? d.label.trim().slice(0, 300) : null;
  return { raw: d.raw, href: d.href, kind: d.kind, label, path: d.path ?? null, match: d.match,
    ...(typeof d.elementKey === "string" && /^(?:link:)?\d+(?:\.\d+)*$/.test(d.elementKey) ? { elementKey: d.elementKey.replace(/^link:/, "") } : {}),
    ...(str(d.scope, 300) && (d.scope === "page" || d.scope.startsWith("object:")) ? { scope: d.scope } : {}),
    ...(Number.isInteger(d.inventoryIndex) && d.inventoryIndex >= 0 && d.inventoryIndex < 500 ? { inventoryIndex: d.inventoryIndex } : {}) };
}

/** The changed links that appear on one page: its own plus changed shared-piece links (Header, Footer). */
export function pageLinks(groups: LinkGroup[], path: string | undefined): ReviewLink[] {
  if (!path) return [];
  return groups.filter(g => !g.page || normPath(g.page.path) === normPath(path) || g.shared?.pages.some(p => normPath(p.path) === normPath(path))).flatMap(g => g.links);
}
/** The changed link a click refers to (same key the Links step uses), or null when it isn't one. */
export function matchChangedLink(groups: LinkGroup[], path: string | null | undefined, raw: string): ReviewLink | null {
  const matches = pageLinks(groups, path ?? undefined).filter(l => l.href === raw);
  return matches.length === 1 ? matches[0] : null;
}

/** Prefer exact inventory identity, then unique reported wording; a shared destination alone is never enough. */
export function changedLinkForClick(groups: LinkGroup[], click: LinkClick): ReviewLink | null {
  const links = pageLinks(groups, click.path ?? undefined);
  if (click.elementKey) {
    const matches = links.filter(l => l.elementKey === click.elementKey && l.scope === (click.scope ?? "page") && l.inventoryIndex === click.inventoryIndex);
    return matches.length === 1 ? matches[0] : null;
  }
  const matches = links.filter(l => l.href === click.raw || l.href === click.match || l.href === click.href);
  const named = matches.filter(l => click.label && [l.label, l.visibleText, l.ariaLabel, l.image?.alt].includes(click.label));
  const pool = named.length ? named : matches;
  return pool.length === 1 ? pool[0] : null;
}

/** Only reported visible content supplies excerpts; destination names are the final fallback. */
export function linkText(l: { href: string; kind: LinkKind; label?: string | null; ariaLabel?: string | null; visibleText?: string; image?: { alt: string; src?: string } }, pages: Pick<ManagerPage, "name" | "path">[] = []): string {
  const excerpt = (value: string) => value.length <= 40 ? value : `${value.slice(0, 39).trimEnd()}…`;
  if (l.image) {
    const alt = l.image.alt.replace(/\s+/g, " ").trim();
    let filename = "";
    try { filename = decodeURIComponent(new URL(l.image.src ?? "").pathname.split("/").at(-1) ?? ""); } catch { /* no reported usable filename */ }
    return excerpt(`Image${alt || filename ? `: ${alt || filename}` : ""}`);
  }
  const label = (l.visibleText || l.label || l.ariaLabel || "").replace(/\s+/g, " ").trim();
  if (label && label !== l.href && label !== linkAddress(l)) {
    return excerpt(label);
  }
  if (l.kind === "internal" && !l.href.startsWith("#")) {
    const path = normPath(l.href.split(/[?#]/)[0] || "/");
    const page = pages.find(p => normPath(p.path) === path);
    if (page?.name) return `Link to ${page.name}`;
  }
  return linkAddress(l);
}
export const linkAddress = (l: { href: string; kind: LinkKind }) => l.kind === "mail" || l.kind === "phone" ? l.href.replace(/^(mailto|tel):/i, "") : l.href;
export type PageCheck = { id: string; todo: string; done: string; ticked: boolean; link?: ReviewLink; state?: LinkState; auto: boolean };
export const LINK_BADGE: Record<LinkState, string> = { todo: "Needs Checking", done: "Confirmed", replaced: "Replaced by Hand" };
/** Resolved links: confirmed, or replaced by hand after Change This Link. */
export const linkResolved = (st: LinkState) => st === "done" || st === "replaced";
/** "2 of 3 links need checking", or "All links confirmed". */
export function linksNeedChecking(links: ReviewLink[], linkTicked: string[], replaced: Record<string, string> = {}): string | null {
  if (!links.length) return null;
  const left = links.filter(l => !linkResolved(linkState(l.key, linkTicked, replaced))).length;
  return left ? `${left} of ${links.length} ${links.length === 1 ? "link needs" : "links need"} checking` : "All links confirmed";
}
/** One item per changed link on the page; each ticks itself when the link is confirmed. Pages without links have none. */
export function pageChecks(row: ChangedRow, links: ReviewLink[], linkTicked: string[], pages: Pick<ManagerPage, "name" | "path">[] = []): PageCheck[] {
  if (!row.page) return [];
  const items: PageCheck[] = [];
  for (const l of links) {
    const name = linkText(l, pages), to = linkAddress(l);
    items.push({ id: "link:" + l.key, todo: `Check that “${name}” goes to ${to}.`, done: `I confirmed “${name}” goes to ${to}.`, ticked: linkTicked.includes(l.key), link: l, state: linkState(l.key, linkTicked), auto: true });
  }
  return items;
}

/** The preview link bridge runs only on the Links step, while a link's page is shown in the visible, non-editing preview. */
export const linkCheckActive = (w: { step: string; checking: unknown; open?: boolean }, visible: boolean, editing: boolean) => (!!w.checking || !!w.open) && w.step === "links" && visible && !editing;

/** The page Change This Link edits: the link group's page, else the first changed page (as Show on Page), else "/". */
export function fixPage(group: LinkGroup, rows: ChangedRow[]): { path: string; name: string } {
  if (group.page) return { path: group.page.path, name: group.page.name };
  const r = rows.find(x => x.page);
  return r?.page ? { path: r.page.path, name: r.page.name } : { path: "/", name: "Home" };
}
export const fixBannerText = (pageName: string, address: string) => `${pageName} · link to ${address}`;
