import { getDomain } from "tldts";
import type { LinkGroup, ManagerPage, ReviewLink } from "./submitWalkthrough";

export const BRAND_DOMAINS = ["instagram.com", "facebook.com", "pinterest.com", "tiktok.com", "youtube.com", "x.com", "linkedin.com", "google.com", "yelp.com", "houzz.com"];
export const domainOf = (href: string): string | null => {
  try { const u = new URL(href); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, "") : null; } catch { return null; }
};
export const registeredDomain = (host: string) => getDomain(host, { allowPrivateDomains: true }) ?? host;
export function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}
const skeleton = (s: string) => s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/[li1]/g, "i").replace(/0/g, "o").replace(/-/g, "");
export type RiskFlag = { kind: "lookalike" | "punycode" | "insecure" | "mismatch" | "duplicate" | "swap"; reason: string; otherKey?: string; expected?: string };
export function hostWarnings(href: string, known: string[], trusted: string[]): RiskFlag[] {
  const host = domainOf(href);
  if (!host) return [];
  const warnings: RiskFlag[] = [];
  if (/^http:/i.test(href)) warnings.push({ kind: "insecure", reason: "This link does not use https. Check before opening it." });
  if (host.includes("xn--")) warnings.push({ kind: "punycode", reason: "This address uses encoded international characters (xn--). Check the domain carefully." });
  if (trusted.includes(host)) return warnings;
  const domain = registeredDomain(host);
  const candidates = [...new Set([...BRAND_DOMAINS, ...known, ...trusted].map(registeredDomain))];
  if (!BRAND_DOMAINS.includes(domain)) {
    const expected = candidates.filter(c => c !== domain && (editDistance(c, domain) <= 2 || skeleton(c) === skeleton(domain))).sort((a, b) => editDistance(a, domain) - editDistance(b, domain))[0];
    if (expected) warnings.push({ kind: "lookalike", expected, reason: `Looks like ${expected}, but this goes to ${host}. Check the spelling.` });
  }
  return warnings;
}
// Deliberately narrow: explicit actions and brands only, not broad semantic guesses.
export const ROUTE_EXPECTATIONS = [
  { label: /\b(?:book|schedule) (?:a )?consultation\b/i, paths: ["/contact", "/consultation", "/book-a-consultation"] },
  { label: /\b(?:explore|view) galler(?:y|ies)\b/i, paths: ["/gallery", "/galleries", "/inspiration-gallery"] },
  { label: /\bfind a location\b/i, paths: ["/locations", "/showrooms"] },
  { label: /^contact(?: us)?$/i, paths: ["/contact"] },
];
export function mismatch(label: string, href: string): RiskFlag | null {
  const host = domainOf(href);
  const namedDomain = label.match(/\b(?:www\.)?([a-z0-9-]+\.[a-z]{2,})\b/i)?.[1]?.toLowerCase();
  if (namedDomain && host && registeredDomain(host) !== registeredDomain(namedDomain)) return { kind: "mismatch", reason: `The wording names ${namedDomain}, but the link goes to ${host}.` };
  const brand = BRAND_DOMAINS.find(d => new RegExp(`^${d.split(".")[0]}(?:\\s|$)`, "i").test(label));
  if (brand && host && registeredDomain(host) !== brand) return { kind: "mismatch", reason: `The wording says ${brand.split(".")[0]}, but the domain is ${host}.` };
  if (/^call us$/i.test(label) && /^mailto:/i.test(href)) return { kind: "mismatch", reason: "This says Call us, but opens an email address." };
  if (/^contact(?: us)?$/i.test(label) && /^mailto:/i.test(href)) return { kind: "mismatch", reason: "This Contact link opens email rather than the contact page." };
  const rule = ROUTE_EXPECTATIONS.find(r => r.label.test(label));
  if (rule && href.startsWith("/") && !rule.paths.includes(href.split(/[?#]/)[0].replace(/\/$/, ""))) return { kind: "mismatch", reason: `The wording suggests ${rule.paths[0]}, but this goes to ${href}.` };
  return null;
}
export function groupRisks(group: LinkGroup, names: Record<string, string>, known: string[], trusted: string[]): Record<string, RiskFlag[]> {
  return Object.fromEntries(group.links.map(l => {
    const flags = hostWarnings(l.href, known, trusted);
    const mis = mismatch(names[l.key] ?? "", l.href); if (mis) flags.push(mis);
    const others = group.links.filter(o => o.key !== l.key && !(l.scope?.startsWith("object:") && l.scope === o.scope && l.elementKey === o.elementKey));
    const swap = others.find(o => l.originalHref && o.originalHref && l.originalHref !== l.href && l.href === o.originalHref && o.href === l.originalHref);
    const duplicate = others.find(o => o.href === l.href);
    if (swap) flags.push({ kind: "swap", reason: `Looks swapped with ${names[swap.key] ?? "another link"}`, otherKey: swap.key });
    if (duplicate) flags.push({ kind: "duplicate", reason: `Same destination as: ${names[duplicate.key] ?? "another link"}`, otherKey: duplicate.key });
    return [l.key, flags];
  }));
}
/** One primary advisory; all other reasons remain available without stacked banners. */
export function strongestRisk(flags: RiskFlag[]): RiskFlag | undefined {
  const order: RiskFlag["kind"][] = ["swap", "lookalike", "punycode", "insecure", "mismatch", "duplicate"];
  return [...flags].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
}
export function riskRank(link: ReviewLink, pages: ManagerPage[], flags: RiskFlag[]) {
  if (link.status?.state === "broken" || link.kind === "internal" && !pages.some(p => p.path === link.href.split(/[?#]/)[0])) return 0;
  if (flags.length) return 1;
  if (link.originalHref === link.href) return 4;
  return link.kind === "external" || link.kind === "mail" || link.kind === "phone" ? 2 : 3;
}
export function differingCharacters(actual: string, expected: string): boolean[] {
  // Align insertions/deletions instead of marking an entire shifted suffix.
  const dp = Array.from({ length: actual.length + 1 }, () => Array(expected.length + 1).fill(0));
  for (let i = 0; i <= actual.length; i++) dp[i][0] = i;
  for (let j = 0; j <= expected.length; j++) dp[0][j] = j;
  for (let i = 1; i <= actual.length; i++) for (let j = 1; j <= expected.length; j++) dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(actual[i-1] === expected[j-1] ? 0 : 1));
  const changed = Array(actual.length).fill(false); let i = actual.length, j = expected.length;
  while (i || j) {
    if (i && j && dp[i][j] === dp[i-1][j-1]+(actual[i-1] === expected[j-1] ? 0 : 1)) { changed[i-1] = actual[i-1] !== expected[j-1]; i--; j--; }
    else if (i && dp[i][j] === dp[i-1][j]+1) { changed[i-1] = true; i--; }
    else { if (i < actual.length) changed[i] = true; j--; }
  }
  return changed;
}