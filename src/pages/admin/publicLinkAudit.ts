// Link audit against the real public site.
//
// The public site reports each page's links and whether the page really loaded (see the public project's
// src/lib/linkReport.ts). This file turns those reports into audit rows: where each link goes and whether that
// destination works, is a Coming Soon placeholder, is missing, or is another site. Nothing here reads the Site
// Manager's own copies of the pages, which can differ from what visitors see.

import { isInternalPath, pageKey } from "./designChat/registerPage";

export type LinkArea = "header" | "footer" | "page";
export interface ScannedLink { href: string; url: string; text: string; area: LinkArea }
export type PageScan =
  | { path: string; status: "ok" | "not-found" | "coming-soon"; finalPath: string; links: ScannedLink[] }
  | { path: string; status: "unreachable" };

/** Stored status values (kept from the earlier audit so saved rows stay readable), plus Unchecked. */
export type LinkStatus = "Registered" | "Pending" | "Broken" | "External" | "Self-Referencing" | "Unchecked";
export type LinkType = "Page" | "Landing Page" | "Coming Soon" | "Missing Page" | "Other Site" | "Email or Phone" | "Same Page";

/** What people see for each stored status. */
export const STATUS_LABEL: Record<string, string> = {
  Registered: "Link Works",
  Pending: "Coming Soon",
  Broken: "Page Not Found",
  External: "Other Site",
  "Self-Referencing": "Same Page",
  Unchecked: "Couldn't Check (Timed Out)",
};
export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

export const HEADER_LOCATION = "Header";
export const FOOTER_LOCATION = "Footer";

export type Destination =
  | { kind: "internal"; path: string }
  | { kind: "external"; value: string }
  | { kind: "contact"; value: string }
  | { kind: "same-page"; value: string };

/** Where a reported link goes, relative to the public site's origin. */
export function destinationOf(link: Pick<ScannedLink, "href" | "url">, siteOrigin: string): Destination {
  const href = (link.href ?? "").trim();
  if (!href || href.startsWith("#")) return { kind: "same-page", value: href };
  if (/^(mailto:|tel:|sms:)/i.test(href)) return { kind: "contact", value: href };
  let url: URL;
  try { url = new URL(link.url || href, siteOrigin); } catch { return { kind: "external", value: href }; }
  if (!/^https?:$/.test(url.protocol)) return { kind: "external", value: href };
  if (url.origin !== siteOrigin) return { kind: "external", value: url.toString() };
  return { kind: "internal", path: pageKey(decodeSafe(url.pathname)) };
}
function decodeSafe(path: string) { try { return decodeURI(path); } catch { return path; } }

export function rowDestination(d: Destination): string {
  return d.kind === "internal" ? d.path : d.value;
}

/** Internal destinations the scan still has to load to know whether they work. */
export function unscannedDestinations(pages: PageScan[], siteOrigin: string): string[] {
  const scanned = new Set(pages.map((p) => pageKey(p.path)));
  const out = new Set<string>();
  for (const page of pages) {
    if (page.status === "unreachable") continue;
    for (const link of page.links) {
      const d = destinationOf(link, siteOrigin);
      if (d.kind === "internal" && !scanned.has(d.path) && !isInternalPath(d.path)) out.add(d.path);
    }
  }
  return [...out].sort();
}

export function classifyLink(d: Destination, foundOn: string | null, results: Map<string, PageScan>): { status: LinkStatus; type: LinkType } {
  if (d.kind === "contact") return { status: "External", type: "Email or Phone" };
  if (d.kind === "external") return { status: "External", type: "Other Site" };
  if (d.kind === "same-page") return { status: "Self-Referencing", type: "Same Page" };
  if (foundOn !== null && d.path === pageKey(foundOn)) return { status: "Self-Referencing", type: "Same Page" };
  const result = results.get(d.path);
  if (!result || result.status === "unreachable") return { status: "Unchecked", type: "Page" };
  if (result.status === "not-found") return { status: "Broken", type: "Missing Page" };
  if (result.status === "coming-soon") return { status: "Pending", type: "Coming Soon" };
  return { status: "Registered", type: d.path.startsWith("/landing/") ? "Landing Page" : "Page" };
}

export interface AuditRow {
  identity_key: string;
  location: string;
  link_text: string;
  destination: string;
  status: LinkStatus;
  type: LinkType;
  is_chrome: boolean;
  source_pages: string[];
}

/**
 * One row per distinct link: page links per page (location = the page path), header/footer links once for the whole site.
 * The key includes the destination, so two links with the same wording but different destinations stay separate.
 */
export function buildAuditRows(pages: PageScan[], results: Map<string, PageScan>, siteOrigin: string): AuditRow[] {
  const rows = new Map<string, AuditRow & { sources: Set<string> }>();
  for (const page of pages) {
    if (page.status !== "ok") continue; // missing / Coming Soon pages are reported as pages, not as link rows
    const foundOn = pageKey(page.path);
    for (const link of page.links) {
      const chrome = link.area !== "page";
      const location = link.area === "header" ? HEADER_LOCATION : link.area === "footer" ? FOOTER_LOCATION : foundOn;
      const d = destinationOf(link, siteOrigin);
      const destination = rowDestination(d);
      const key = `${location}::${link.text.toLowerCase()}::${destination}`;
      let row = rows.get(key);
      if (!row) {
        const { status, type } = classifyLink(d, chrome ? null : foundOn, results);
        row = { identity_key: key, location, link_text: link.text, destination, status, type, is_chrome: chrome, source_pages: [], sources: new Set() };
        rows.set(key, row);
      }
      row.sources.add(foundOn);
    }
  }
  return [...rows.values()].map(({ sources, ...row }) => ({ ...row, source_pages: [...sources].sort() }));
}

export interface PageProblem { path: string; problem: "unreachable" | "not-found" | "coming-soon" }
/** Pages the scan was asked to check that didn't load as real pages. */
export function pageProblems(pages: PageScan[]): PageProblem[] {
  return pages.filter((p) => p.status !== "ok").map((p) => ({ path: pageKey(p.path), problem: p.status as PageProblem["problem"] }));
}
