import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil, ArrowRight, Check, ChevronDown, ExternalLink, Send, Undo2, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import { postToHelper } from "./helper";
import { useDesignChat } from "./DesignChatContext";
import { undoPendingGate } from "./logic";
import { useManagerLayout } from "./useManagerLayout";
import { useWalkthroughData, type WalkthroughData } from "./useWalkthroughData";
import { publicPreviewBase, publicPreviewPage } from "./publicPreviewUrl";
import { changeFingerprint, normPath, OTHER_KEY, checklistItems, itemTicked, linkChip, remaining, type Chip, type ManagerPage, type ChangedRow, type LinkGroup, type ReviewLink } from "./submitWalkthrough";
import { add, toggle, useWalk, walk, type WalkState, type WalkStep } from "./submitWalkthroughStore";
import { linkState, linkCheckList, linkAddress, linkText } from "./linkCheck";
import { shownPreviewFrame } from "./previewNavigate";
import { ReviewLinkEditor } from "./ReviewLinkEditor";
import { publicLinkAddress } from "../linkDisplay";
import { SharedPageUsage } from "./SharedPageUsage";
import { domainOf, groupRisks, riskRank } from "./linkRisk";
import { ReviewDestination, ReviewRiskFlags } from "./ReviewLinkRiskDetails";
import { useTrustedDomains, TrustedDomainList } from "./trustedDomains";
import { ReviewLinkTitle } from "./ReviewLinkTitle";

const missingInternalLink = (link: ReviewLink, pages: ManagerPage[]) =>
  linkChip(link, pages)?.tone === "bad";
const linkNeedsCheck = (link: ReviewLink, s: WalkState, pages: ManagerPage[]) =>
  !(link.key in s.linkReplaced) && (missingInternalLink(link, pages) || !s.linkTicked.includes(link.key));

/** Navigation that also works when the dialog is rendered outside a router (tests). */
function useGoToPreview(): () => void {
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const navigate = inRouter ? useNavigate() : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const location = inRouter ? useLocation() : null;
  return () => { if (navigate && location?.pathname !== "/manage/preview") navigate("/manage/preview"); };
}

const STEP_TITLE: Record<WalkStep, string> = { pages: "Design Check", links: "Verify Links", checklist: "Submit" };

/** Derived progress shared by the dialog and the preview bar. */
export function walkProgress(data: WalkthroughData, s = walk.get()) {
  const pageRows = data.rows;
  const pagesLeft = pageRows.filter((r) => !s.ticked.includes(r.key)).length;
  const allLinks = data.links.status === "ok" ? data.links.groups.flatMap((g) => g.links) : [];
  const hasLinksStep = data.links.status === "failed" || allLinks.length > 0 || s.step === "links";
  const linksLeft = allLinks.filter(l => linkNeedsCheck(l, s, data.pages)).length;
  const items = checklistItems(pageRows, allLinks.length > 0, pagesLeft === 0, linksLeft === 0);
  const checksLeft = items.filter((i) => !itemTicked(i, s.checks)).length;
  const steps: WalkStep[] = ["pages", ...(hasLinksStep ? ["links" as const] : []), "checklist"];
  const step = steps.includes(s.step) ? s.step : "checklist";
  return { pageRows, pagesLeft, allLinks, linksLeft, items, checksLeft, steps, step };
}

function pageCount(rows: ChangedRow[], ticked: string[]): string {
  if (!rows.length) return "No pages were changed in this draft.";
  return `${rows.filter((r) => ticked.includes(r.key)).length} of ${rows.length} ${rows.length === 1 ? "page" : "pages"} approved`;
}
const rowName = (r: ChangedRow) => r.shared?.name ?? r.page?.name ?? "Other site changes";
const rowPath = (r: ChangedRow) => r.page?.path ?? "/";
/** The draft site address for a page (new tab), or null when no draft address is configured. */
function draftPageUrl(path: string, embed: unknown = null): string | null {
  try { const base = publicPreviewBase(embed); return base ? publicPreviewPage(base, path) : null; } catch { return null; }
}

function linkPath(link: ReviewLink, group: LinkGroup): { path: string; part: string | null } {
  const [path, part] = link.href.split("#");
  return { path: path || group.page?.path || "/", part: part ? decodeURIComponent(part) : null };
}

/**
 * Submit for Review (or Publish): pages, links (when any changed) and a first-person checklist, then submit.
 * Compatibility opener; the walkthrough itself is hosted in the Manager's review column.
 */
export function SubmitConfirmDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void; fallback?: boolean }) {
  const { setReviewOpen } = useDesignChat();
  const requested = useRef(false);
  useEffect(() => {
    if (!open) { requested.current = false; return; }
    if (requested.current) return;
    requested.current = true;
    walk.open("panel"); setReviewOpen?.(true); onOpenChange(false);
  }, [open, setReviewOpen, onOpenChange]);
  return null;
}

export function SubmitWalkthroughPanel({ onKeepEditing, onCheckPhone, children }: { onKeepEditing: () => void; onCheckPhone?: () => void; children?: ReactNode }) {
  const { phone } = useManagerLayout();
  return <section aria-label="Submit for Review Walkthrough" data-submit-confirm className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <Walkthrough onClose={onKeepEditing} phone={phone} onCheckPhone={onCheckPhone} allChanges={children} />
  </section>;
}

function Walkthrough({ onClose, phone, onCheckPhone, allChanges }: { onClose: () => void; phone: boolean; onCheckPhone?: () => void; allChanges?: ReactNode }) {
  const { state, refreshSoon, selectPage, showPreviewPath } = useDesignChat() as ReturnType<typeof useDesignChat>;
  const s = useWalk();
  const data = useWalkthroughData(state, true);
  const p = walkProgress(data, s);
  const goToPreview = useGoToPreview();
  const [sending, setSending] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } headingRef.current?.focus(); }, [p.step]);
  const count = state?.publish?.open ?? 0;
  const pagePrints = Object.fromEntries(data.rows.map(r => [r.key, r.fingerprint ?? changeFingerprint(r)]));
  const linkPrints = linkFingerprints(data);
  useEffect(() => {
    if (data.pagesStatus && data.pagesStatus !== "ok") return;
    if (state && count === 0 && data.rows.length === 0) { walk.reset(); return; }
    walk.reconcile(pagePrints, data.links.status === "ok" ? linkPrints : undefined, data.links.status === "ok" ? ownLinkFingerprints(data) : undefined);
  }, [count, changeFingerprint(pagePrints), changeFingerprint(linkPrints), data.pagesStatus, data.links.status]);
  const reviewOn = state?.review?.enabled !== false;
  const label = reviewOn ? "Submit for Review" : "Publish";

  const idx = p.steps.indexOf(p.step);
  const setStep = (step: WalkStep) => walk.update((w) => ({ ...w, step }));

  const openPage = (path: string, checking: { key: string; kind: "page" | "link"; name: string }) => {
    walk.update((w) => ({ ...w, open: !phone, checking, ...(checking.kind === "page" ? { viewed: add(w.viewed, checking.key) } : { linkOpened: add(w.linkOpened, checking.key) }) }));
    if (phone) onCheckPhone?.();
    if (showPreviewPath) showPreviewPath(path); else selectPage?.({ name: checking.name, path });
    goToPreview();
  };
  // Open once per Submit; phone openPage collapses the review so the page is visible.
  useEffect(() => {
    if (!s.autoOpen) return;
    if (s.checking || p.step !== "pages") { walk.update(w => ({ ...w, autoOpen: false })); return; }
    if (data.pagesStatus !== "ok") return;
    const r = p.pageRows.find(x => x.page);
    walk.update(w => ({ ...w, autoOpen: false }));
    if (r) openPage(rowPath(r), { key: r.key, kind: "page", name: rowName(r) });
  }, [s.autoOpen, phone, s.checking, p.step, data.pagesStatus, p.pageRows]);
  const left = remaining(p.pagesLeft, p.steps.includes("links") ? p.linksLeft : 0, p.checksLeft);
  const undoGate = undoPendingGate(state);
  const pagesReady = !data.pagesStatus || data.pagesStatus === "ok";
  const canSubmit = !left && !sending && !undoGate && pagesReady && data.links.status !== "loading" && !!state && !state.busy && count > 0 && (state.publish?.ok !== false || state.publish?.willReview === true);
  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    try { const res = await postToHelper("/publish"); if (res?.ok) walk.reset(); refreshSoon(); onClose(); }
    finally { setSending(false); }
  };
  const nextDisabled = p.step === "pages" ? p.pagesLeft > 0 || !pagesReady || data.links.status === "loading" : p.step === "links" ? p.linksLeft > 0 || data.links.status === "loading" : true;
  const changes = `${count} ${count === 1 ? "change" : "changes"}`;

  return (
    <>
      <div className="shrink-0 space-y-2 border-b px-3 py-3">
        <Button type="button" variant="outline" className="h-11 w-full justify-start" onClick={() => { walk.keepEditing(); onClose(); }}><ArrowLeft className="h-4 w-4" aria-hidden />Keep Editing</Button>
        <p className="text-xs text-muted-foreground" aria-live="polite">Step {idx + 1} of {p.steps.length} · {STEP_TITLE[p.step]}</p>
        <h2 ref={headingRef} tabIndex={-1} className="font-sans text-lg font-semibold outline-none">{STEP_TITLE[p.step]}</h2>
        {p.step !== "pages" && <p className="text-xs leading-relaxed text-muted-foreground">
          {p.step === "links" ? "Open and confirm each link."
            : reviewOn ? "Approved changes go live after review."
            : `Publishes ${changes} on the public site right away.`}
        </p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3">
        {p.step === "pages" && (pagesReady ? <PagesStep rows={p.pageRows} data={data} onView={(r) => openPage(rowPath(r), { key: r.key, kind: "page", name: rowName(r) })} /> : <p role="status" className="text-sm text-muted-foreground">{data.pagesStatus === "failed" ? "Changed pages couldn't be listed right now. Close and reopen to try again." : "Listing the changed pages…"}</p>)}
        {p.step === "links" && <LinksStep data={data} onShow={(l, g) => {
          const path = g.page?.path ?? p.pageRows.find(r => r.page)?.page?.path ?? "/";
          walk.update(w => ({ ...w, reviewEdit: null, openingLink: { key: l.key, path, name: g.page?.name ?? "Homepage", href: l.href, entries: data.links.status === "ok" ? linkCheckList(data.links.groups, w.linkTicked, w.linkReplaced) : [] } }));
          openPage(path, { key: l.key, kind: "link", name: linkText(l, data.pages) });
        }} onChange={(l, g) => walk.editLink({ link: l, group: g, rows: p.pageRows, fingerprint: ownLinkPrint(l) })} />}
        {p.step === "checklist" && (
          <ul className="space-y-3" aria-label="Submission Checklist">
            {p.items.map((item) => {
              const ticked = itemTicked(item, s.checks);
              const lockedItem = item.id === "pages" || item.id === "links";
              return (
                <li key={item.id} className="flex min-h-11 items-start gap-3">
                  <Checkbox id={`check-${item.id}`} className="mt-1 h-5 w-5" checked={ticked} disabled={lockedItem}
                    onCheckedChange={(v) => walk.update((w) => ({ ...w, checks: toggle(w.checks, item.id, v === true) }))} />
                  <label htmlFor={`check-${item.id}`} aria-live="polite" className={cn("text-sm", !lockedItem && "cursor-pointer")}>
                    {ticked ? item.done : item.todo}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {allChanges && <details className="mt-4 border-t pt-3"><summary className="cursor-pointer min-h-9 text-sm font-medium">All Changes</summary>{allChanges}</details>}
      </div>
      <div className="shrink-0 space-y-2 border-t px-3 py-3">
        {p.step === "pages" && pagesReady && <p className="text-sm" aria-live="polite">{pageCount(p.pageRows, s.ticked)}</p>}
        {p.step === "links" && data.links.status === "ok" && <p className="text-sm" aria-live="polite">{p.allLinks.length - p.linksLeft} of {p.allLinks.length} links approved</p>}
        {p.step === "checklist" && left && <p className="text-sm text-muted-foreground" aria-live="polite">{left.charAt(0).toUpperCase() + left.slice(1)}.</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {idx > 0 && <Button type="button" variant="outline" className="h-11" disabled={sending} title={`Back to ${STEP_TITLE[p.steps[idx - 1]]}`} onClick={() => setStep(p.steps[idx - 1])}><ArrowLeft className="h-4 w-4" aria-hidden />Back</Button>}
          {p.step !== "checklist"
            ? <Button type="button" className="h-11" disabled={nextDisabled} title={`Next: ${STEP_TITLE[p.steps[idx + 1]]}`} onClick={() => setStep(p.steps[idx + 1])}>Next<ArrowRight className="h-4 w-4" aria-hidden /></Button>
            : <Button type="button" variant="review" className="h-11" disabled={!canSubmit} onClick={() => void submit()}><Send className="h-4 w-4" aria-hidden />{sending ? "Sending…" : label}</Button>}
        </div>
      </div>
    </>
  );
}

function Approval({ approved, enabled, onClick, hint }: { approved: boolean; enabled: boolean; onClick: () => void; hint: string }) {
  return <div className="space-y-1">
    <Button type="button" variant={approved ? "secondary" : "outline"} className="h-9 w-full sm:w-auto" disabled={!enabled} aria-pressed={approved} title={approved ? "Undo Approval" : undefined} onClick={onClick}>
      {approved ? <Check className="h-4 w-4" aria-hidden /> : null}{approved ? "Approved" : "Approve"}{approved && <Undo2 className="h-3 w-3" aria-hidden />}
    </Button>
    {!enabled && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
}

function NewTab({ href, onOpen }: { href: string; onOpen: () => void }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild>
    <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"><a href={href} target="_blank" rel="noopener noreferrer" aria-label="Open Link to Verify" onClick={onOpen}><ExternalLink className="h-4 w-4" aria-hidden /></a></Button>
  </TooltipTrigger><TooltipContent>Open Link to Verify</TooltipContent></Tooltip></TooltipProvider>;
}

function PagesStep({ rows, data, onView }: { rows: ChangedRow[]; data: WalkthroughData; onView: (r: ChangedRow) => void }) {
  const s = useWalk();
  if (!rows.length) return <p className="text-sm text-muted-foreground">No pages were changed in this draft.</p>;
  return <><ul className="space-y-3" aria-label="Design Check Pages">{rows.map(r => {
    const approved = s.ticked.includes(r.key), viewed = s.viewed.includes(r.key);
    const tab = r.page ? draftPageUrl(r.page.path) : null;
    return <li key={r.key} data-walk-row={r.key} className={cn("min-w-0 rounded-md border p-3 space-y-2", s.checking?.key === r.key && "border-primary bg-primary/5")}>
      <div className="flex items-start gap-1">
        <Button type="button" variant="link" className="h-auto min-h-9 min-w-0 flex-1 justify-start whitespace-normal p-0 text-left text-sm font-semibold text-foreground" onClick={() => onView(r)}>{rowName(r)}</Button>
        <Badge variant="secondary" className="mt-2 shrink-0 text-[10px]" aria-live="polite">{approved ? "Approved" : "Not Reviewed"}</Badge>
        {tab && <NewTab href={tab} onOpen={() => walk.update(w => ({ ...w, viewed: add(w.viewed, r.key), checking: { key: r.key, kind: "page", name: rowName(r) } }))} />}
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">{rowPath(r)}</p>
      {r.guess && <p className="text-xs text-muted-foreground">(best guess)</p>}
      {(r.how || r.by) && <p className="break-words text-xs text-muted-foreground">{[r.how, r.by ? `by ${r.by}` : ""].filter(Boolean).join(" · ")}</p>}
      {r.shared && <SharedPageUsage pages={r.shared.pages} />}
      {s.changed.includes(r.key) && <p role="status" className="text-xs text-muted-foreground">Changed since you approved it</p>}
      {r.key === OTHER_KEY && <Button type="button" variant="link" className="h-9 p-0" onClick={() => onView(r)}>Open Site</Button>}
      <Approval approved={approved} enabled={approved || viewed} hint="Open the page first" onClick={() => walk.approve(r.key, r.fingerprint ?? changeFingerprint(r))} />
    </li>;
  })}</ul></>;
}

export function linkFingerprints(data: WalkthroughData): Record<string, string> {
  return ownLinkFingerprints(data);
}

/** Only this link's destination, target and stored identity invalidate its decisions. */
export const ownLinkPrint = (l: ReviewLink) => changeFingerprint({ key: l.key, href: l.href, target: l.target ?? null, elementKey: l.elementKey ?? null, scope: l.scope ?? null });
export function ownLinkFingerprints(data: WalkthroughData): Record<string, string> {
  return Object.fromEntries(data.links.status === "ok" ? data.links.groups.flatMap(g => g.links.map(l => [l.key, ownLinkPrint(l)])) : []);
}

const CHIP_TONE: Record<Chip["tone"], string> = { ok: "border-border bg-secondary text-secondary-foreground", warn: "border-border bg-muted text-foreground", bad: "border-destructive bg-destructive text-destructive-foreground" };

function LinksStep({ data, onShow, onChange }: { data: WalkthroughData; onShow: (l: ReviewLink, g: LinkGroup) => void; onChange: (l: ReviewLink, g: LinkGroup) => void }) {
  const s = useWalk();
  const { preview } = useDesignChat();
  const { phone } = useManagerLayout();
  const trust = useTrustedDomains();
  const expanded = s.groupExpansion;
  const setExpanded = (fn: (e: Record<string, boolean>) => Record<string, boolean>) => walk.update(w => ({ ...w, groupExpansion: fn(w.groupExpansion) }));
  const manuallyOpened = useRef(new Set<string>(Object.keys(s.groupExpansion).filter(k => s.groupExpansion[k])));
  const orderedKeys = useRef<{ signature: string; groups: string[]; links: Record<string, string[]> }>({ signature: "", groups: [], links: {} });
  const groupId = (g: LinkGroup) => g.shared?.id ?? g.page?.path ?? g.label;
  const rawGroups = data.links.status === "ok" ? data.links.groups : [];
  const names = Object.fromEntries(rawGroups.flatMap(g => g.links.map(l => [l.key, linkText(l, data.pages)])));
  const known = (data.inventoryLinks ?? []).map(l => domainOf(l.href)).filter((h): h is string => !!h);
  const riskFlags = Object.assign({}, ...rawGroups.map(g => groupRisks(g, names, known, trust.domains))) as Record<string, import("./linkRisk").RiskFlag[]>;
  const sortSignature = changeFingerprint(rawGroups.map(g => [groupId(g), g.links.map(l => [l.key, l.href, l.originalHref])])) ;
  if (data.links.status === "ok" && orderedKeys.current.signature !== sortSignature) {
    const rank = (l: ReviewLink) => riskRank(l, data.pages, riskFlags[l.key] ?? []);
    const sorted = rawGroups.map(g => ({ ...g, links: [...g.links].sort((a,b) => rank(a)-rank(b)) })).sort((a,b) => Math.min(...a.links.map(rank))-Math.min(...b.links.map(rank)));
    orderedKeys.current = { signature: sortSignature, groups: sorted.map(groupId), links: Object.fromEntries(sorted.map(g => [groupId(g), g.links.map(l => l.key)])) };
  }
  const orderedGroups = [...rawGroups].sort((a,b) => orderedKeys.current.groups.indexOf(groupId(a))-orderedKeys.current.groups.indexOf(groupId(b))).map(g => ({ ...g, links: [...g.links].sort((a,b) => (orderedKeys.current.links[groupId(g)] ?? []).indexOf(a.key)-(orderedKeys.current.links[groupId(g)] ?? []).indexOf(b.key)) }));
  const completedGroups = useRef<Set<string>>(new Set(Object.keys(s.groupCompleted).filter(k => s.groupCompleted[k])));
  const groupProgress = data.links.status === "ok" ? data.links.groups.map(g => `${g.shared?.id ?? g.page?.path ?? g.label}:${g.links.every(l => !linkNeedsCheck(l, s, data.pages))}`).join("|") : "";
  useEffect(() => {
    if (data.links.status !== "ok") return;
    const complete = new Set(data.links.groups.filter(g => g.links.every(l => !linkNeedsCheck(l, s, data.pages))).map(g => g.shared?.id ?? g.page?.path ?? g.label));
    const reopened = [...completedGroups.current].filter(id => !complete.has(id));
    const newly = [...complete].filter(id => !completedGroups.current.has(id) && !manuallyOpened.current.has(id));
    completedGroups.current = complete;
    if (newly.length || reopened.length) walk.update(w => ({ ...w, groupCompleted: Object.fromEntries(data.links.status === "ok" ? data.links.groups.map(g => [groupId(g), complete.has(groupId(g))]) : []), groupExpansion: { ...w.groupExpansion, ...Object.fromEntries(newly.map(id => [id, false])), ...Object.fromEntries(reopened.map(id => [id, true])) } }));
  }, [groupProgress]);
  useEffect(() => {
    if (data.links.status !== "ok" || !s.selectedLink) return;
    const g = data.links.groups.find(g => g.links.some(l => l.key === s.selectedLink?.key));
    if (g) setExpanded(e => ({ ...e, [g.shared?.id ?? g.page?.path ?? g.label]: true }));
  }, [s.selectedLink?.sequence, s.selectedLink?.key]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!s.selectedLink) return;
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-walk-link]") ?? []).find(el => el.dataset.walkLink === s.selectedLink?.key);
    row?.scrollIntoView?.({ block: "nearest" });
    row?.querySelector<HTMLElement>("[data-verify-link]")?.focus({ preventScroll: true });
  }, [s.selectedLink, data.links.status, changeFingerprint(expanded)]);
  if (data.links.status === "failed") return <p role="status" className="text-sm">Links couldn't be listed right now.</p>;
  if (data.links.status !== "ok") return <p className="text-sm text-muted-foreground">Listing the changed links…</p>;
  const { unread, partial, truncated } = data.links;
  const groups = orderedGroups;
  return (
    <div ref={listRef} className="space-y-4">
      <TrustedDomainList trust={trust} />
      <div className="grid grid-cols-2 gap-2"><Button variant="ghost" className="h-11 px-2 text-xs" onClick={() => { manuallyOpened.current.clear(); setExpanded(() => Object.fromEntries(groups.map(g => [groupId(g), false]))); }}>Collapse All</Button><Button variant="ghost" className="h-11 px-2 text-xs" onClick={() => { groups.forEach(g => manuallyOpened.current.add(groupId(g))); setExpanded(() => Object.fromEntries(groups.map(g => [groupId(g), true]))); }}>Expand All</Button></div>
      {s.linkNote && <p role="status" className="rounded-md border bg-secondary p-3 text-sm">{s.linkNote}</p>}
      {unread > 0 && <p className="text-xs text-muted-foreground">{unread} {unread === 1 ? "change" : "changes"} couldn't be checked for links. Check those pages by hand.</p>}
      {(partial || truncated) && <p className="text-xs text-muted-foreground">Some links may be missing from this list.</p>}
      {groups.map((g) => {
        const id = g.shared?.id ?? g.page?.path ?? g.label;
        const handled = g.links.filter(l => !linkNeedsCheck(l, s, data.pages)).length;
        const open = expanded[id] ?? handled < g.links.length;
        return (
        <section key={g.label + (g.page?.path ?? "")} aria-label={g.label}>
          <h3 className="mb-2"><Button type="button" variant="ghost" className="min-h-11 h-auto w-full justify-between whitespace-normal px-0 text-left text-sm font-semibold" aria-expanded={open} onClick={() => { if (!open) manuallyOpened.current.add(id); else manuallyOpened.current.delete(id); setExpanded(e => ({ ...e, [id]: !open })); }}><span className="min-w-0 break-words">{g.label} · {handled === g.links.length ? "done" : `${handled} of ${g.links.length}`}</span>{handled === g.links.length && <Check aria-hidden className="h-4 w-4 shrink-0" />}<ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0", !open && "-rotate-90")} /></Button></h3>
          {g.shared && <div><Badge variant="secondary">Site-wide · {g.shared.pages.length} Pages</Badge><SharedPageUsage pages={g.shared.pages} /></div>}
          {open && <ul className="space-y-2">
            {g.links.map((l) => {
              const chip = linkChip(l, data.pages);
              const manual = l.kind === "mail" || l.kind === "phone";
              const address = publicLinkAddress(manual ? l.href.replace(/^(mailto|tel):/i, "") : l.href);
              const part = l.kind === "anchor" ? linkPath(l, g).part : null;
              const missing = missingInternalLink(l, data.pages);
              const st = missing && !(l.key in s.linkReplaced) ? "todo" : linkState(l.key, s.linkTicked, s.linkReplaced);
              const own = ownLinkPrint(l);
              const opened = s.verificationOpened[l.key] === own;
              const opening = s.openingLink?.key === l.key;
              const enabled = !missing && !opening && opened;
              const dest = l.kind === "internal" || l.kind === "anchor" ? sitePath(l.href, l.href, g.page?.path ?? "/") : null;
              const embed = preview?.frames.find(f => f.id === preview.shownId)?.url ?? preview?.frames.at(-1)?.url;
              const tabUrl = dest ? draftPageUrl(dest, embed) : /^(https?:|mailto:|tel:)/i.test(l.href) ? l.href : null;
              const flags = riskFlags[l.key] ?? [];
              const host = domainOf(l.href);
              const hintId = `verify-${encodeURIComponent(l.key)}`;
              const name = linkText(l, data.pages);
              const friendlyName = name === linkAddress(l) ? `Text link on ${g.page?.name ?? "Homepage"}` : name;
              return (
                <li key={l.key} data-walk-link={l.key} role="button" tabIndex={0} aria-label={`Show ${publicLinkAddress(friendlyName)} on the page`}
                  onClick={e => { if (e.target instanceof Element && e.target.closest("button,a,input,[role='switch'],[data-review-editor]")) return; onShow(l, g); }}
                  onKeyDown={e => { if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return; e.preventDefault(); onShow(l, g); }}
                  className={cn("space-y-2 min-w-0 rounded-md border p-3 cursor-pointer transition-colors hover:bg-accent active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", st === "done" && "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 active:bg-foreground/10", (s.selectedLink?.key === l.key || s.checking?.key === l.key) && "border-primary bg-primary/5 ring-2 ring-ring ring-offset-2")}>
                  <ReviewLinkTitle key={`${l.key}|${l.image?.src ?? ""}`} link={name === linkAddress(l) ? { ...l, label: friendlyName } : l} pages={data.pages} />
                  {st === "todo" && s.changed.includes(l.key) && <p role="status" className="text-xs text-muted-foreground">Changed since you approved it</p>}
                  <ReviewDestination link={l} pages={data.pages} flags={flags} trusted={!!host && trust.domains.includes(host)} />
                  <ReviewRiskFlags flags={flags} onJump={key => walk.selectLink(key)} />
                  {g.shared && <SharedPageUsage pages={g.shared.pages} />}
                  {chip && <p className="flex flex-wrap items-center gap-2 text-xs"><span className={cn("rounded-full border px-2 py-0.5", CHIP_TONE[chip.tone])}>{chip.text}</span>{chip.detail && <span className="break-words text-muted-foreground">{chip.detail}</span>}</p>}
                  {chip?.tone === "bad" && !missing && <p className="text-xs text-destructive">{missingInternalLink(l, data.pages) ? "This page doesn't exist. Edit the link destination to fix it." : "This address couldn't be reached. Check the destination."}</p>}
                  {part && <p className="text-xs text-muted-foreground">Opens the part of the page called “{part}”.</p>}
                  {st !== "replaced" && <>
                    {tabUrl && <Button asChild variant="ghost" className="h-11 w-full min-w-0 whitespace-nowrap px-2 text-sm text-muted-foreground"><a data-verify-link href={tabUrl} target="_blank" rel="noopener noreferrer" onClick={e => { e.stopPropagation(); walk.openedVerification(l.key, own); }}><ExternalLink aria-hidden />Open Link to Verify</a></Button>}
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant={st === "done" ? "secondary" : "default"} className="h-11 w-full min-w-0 whitespace-nowrap px-2 text-sm" aria-label={`Confirmed: ${publicLinkAddress(friendlyName)}`} aria-pressed={st === "done"} disabled={!enabled} aria-describedby={hintId} onClick={e => { e.stopPropagation(); if (enabled) walk.confirmLink(l.key, own, st !== "done"); }}><Check aria-hidden className={cn("h-4 w-4", st === "done" && "rounded-full bg-foreground text-background p-0.5")} />Confirmed</Button>
                      <Button type="button" data-verify-link={manual || !tabUrl ? true : undefined} variant="default" className="h-11 w-full min-w-0 whitespace-nowrap px-2 text-sm" disabled={opening} aria-label={`Correct link: ${publicLinkAddress(friendlyName)}`} onClick={e => { e.stopPropagation(); onChange(l, g); }}><Pencil aria-hidden />Correct</Button>
                    </div>
                    <p id={hintId} className="text-xs text-muted-foreground">{missing ? "This page doesn't exist. Edit the link destination to fix it." : opening ? `Opening ${s.openingLink?.name}…` : st === "done" ? "Approved" : !opened ? "Open link to confirm" : ""}</p>
                  </>}
                  {st === "done" && host && trust.isAdmin && !trust.domains.includes(host) && !flags.some(f => ["lookalike", "punycode", "insecure"].includes(f.kind)) && <Button variant="outline" className="h-auto min-h-11 w-full whitespace-normal break-all px-2 text-xs" disabled={trust.pending} onClick={e => { e.stopPropagation(); void trust.change(host); }}>Trust {host}</Button>}
                  {s.reviewEdit?.link.key === l.key && <div data-review-editor onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><ReviewLinkEditor pages={data.pages} /></div>}
                </li>
              );
            })}
          </ul>}
        </section>
      ); })}
      {groups.some(g => g.links.some(l => linkNeedsCheck(l, s, data.pages))) && <Button type="button" variant="outline" className="min-h-11 h-auto w-full whitespace-normal px-2" onClick={() => {
        const all = groups.flatMap(g => g.links.map(l => ({ l, g })));
        const at = all.findIndex(x => x.l.key === s.checking?.key || x.l.key === s.selectedLink?.key);
        const next = [...all.slice(at + 1), ...all.slice(0, at + 1)].find(x => linkNeedsCheck(x.l, s, data.pages));
        if (!next) return;
        setExpanded(e => ({ ...e, [next.g.shared?.id ?? next.g.page?.path ?? next.g.label]: true }));
        walk.selectLink(next.l.key); onShow(next.l, next.g);
      }}><ArrowRight aria-hidden />Jump to Next Unconfirmed Link</Button>}
    </div>
  );
}

/** Slim bar above the preview while a page or link from the walkthrough is open. */
export function WalkthroughCheckBar(): ReactNode {
  const s = useWalk();
  // The lookups only mount while checking, so an idle preview never queries anything.
  return s.checking ? <CheckBar c={s.checking} /> : null;
}

function CheckBar({ c }: { c: NonNullable<ReturnType<typeof walk.get>["checking"]> }) {
  const { state, setReviewOpen } = useDesignChat();
  const s = useWalk();
  const data = useWalkthroughData(state, true);
  const pageRows = data.rows;
  const at = pageRows.findIndex((r) => r.key === c.key);
  const back: WalkStep = c.kind === "page" ? "pages" : "links";
  const ready = (!data.pagesStatus || data.pagesStatus === "ok") && data.links.status !== "loading";
  const fingerprints = Object.fromEntries(data.rows.map(r => [r.key, r.fingerprint ?? changeFingerprint(r)]));
  const links = linkFingerprints(data);
  useEffect(() => { if (ready) walk.reconcile(fingerprints, data.links.status === "ok" ? links : undefined, data.links.status === "ok" ? ownLinkFingerprints(data) : undefined); }, [ready, changeFingerprint(fingerprints), changeFingerprint(links)]);
  const enabled = ready && c.kind === "page" && s.viewed.includes(c.key);
  const [guidance, setGuidance] = useState(false);
  const approved = s.ticked.includes(c.key);
  const yup = () => {
    if (!enabled) return;
    walk.approve(c.key, data.rows.find(r => r.key === c.key)?.fingerprint ?? changeFingerprint(data.rows.find(r => r.key === c.key)));
    walk.reopen(back); setReviewOpen?.(true);
  };
  return <>
    <div role="region" aria-label="Checking Changes" className="sticky top-0 z-40 flex h-14 min-w-0 shrink-0 items-center gap-1 border-b bg-secondary px-1 text-secondary-foreground">
      <Button type="button" variant="ghost" className="h-11 w-11 shrink-0 p-0" aria-label="Back to review" onClick={() => { walk.reopen(back); setReviewOpen?.(true); }}><ArrowLeft aria-hidden className="h-4 w-4" /></Button>
      <p className="min-w-0 flex-1 truncate text-xs" title={c.name}>{c.kind === "page" ? c.name : `Checking ${c.name}`}{c.kind === "page" && at >= 0 ? ` · ${at + 1} of ${pageRows.length}` : ""}</p>
      {c.kind === "page" && <Button type="button" className="h-11 shrink-0 gap-1 px-2 text-xs" disabled={!enabled} aria-pressed={approved} onClick={yup}><Check aria-hidden className="h-4 w-4" />{approved ? "Approved" : "Approve"}</Button>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="h-11 w-11 shrink-0 p-0" aria-label="Review Options"><MoreHorizontal aria-hidden className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11" onSelect={() => { walk.keepEditing(); setReviewOpen?.(false); }}>Keep Editing</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => setGuidance(true)}>Things to Look At</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </div>
    <Dialog open={guidance} onOpenChange={setGuidance}><DialogContent className="w-[calc(100vw-24px)] max-w-lg"><DialogHeader><DialogTitle>Things to Look At</DialogTitle></DialogHeader><ul className="list-disc space-y-2 pl-4 text-sm"><li>Changed wording</li><li>Pictures and layout</li><li>Phone appearance</li></ul></DialogContent></Dialog>
  </>;

}

/** The address a link leads to inside the public site (path, query and part), or null when it isn't one. */
function sitePath(href: string, raw: string, page: string | null): string | null {
  if (raw.startsWith("#")) return (page ?? "/") + raw;
  if (/^\/(?!\/)/.test(raw)) return raw;
  try {
    const base = publicPreviewBase(null);
    const url = new URL(href, base);
    return url.origin === new URL(base).origin ? url.pathname + url.search + url.hash : null;
  } catch { return null; }
}
