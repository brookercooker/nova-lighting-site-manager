import { Button } from "@/components/ui/button";
import { Circle } from "lucide-react";
import type { ManagerPage, ReviewLink } from "./submitWalkthrough";
import { domainOf, differingCharacters, strongestRisk, type RiskFlag } from "./linkRisk";
import { publicLinkAddress } from "../linkDisplay";

export function ReviewDestination({ link, flags }: { link: ReviewLink; pages?: ManagerPage[]; flags: RiskFlag[]; trusted?: boolean }) {
  const host = domainOf(link.href);
  const expected = flags.find(f => f.expected)?.expected;
  const differences = host && expected ? differingCharacters(host, expected) : [];
  let suffix = "";
  try { const u = new URL(link.href); suffix = u.pathname === "/" && !u.search && !u.hash ? "" : u.pathname + u.search + u.hash; } catch { /* site path */ }
  return <div className="min-w-0 space-y-1">
    <p className="break-all text-sm leading-snug text-foreground">{host && expected ? <>{link.href.startsWith("https:") ? "https://" : "http://"}{[...host].map((c, i) => <span key={i} className={differences[i] ? "nova-link-risk-character" : undefined}>{c}</span>)}{publicLinkAddress(suffix)}</> : publicLinkAddress(link.href)}</p>
    {link.publishedHref !== null && link.originalHref && link.originalHref !== link.href && <p className="break-all text-xs text-muted-foreground">was {publicLinkAddress(link.originalHref)} → now {publicLinkAddress(link.href)}</p>}
  </div>;
}
export function ReviewRiskFlags({ flags, onJump }: { flags: RiskFlag[]; onJump: (key: string) => void }) {
  flags = flags.filter(f => f.kind !== "duplicate");
  const primary = strongestRisk(flags);
  if (!primary) return null;
  return <details className="text-xs text-foreground" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <summary className="flex cursor-pointer items-start gap-1 font-normal leading-normal"><Circle aria-hidden className="nova-link-risk mt-1 h-2 w-2 shrink-0 fill-current" />{primary.reason}</summary>
    <div className="space-y-1">{flags.filter(f => f !== primary).map((f, i) => <p key={i} className="break-words">{f.reason}</p>)}
      {flags.filter(f => f.otherKey).map((f, i) => <Button key={i} variant="ghost" className="h-auto min-h-11 w-full justify-start whitespace-normal break-words px-0 text-left text-xs nova-link-risk" onClick={() => { if (f.otherKey) onJump(f.otherKey); }}>Show Related Link</Button>)}
    </div>
  </details>;
}