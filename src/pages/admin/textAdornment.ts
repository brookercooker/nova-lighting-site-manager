export const iconPositionKey = (path: string) => `icon-position:${path}`;
export const LINK_DESTINATION_ERROR = "Use https://, mailto:, tel: or a site path starting with a single /. Same-page anchors such as #top aren't supported here.";
export function validTextLink(href: string): boolean {
  if (!href || /[\s\u0000-\u001f\u007f\\]/.test(href)) return false;
  if (/^https:\/\//i.test(href)) {
    try { const url = new URL(href); return url.protocol === "https:" && !!url.hostname; } catch { return false; }
  }
  return /^mailto:[^?]+(?:\?.*)?$/i.test(href) || /^tel:[+\d][\d().+-]*$/i.test(href) || /^\/(?!\/)/.test(href);
}