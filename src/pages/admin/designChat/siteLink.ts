/** Platform UI is not visitor content. Public preview hosts are allowed for visitor paths, never editor paths. */
export function isSiteLink(href: string, contentOwned?: boolean): boolean {
  if (contentOwned === false) return false;
  try {
    const url = new URL(href, "https://site.invalid");
    const host = url.hostname.toLowerCase();
    if (host === "lovable.dev" || host.endsWith(".lovable.dev")) return false;
    if (host === "lovable.app" || host === "www.lovable.app") return false;
    if (host.endsWith(".lovable.app") && /^\/(?:projects?|edit|manage|admin|auth|login|__lovable)(?:\/|$)/i.test(url.pathname)) return false;
    return true;
  } catch { return false; }
}