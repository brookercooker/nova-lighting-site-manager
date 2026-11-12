// Loads public-site pages in hidden frames and asks each for its link report (public project: src/lib/linkReport.ts).
// Only the exact frame window at the exact public origin is listened to; a page that never answers counts as
// "unreachable" rather than as a page with no links.

import { publicPreviewPage } from "./designChat/publicPreviewUrl";
import { isSafePublicFrameUrl } from "./siteManifest";
import type { LinkArea, PageScan, ScannedLink } from "./publicLinkAudit";

export const PAGE_SCAN_TIMEOUT_MS = 25_000;
const REQUEST_EVERY_MS = 2_000;
const MAX_LINKS = 1000;

const AREAS: LinkArea[] = ["header", "footer", "page"];
const STATUSES = ["ok", "not-found", "coming-soon"] as const;

/** Validates a `link-report` message; anything malformed is rejected (null). */
export function parseLinkReport(data: unknown, id: string): { status: (typeof STATUSES)[number]; finalPath: string; links: ScannedLink[] } | null {
  const d = data as Record<string, unknown> | null;
  if (!d || d.source !== "nova-site" || d.type !== "link-report" || d.id !== id) return null;
  if (typeof d.path !== "string" || !d.path.startsWith("/") || !STATUSES.includes(d.status as never) || !Array.isArray(d.links)) return null;
  const links: ScannedLink[] = [];
  for (const raw of d.links.slice(0, MAX_LINKS)) {
    const l = raw as Record<string, unknown> | null;
    if (!l || typeof l.href !== "string" || typeof l.text !== "string" || !AREAS.includes(l.area as LinkArea)) continue;
    links.push({ href: l.href.slice(0, 2000), url: typeof l.url === "string" ? l.url.slice(0, 2000) : "", text: l.text.slice(0, 160), area: l.area as LinkArea });
  }
  return { status: d.status as (typeof STATUSES)[number], finalPath: d.path, links };
}

let seq = 0;

/** Loads one public page off-screen and resolves with its report, or "unreachable" after the timeout. */
export function scanPublicPage(base: string, path: string, timeoutMs = PAGE_SCAN_TIMEOUT_MS): Promise<PageScan> {
  return new Promise((resolve) => {
    let src: string;
    try { src = publicPreviewPage(base, path); } catch { resolve({ path, status: "unreachable" }); return; }
    if (!isSafePublicFrameUrl(src)) { resolve({ path, status: "unreachable" }); return; }
    const origin = new URL(src).origin;
    const id = `scan-${Date.now().toString(36)}-${++seq}`;
    const frame = document.createElement("iframe");
    frame.title = "Link Audit Page Scan";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.dataset.linkScan = "true";
    // Real desktop size off-screen, so menus and responsive layouts render the way visitors see them.
    frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;pointer-events:none;visibility:hidden";
    frame.referrerPolicy = "origin";
    let done = false;
    const request = () => {
      if (done || !frame.contentWindow) return;
      try { frame.contentWindow.postMessage({ source: "nova-manager", type: "link-report-request", id }, origin); } catch { /* not ready yet */ }
    };
    const finish = (result: PageScan) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearInterval(retry);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== origin) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (data?.source !== "nova-site") return;
      if (data.type === "location") { request(); return; }
      const report = parseLinkReport(data, id);
      if (report) finish({ path, ...report });
    };
    window.addEventListener("message", onMessage);
    frame.addEventListener("load", request);
    const retry = setInterval(request, REQUEST_EVERY_MS);
    const timer = setTimeout(() => finish({ path, status: "unreachable" }), timeoutMs);
    frame.src = src;
    document.body.appendChild(frame);
  });
}

/** Scans paths a few at a time; onProgress gets (done, total) after each page. */
export async function scanPublicPages(base: string, paths: string[], onProgress?: (done: number, total: number) => void, concurrency = 3, timeoutMs?: number): Promise<PageScan[]> {
  const results: PageScan[] = new Array(paths.length);
  let next = 0; let finished = 0;
  const worker = async () => {
    while (next < paths.length) {
      const i = next++;
      const firstTimeout = timeoutMs ?? PAGE_SCAN_TIMEOUT_MS;
      let result = await scanPublicPage(base, paths[i], firstTimeout);
      // A slow draft may still be loading its assets; retry with fresh frames and more time.
      for (let attempt = 1; result.status === "unreachable" && attempt <= 2; attempt++) {
        result = await scanPublicPage(base, paths[i], firstTimeout * (attempt + 1));
      }
      results[i] = result;
      onProgress?.(++finished, paths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return results;
}
