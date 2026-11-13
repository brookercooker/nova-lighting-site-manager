import { normPath, type LinkGroup, type LinkKind, type ManagerPage, type ReviewLink, type ReviewLinks } from "./submitWalkthrough";
import { publicPreviewBase, publicPreviewPage } from "./publicPreviewUrl";
import { reviewLinkIdentity } from "./reviewLinkIdentity";

/** Link inventory (Public companion, v1): the links a rendered page really has, used for a true draft-vs-live Links step. */
export type InventoryLink = { key: string; scope: string; href: string; label: string | null; ariaLabel?: string; visibleText?: string; image?: { alt: string; src?: string }; target?: "_blank" | null; originalHref?: string; fingerprint?: string; inventoryIndex?: number; inventoryPath?: string };
/** Only repeated inventory keys need an index; destination never disambiguates an element. */
export function indexedInventory(links: InventoryLink[]): InventoryLink[] {
  const counts = new Map<string, number>();
  for (const l of links) { const id = `${l.scope}|${l.key}`; counts.set(id, (counts.get(id) ?? 0) + 1); }
  return links.map((l, index) => (counts.get(`${l.scope}|${l.key}`) ?? 0) > 1 ? { ...l, inventoryIndex: l.inventoryIndex ?? index } : l);
}
export const inventoryIdentity = (l: InventoryLink) => `${l.scope}|${l.key}${l.inventoryIndex === undefined ? "" : `|index:${l.inventoryIndex}`}`;
export type Inventory = { path: string; links: InventoryLink[] };
/** Retain display facts only for the same reported identity and destination; fresh membership always wins. */
export function retainInventoryMetadata(fresh: Inventory | null, previous?: Inventory): Inventory | null {
  if (!fresh) return previous ?? null;
  if (!previous || normPath(previous.path) !== normPath(fresh.path)) return fresh;
  return { ...fresh, links: fresh.links.map(link => {
    const prior = previous.links.find(p => inventoryIdentity(p) === inventoryIdentity(link) && p.href === link.href);
    return prior ? { ...link, label: link.label || prior.label, visibleText: link.visibleText || prior.visibleText, ariaLabel: link.ariaLabel || prior.ariaLabel, image: link.image || prior.image, originalHref: link.originalHref || prior.originalHref } : link;
  }) };
}
export const MAX_INVENTORY = 500;
export const INVENTORY_TIMEOUT_MS = 3000;
/** Ask the already-synchronized preview first; never read its cross-origin DOM or accept sibling replies. */
export function requestFrameInventory(frame: HTMLIFrameElement, url: string, timeoutMs = INVENTORY_TIMEOUT_MS): Promise<Inventory | null> {
  const requested = new URL(url);
  const current = new URL(frame.src);
  if (requested.protocol !== "https:" || current.origin !== requested.origin || !frame.contentWindow) return Promise.resolve(null);
  return new Promise(resolve => {
    const source = frame.contentWindow;
    let done = false;
    const finish = (inventory: Inventory | null) => { if (done) return; done = true; clearTimeout(timer); clearInterval(retry); window.removeEventListener("message", receive); resolve(inventory); };
    const receive = (e: MessageEvent) => {
      if (e.origin !== requested.origin || e.source !== source) return;
      const inventory = parseInventory(e.data);
      if (inventory && normPath(inventory.path) === normPath(requested.pathname)) finish(inventory);
    };
    const ask = () => source?.postMessage({ source: "nova-manager", type: "link-inventory-request", v: 1 }, requested.origin);
    window.addEventListener("message", receive);
    const timer = setTimeout(() => finish(null), timeoutMs);
    const retry = setInterval(ask, 500);
    ask();
  });
}
const ok = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v);

export function parseInventory(d: any): Inventory | null {
  if (!d || typeof d !== "object" || d.source !== "nova-site" || d.type !== "link-inventory" || d.v !== 1) return null;
  if (!ok(d.path, 300) || !/^\/(?!\/)/.test(d.path) || !Array.isArray(d.links)) return null;
  const links: InventoryLink[] = [];
  for (const l of d.links.slice(0, MAX_INVENTORY)) {
    if (!l || typeof l.key !== "string" || l.key.length > 300 || !ok(l.scope, 300) || !ok(l.href, 2048)) continue;
    links.push({ key: l.key, scope: l.scope, href: l.href, label: typeof l.label === "string" && l.label.trim() ? l.label.trim().slice(0, 300) : null,
      ...(typeof l.ariaLabel === "string" && l.ariaLabel.trim() ? { ariaLabel: l.ariaLabel.trim().slice(0, 300) } : {}),
      ...(ok(l.visibleText, 300) ? { visibleText: l.visibleText } : {}),
      ...(l.image && typeof l.image === "object" && typeof l.image.alt === "string" && l.image.alt.length <= 300 ? { image: { alt: l.image.alt, ...(ok(l.image.src, 2048) && /^https:\/\//i.test(l.image.src) ? { src: l.image.src } : {}) } } : {}),
      ...(l.target === null || l.target === "_blank" ? { target: l.target } : {}),
      ...(ok(l.originalHref, 2048) ? { originalHref: l.originalHref } : {}),
      ...(typeof l.fingerprint === "string" && l.fingerprint.length <= 2048 ? { fingerprint: l.fingerprint } : {}) });
  }
  return { path: d.path, links: indexedInventory(links) };
}

/** The deployed live site, when configured; without it the Links step keeps the relay-based list. */
export function liveSiteBase(configured = (import.meta as any).env?.VITE_PUBLIC_LIVE_URL as string | undefined): string | null {
  if (!configured) return null;
  try { return publicPreviewBase(null, configured); } catch { return null; }
}

/** Loads a page in an off-screen frame and asks for its inventory; null when it doesn't answer in time. */
export function requestInventory(url: string, timeoutMs = INVENTORY_TIMEOUT_MS, doc: Document = document): Promise<Inventory | null> {
  let origin: string;
  try { const u = new URL(url); if (u.protocol !== "https:" || u.origin === window.location.origin) return Promise.resolve(null); origin = u.origin; } catch { return Promise.resolve(null); }
  return new Promise(resolve => {
    const frame = doc.createElement("iframe");
    frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1; frame.title = "Link Inventory";
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:800px;border:0;visibility:hidden";
    let done = false;
    const ask = () => { try { frame.contentWindow?.postMessage({ source: "nova-manager", type: "link-inventory-request", v: 1 }, origin); } catch { /* removed */ } };
    const finish = (inv: Inventory | null) => { if (done) return; done = true; clearTimeout(t); window.removeEventListener("message", on); frame.remove(); resolve(inv); };
    const on = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frame.contentWindow) return;
      if (e.data?.source === "nova-site" && e.data?.type === "preview-ready") { ask(); return; }
      const inv = parseInventory(e.data); if (inv && normPath(inv.path) === normPath(new URL(url).pathname)) finish(inv);
    };
    window.addEventListener("message", on);
    frame.addEventListener("load", ask);
    const t = setTimeout(() => finish(null), timeoutMs);
    frame.src = url; doc.body.appendChild(frame);
  });
}

const kindOf = (href: string): LinkKind => /^mailto:/i.test(href) ? "mail" : /^tel:/i.test(href) ? "phone" : href.startsWith("#") ? "anchor" : /^\/(?!\/)/.test(href) ? "internal" : "external";
/** Draft links that are new, or whose destination differs from the same element on the live page. */
export function diffInventories(draft: Inventory, live: Inventory): InventoryLink[] {
  const liveBy = new Map(indexedInventory(live.links).map(l => [inventoryIdentity(l), l.href]));
  const seen = new Set<string>();
  return indexedInventory(draft.links).map(l => ({ ...l, originalHref: liveBy.get(inventoryIdentity(l)) ?? l.originalHref })).filter(l => { const id = inventoryIdentity(l); const before = liveBy.get(id); if (seen.has(id)) return false; seen.add(id); return before !== l.href; });
}
/** Replace each page group that has both inventories with its net changes; pages without them keep the existing rows. */
export function netReviewLinks(base: ReviewLinks, nets: Record<string, InventoryLink[]>, pages: ManagerPage[]): ReviewLinks {
  const name = (path: string) => pages.find(p => normPath(p.path) === normPath(path))?.name ?? path;
  const groups: LinkGroup[] = [];
  const done = new Set<string>();
  for (const g of base.groups) {
    const path = g.page ? normPath(g.page.path) : null;
    if (path === null || !(path in nets)) { groups.push(g); continue; }
    done.add(path);
    const links = toLinks(g.page!.path, nets[path], g.links);
    if (links.length) groups.push({ ...g, links });
  }
  for (const [path, list] of Object.entries(nets)) if (!done.has(path) && list.length) groups.push({ page: { name: name(path), path }, label: name(path), links: toLinks(path, list, []) });
  return { ...base, groups };
}
function toLinks(path: string, list: InventoryLink[], prior: ReviewLink[]): ReviewLink[] {
  const out: ReviewLink[] = [];
  for (const l of list) {
    const key = reviewLinkIdentity({ ...l, elementKey: l.key, kind: kindOf(l.href), requestIds: [], status: null }, path);
    if (out.some(x => x.key === key)) continue;
    const was = prior.find(x => x.elementKey && reviewLinkIdentity(x, path) === key);
    out.push({ ...was, key, href: l.href, kind: kindOf(l.href), requestIds: was?.requestIds ?? [], status: was?.href === l.href ? was.status : null, originalHref: l.originalHref ?? was?.originalHref, elementKey: l.key, scope: l.scope, inventoryIndex: l.inventoryIndex, target: l.target ?? null, label: l.label || was?.label || null, ariaLabel: l.ariaLabel || was?.ariaLabel, visibleText: l.visibleText || was?.visibleText, image: l.image || was?.image });
  }
  return out;
}
/** Per changed page, the net link changes; empty object when the frame doesn't support inventories (first page probes). */
export async function loadNetLinks(paths: string[], live: string | null, request = requestInventory): Promise<Record<string, InventoryLink[]>> {
  if (!live || !paths.length) return {};
  let draft: string; try { draft = publicPreviewBase(null); } catch { return {}; }
  const pair = async (p: string) => { const [d, l] = await Promise.all([request(publicPreviewPage(draft, p)), request(publicPreviewPage(live, p))]); return d && l ? diffInventories(d, l) : null; };
  const [first, ...rest] = paths;
  const head = await pair(first);
  if (!head) return {};
  const out: Record<string, InventoryLink[]> = { [normPath(first)]: head };
  (await Promise.all(rest.slice(0, 19).map(pair))).forEach((r, i) => { if (r) out[normPath(rest[i])] = r; });
  return out;
}
