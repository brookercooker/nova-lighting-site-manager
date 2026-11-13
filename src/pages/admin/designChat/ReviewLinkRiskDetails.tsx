import { Globe, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ManagerPage, ReviewLink } from "./submitWalkthrough";
import { domainOf, differingCharacters, strongestRisk, type RiskFlag } from "./linkRisk";
import { publicLinkAddress } from "../linkDisplay";
import { pagePeekImage } from "./pagePeek";
import { SignedThumbImg } from "../signedThumb";

export function ReviewDestination({ link, pages, flags, trusted }: { link: ReviewLink; pages: ManagerPage[]; flags: RiskFlag[]; trusted: boolean }) {
  const host = domainOf(link.href);
  const expected = flags.find(f => f.expected)?.expected;
  const differences = host && expected ? differingCharacters(host, expected) : [];
  let suffix = "";
  try { const u = new URL(link.href); suffix = u.pathname === "/" && !u.search && !u.hash ? "" : u.pathname + u.search + u.hash; } catch { /* site path */ }
  const phone = link.href.replace(/^tel:/i, "");
  const number = /^\+?1?\d{10}$/.test(phone) ? phone.replace(/^(\+?1)?(\d{3})(\d{3})(\d{4})$/, "$1 ($2) $3-$4").trim() : phone;
  const main = host ?? (link.kind === "mail" ? link.href.replace(/^mailto:/i, "").split("?")[0] : link.kind === "phone" ? number : publicLinkAddress(link.href));
  const page = link.kind === "internal" ? pages.find(p => p.path === link.href.split(/[?#]/)[0]) : undefined;
  const image = page ? pagePeekImage(page) : null;
  return <div className="min-w-0 space-y-1">
    <p className="break-all leading-snug"><strong className="text-base font-bold text-foreground">{host && expected ? [...host].map((c, i) => <span key={i} className={differences[i] ? "nova-link-risk-character" : undefined}>{c}</span>) : main}</strong>{host && <span className="text-xs text-muted-foreground">{publicLinkAddress(suffix)}</span>}</p>
    {(host || link.kind === "mail" || link.kind === "phone") && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Globe className="h-3 w-3" aria-hidden />Leaves your site{trusted && <span className="ml-2 inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" aria-hidden />Trusted Domain</span>}</p>}
    {page && <div className="flex min-w-0 items-center gap-2 border-l-2 pl-2 py-1">
      {image && <SignedThumbImg url={image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded-lg object-cover" onError={e => { e.currentTarget.hidden = true; }} />}
      <div className="min-w-0 text-xs"><p className="break-words font-medium">{page.name}</p></div>
    </div>}
    {link.originalHref && link.originalHref !== link.href && <p className="break-all text-xs text-muted-foreground">was {publicLinkAddress(link.originalHref)} → now {publicLinkAddress(link.href)}</p>}
  </div>;
}
export function ReviewRiskFlags({ flags, onJump }: { flags: RiskFlag[]; onJump: (key: string) => void }) {
  const primary = strongestRisk(flags);
  if (!primary) return null;
  return <details className="nova-link-risk text-xs" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <summary className="flex min-h-11 cursor-pointer items-center gap-1 font-semibold">{primary.reason}</summary>
    <div className="space-y-1">{flags.filter(f => f !== primary).map((f, i) => <p key={i} className="break-words">{f.reason}</p>)}
      {flags.filter(f => f.otherKey).map((f, i) => <Button key={i} variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal break-words px-0 text-left text-xs nova-link-risk" onClick={() => { if (f.otherKey) onJump(f.otherKey); }}>Show Related Link</Button>)}
    </div>
  </details>;
}