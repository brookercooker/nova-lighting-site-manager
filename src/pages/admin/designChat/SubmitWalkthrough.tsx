import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Pencil, ArrowRight, Check, ChevronDown, ExternalLink, Eye, Send, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { changeFingerprint, OTHER_KEY, checklistItems, internalLinkChip, itemTicked, linkChip, remaining, type Chip, type ManagerPage, type ChangedRow, type LinkGroup, type ReviewLink } from "./submitWalkthrough";
import { add, toggle, useWalk, walk, type WalkState, type WalkStep } from "./submitWalkthroughStore";
import { KIND_TEXT, LINK_BADGE, LINK_HINT, PAGE_SUGGESTIONS, linkState, focusWhenReady, linkAddress, linkText, linksNeedChecking, linkResolved, matchChangedLink, pageChecks, pageLinks, postLinkFocus, type PageCheck } from "./linkCheck";
import { shownPreviewFrame } from "./previewNavigate";
import { ReviewLinkEditor } from "./ReviewLinkEditor";

/** Navigation that also works when the dialog is rendered outside a router (tests). */
function useGoToPreview(): () => void {
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const navigate = inRouter ? useNavigate() : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const location = inRouter ? useLocation() : null;
  return () => { if (navigate && location?.pathname !== "/manage/preview") navigate("/manage/preview"); };
}

const STEP_TITLE: Record<WalkStep, string> = { pages: "Check the Changed Pages", links: "Check the Changed Links", checklist: "Checklist and Submit" };

/** Derived progress shared by the dialog and the preview bar. */
export function walkProgress(data: WalkthroughData, s = walk.get()) {
  const pageRows = data.rows;
  const pagesLeft = pageRows.filter((r) => !s.ticked.includes(r.key)).length;
  const allLinks = data.links.status === "ok" ? data.links.groups.flatMap((g) => g.links) : [];
  const hasLinksStep = data.links.status === "failed" || allLinks.length > 0 || s.step === "links";
  const linksLeft = allLinks.filter((l) => !linkResolved(linkState(l.key, s.linkTicked, s.linkReplaced))).length;
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
const rowName = (r: ChangedRow) => r.page?.name ?? "Other site changes";
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
  // Open the first changed page once per Submit opening, as if its name were clicked (not on phones).
  useEffect(() => {
    if (!s.autoOpen) return;
    if (phone || s.checking || p.step !== "pages") { walk.update(w => ({ ...w, autoOpen: false })); return; }
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
        <p className="text-xs text-muted-foreground" aria-live="polite">Step {idx + 1} of {p.steps.length}</p>
        <h2 ref={headingRef} tabIndex={-1} className="font-sans text-lg font-semibold outline-none">{STEP_TITLE[p.step]}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {p.step === "pages" ? "Open each changed page and approve it once it looks right."
            : p.step === "links" ? "Check each link that was added or changed. Confirming it in Check This Link approves it."
            : reviewOn ? "Your changes will be reviewed automatically, and anything it can't approve may go to a developer. Approved changes are put on the public site."
            : `This puts all ${changes} waiting in your draft on the public site right away. Visitors will see these changes as soon as publishing finishes.`}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-3">
        {p.step === "pages" && (pagesReady ? <PagesStep rows={p.pageRows} data={data} onView={(r) => openPage(rowPath(r), { key: r.key, kind: "page", name: rowName(r) })} /> : <p role="status" className="text-sm text-muted-foreground">{data.pagesStatus === "failed" ? "Changed pages couldn't be listed right now. Close and reopen to try again." : "Listing the changed pages…"}</p>)}
        {p.step === "links" && <LinksStep data={data} onShow={(l, g) => {
          const path = g.page?.path ?? p.pageRows.find(r => r.page)?.page?.path ?? "/";
          const already = walk.get().checking?.key === l.key;
          if (!already) openPage(path, { key: l.key, kind: "link", name: linkText(l, data.pages) });
          if (already) postLinkFocus(shownPreviewFrame(document), l.href); else focusWhenReady(() => shownPreviewFrame(document), l.href);
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
                    {lockedItem && !ticked && <span className="block text-xs text-muted-foreground">{item.id === "pages" ? "This ticks itself once every page is approved." : "This ticks itself once every link is approved."}</span>}
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
          {idx > 0 && <Button type="button" variant="outline" className="h-11" disabled={sending} onClick={() => setStep(p.steps[idx - 1])}><ArrowLeft className="h-4 w-4" aria-hidden />Back</Button>}
          {p.step !== "checklist"
            ? <Button type="button" className="h-11" disabled={nextDisabled} onClick={() => setStep(p.steps[idx + 1])}>Next<ArrowRight className="h-4 w-4" aria-hidden /></Button>
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

/** "Things to Look At on Each Page": plain bullets, never ticked or stored. */
function Suggestions({ className }: { className?: string }) {
  return <div data-page-suggestions className={className}>
    <p className="text-xs font-medium text-muted-foreground">Things to Look At on Each Page</p>
    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{PAGE_SUGGESTIONS.map(t => <li key={t}>{t}</li>)}</ul>
  </div>;
}

/** Opens the Check This Link window for a link the reviewer picked or clicked. */
export function openLinkCheck(raw: string, kind: ReviewLink["kind"], label: string | null, page: string | null, href = raw) {
  walk.update(w => ({ ...w, linkCheck: { raw, href, kind, label, path: page, page } }));
}

function PagesStep({ rows, data, onView }: { rows: ChangedRow[]; data: WalkthroughData; onView: (r: ChangedRow) => void }) {
  const s = useWalk();
  if (!rows.length) return <p className="text-sm text-muted-foreground">No pages were changed in this draft.</p>;
  return <><Suggestions className="mb-2" /><ul className="space-y-3" aria-label="Changed Pages">{rows.map(r => {
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
      {s.changed.includes(r.key) && <p role="status" className="text-xs text-muted-foreground">Changed since you approved it</p>}
      {r.key === OTHER_KEY && <Button type="button" variant="link" className="h-9 p-0" onClick={() => onView(r)}>Open Site</Button>}
      <Approval approved={approved} enabled={approved || viewed} hint="Open the page first" onClick={() => walk.approve(r.key, r.fingerprint ?? changeFingerprint(r))} />
    </li>;
  })}</ul></>;
}

export function linkFingerprints(data: WalkthroughData): Record<string, string> {
  return Object.fromEntries(data.links.status === "ok" ? data.links.groups.flatMap(g => g.links.map(l => [l.key, changeFingerprint({ page: g.page?.path, links: g.links.map(x => ({ key: x.key, href: x.href, requestIds: x.requestIds })).sort((a,b) => a.key.localeCompare(b.key)), pageChange: data.rows.find(r => r.page?.path === g.page?.path)?.fingerprint })])) : []);
}

/** One link's own fingerprint: its key, address and the requests that changed it. Unaffected by hand edits elsewhere on the page. */
export const ownLinkPrint = (l: ReviewLink) => changeFingerprint({ key: l.key, href: l.href, requestIds: [...l.requestIds].sort() });
export function ownLinkFingerprints(data: WalkthroughData): Record<string, string> {
  return Object.fromEntries(data.links.status === "ok" ? data.links.groups.flatMap(g => g.links.map(l => [l.key, ownLinkPrint(l)])) : []);
}

const CHIP_TONE: Record<Chip["tone"], string> = { ok: "border-border bg-secondary text-secondary-foreground", warn: "border-border bg-muted text-foreground", bad: "border-destructive bg-destructive text-destructive-foreground" };

function LinksStep({ data, onShow, onChange }: { data: WalkthroughData; onShow: (l: ReviewLink, g: LinkGroup) => void; onChange: (l: ReviewLink, g: LinkGroup) => void }) {
  const s = useWalk();
  if (data.links.status === "failed") return <p role="status" className="text-sm">Links couldn't be listed right now. Open the changed pages and click the links you added or changed.</p>;
  if (data.links.status !== "ok") return <p className="text-sm text-muted-foreground">Listing the changed links…</p>;
  const { groups, unread, partial, truncated } = data.links;
  return (
    <div className="space-y-4">
      {unread > 0 && <p className="text-xs text-muted-foreground">{unread} {unread === 1 ? "change" : "changes"} couldn't be checked for links. Check those pages by hand.</p>}
      {(partial || truncated) && <p className="text-xs text-muted-foreground">Some links may be missing from this list.</p>}
{(() => { const all = groups.flatMap(g => g.links); const left = all.filter(l => !linkResolved(linkState(l.key, s.linkTicked, s.linkReplaced))).length;
        return !all.length || !left ? <p role="status" className="text-sm">Nothing is left to check here. Press Next to continue.</p>
          : <p className="text-xs text-muted-foreground">{LINK_HINT} Use Check This Link to confirm each one.</p>; })()}
      {groups.map((g) => (
        <section key={g.label + (g.page?.path ?? "")} aria-label={g.label}>
          <h3 className="mb-2 text-sm font-semibold">{g.label}</h3>
          <ul className="space-y-2">
            {g.links.map((l) => {
              const chip = linkChip(l, data.pages);
              const manual = l.kind === "mail" || l.kind === "phone";
              const address = manual ? l.href.replace(/^(mailto|tel):/i, "") : l.href;
              const part = l.kind === "anchor" ? linkPath(l, g).part : null;
              const st = linkState(l.key, s.linkTicked, s.linkReplaced);
              return (
                <li key={l.key} data-walk-link={l.key} className={cn("space-y-2 min-w-0 rounded-md border p-3", s.checking?.key === l.key && "border-primary bg-primary/5")}>
                  <div className="flex items-start gap-1"><p className="min-w-0 flex-1 break-words text-sm font-medium">{linkText(l, data.pages)}</p><Badge variant="secondary" className="shrink-0 text-[10px]" aria-live="polite">{LINK_BADGE[st]}</Badge></div>
                  {s.changed.includes(l.key) && <p role="status" className="text-xs text-muted-foreground">Changed since you approved it</p>}
                  <p className="break-all font-mono text-xs text-muted-foreground">{address}</p>
                  {chip && <p className="flex flex-wrap items-center gap-2 text-xs"><span className={cn("rounded-full border px-2 py-0.5", CHIP_TONE[chip.tone])}>{chip.text}</span>{chip.detail && <span className="break-words text-muted-foreground">{chip.detail}</span>}</p>}
                  {chip?.tone === "bad" && <p className="text-xs text-destructive">Fix this before submitting, or approve it if it is intended.</p>}
                  {part && <p className="text-xs text-muted-foreground">Opens the part of the page called “{part}”.</p>}
                  {st === "replaced" ? null : <div className="flex flex-wrap items-start gap-1 pt-1">
                    {!manual && <Button type="button" variant="outline" className="h-10 px-2 text-sm sm:h-8 [&_svg]:h-3 [&_svg]:w-3" onClick={() => onShow(l, g)}><Eye className="h-4 w-4" aria-hidden />Show on Page</Button>}
                    <Button type="button" variant="default" className="h-10 px-2 text-sm sm:h-8 [&_svg]:h-3 [&_svg]:w-3" onClick={() => { const t = linkText(l, data.pages); openLinkCheck(l.href, l.kind, l.label ?? (t !== linkAddress(l) ? t : null), g.page?.path ?? null); }}>{st === "done" ? <Check className="h-4 w-4" aria-hidden /> : null}Check This Link</Button>
                    <Button type="button" variant="outline" className="h-10 px-2 text-sm sm:h-8 [&_svg]:h-3 [&_svg]:w-3" onClick={() => onChange(l, g)}><Pencil aria-hidden />Edit Link Destination</Button>
                  </div>}
                  {s.reviewEdit?.link.key === l.key && <ReviewLinkEditor pages={data.pages} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Slim bar above the preview while a page or link from the walkthrough is open. */
export function WalkthroughCheckBar(): ReactNode {
  const s = useWalk();
  // The lookups only mount while checking, so an idle preview never queries anything.
  return s.checking && !s.open ? <CheckBar c={s.checking} /> : null;
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
  const row = c.kind === "page" ? data.rows.find(r => r.key === c.key) : undefined;
  const { phone } = useManagerLayout();
  const [sheet, setSheet] = useState(false);
  const enabled = ready && c.kind === "page" && s.viewed.includes(c.key);
  const yup = () => {
    const fingerprint = c.kind === "page" ? data.rows.find(r => r.key === c.key)?.fingerprint ?? changeFingerprint(data.rows.find(r => r.key === c.key)) : linkFingerprints(data)[c.key];
    if (!(c.kind === "page" ? walk.get().ticked : walk.get().linkTicked).includes(c.key)) walk.approve(c.key, fingerprint, c.kind === "link");
    walk.reopen(back); setReviewOpen?.(true);
  };
  return (
    <div role="region" aria-label="Checking Changes" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-secondary px-3 py-1.5 text-sm text-secondary-foreground">
      <Button type="button" variant="outline" className="h-11" onClick={() => { walk.keepEditing(); setReviewOpen?.(false); }}>Keep Editing</Button>
      <p className="w-full min-w-0 break-words sm:w-auto sm:flex-1">
        Checking {c.name}{c.kind === "page" && at >= 0 ? ` · ${at + 1} of ${pageRows.length} pages` : ""}
      </p>
      <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => { walk.reopen(back); setReviewOpen?.(true); }}><ArrowLeft className="h-4 w-4" aria-hidden />Back to Review</Button>
      {c.kind === "page" && <Button type="button" className="h-11 flex-1 sm:flex-none" disabled={!enabled} onClick={yup}><Check className="h-4 w-4" aria-hidden />Approve</Button>}
      {row?.page && (phone ? <>
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setSheet(true)}>Things to Look At</Button>
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto">
            <SheetHeader><SheetTitle>Things to Look At</SheetTitle></SheetHeader>
            <div className="pt-3"><Suggestions /></div>
            <Button type="button" className="mt-3 h-11 w-full" onClick={() => setSheet(false)}>Done</Button>
          </SheetContent>
        </Sheet>
      </> : <details className="group w-full">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 font-medium" >Things to Look At<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden /></summary>
        <div className="pb-2 pt-1"><Suggestions /></div>
      </details>)}
    </div>
  );
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

/** The Check This Link window, shown over the preview while a page is being checked. */
export function LinkCheckWindow(): ReactNode {
  const s = useWalk();
  return s.linkCheck ? <LinkCheckDialog key={s.linkCheck.raw + "|" + s.linkCheck.page} /> : null;
}

function LinkCheckDialog() {
  const { state, preview } = useDesignChat();
  const s = useWalk();
  const lc = s.linkCheck;
  const data = useWalkthroughData(state, true);
  if (!lc) return null;
  const groups = data.links.status === "ok" ? data.links.groups : [];
  const match = matchChangedLink(groups, lc.page, lc.raw);
  const manual = lc.kind === "mail" || lc.kind === "phone";
  const address = manual ? linkAddress({ href: lc.raw, kind: lc.kind }) : lc.href;
  const internal = lc.kind === "internal" || lc.kind === "anchor";
  const dest = internal ? sitePath(lc.href, lc.raw, lc.page) : null;
  const embed = preview?.frames.find(f => f.id === preview.shownId)?.url ?? preview?.frames.at(-1)?.url;
  const tabUrl = internal ? (dest ? draftPageUrl(dest, embed) : null) : lc.kind === "external" && /^https:\/\//i.test(lc.href) ? lc.href : null;
  const chip = internal ? (lc.raw.startsWith("#") || !dest ? null : internalLinkChip(dest, data.pages)) : match ? linkChip(match, data.pages) : null;
  const ticked = !!match && s.linkTicked.includes(match.key);
  const fp = match ? linkFingerprints(data)[match.key] ?? changeFingerprint(match) : "";
  const verificationKey = match?.key ?? `${lc.page ?? ""}|${lc.raw}`;
  const verificationPrint = match ? ownLinkPrint(match) : changeFingerprint({ href: lc.raw, page: lc.page });
  const opened = s.verificationOpened[verificationKey] === verificationPrint;
  const canConfirm = ticked || manual || opened;
  const confirmHint = manual ? "Check that this address is correct, then confirm." : !opened && !ticked ? "Open the link first, then confirm it goes to the right place." : "Confirm that the link goes to the right place.";
  const close = () => walk.update(w => ({ ...w, linkCheck: null }));
  const confirm = (on: boolean) => { if (on && !canConfirm) return; if (match) walk.confirmLink(match.key, fp, on); close(); };
  const name = lc.label ?? (internal ? linkText({ href: dest ?? lc.href, kind: "internal", label: null }, data.pages) : address);
  return (
    <Dialog open onOpenChange={o => { if (!o) close(); }}>
      <DialogContent data-link-check className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1 border-b px-4 py-3 text-left">
          <DialogTitle>Check This Link</DialogTitle>
          <DialogDescription>{KIND_TEXT[lc.kind]}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-3">
          <div><p className="text-xs text-muted-foreground">Link Text</p><p className="break-words text-sm font-medium">{name}</p></div>
          <div><p className="text-xs text-muted-foreground">Goes To</p><p data-link-address className="break-all font-mono text-lg leading-snug">{address}</p></div>
          {chip && <p className="flex flex-wrap items-center gap-2 text-xs"><span className={cn("rounded-full border px-2 py-0.5", CHIP_TONE[chip.tone])}>{chip.text}</span>{chip.detail && <span className="break-words text-muted-foreground">{chip.detail}</span>}</p>}
          {!match && <p className="text-xs text-muted-foreground">This link wasn't changed in this draft, so checking it here isn't counted.</p>}

          <p className="text-sm font-medium">Is this the correct destination?</p>
        </div>
        <div className="shrink-0 space-y-2 border-t px-4 py-3">
          {ticked && <Badge variant="secondary" aria-live="polite">Confirmed</Badge>}
          <div className="grid grid-cols-2 items-stretch gap-1.5 sm:flex sm:flex-wrap">
            {tabUrl && !manual && <Button asChild variant={!opened && !ticked ? "default" : "outline"} className="h-auto min-h-10 whitespace-normal px-2 text-sm sm:h-8 sm:min-h-8 [&_svg]:h-3 [&_svg]:w-3"><a href={tabUrl} target="_blank" rel="noopener noreferrer" onClick={() => walk.openedVerification(verificationKey, verificationPrint)}><ExternalLink className="h-4 w-4" aria-hidden />Open Link to Verify</a></Button>}
            <Button type="button" variant={ticked ? "secondary" : canConfirm ? "default" : "outline"} className="h-auto min-h-10 whitespace-normal px-2 text-sm sm:h-8 sm:min-h-8 [&_svg]:h-3 [&_svg]:w-3" disabled={!canConfirm} aria-disabled={!canConfirm} aria-describedby="link-confirm-hint" onClick={() => confirm(!ticked)}>{ticked ? <Undo2 className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}{ticked ? "Unconfirm" : "Confirm Link"}</Button>
            {match && <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal px-2 text-sm sm:h-8 sm:min-h-8 [&_svg]:h-3 [&_svg]:w-3" onClick={() => { const g = groups.find(x => x.links.some(y => y.key === match.key)); if (g) { walk.editLink({ link: match, group: g, rows: data.rows, fingerprint: ownLinkPrint(match) }); walk.reopen("links"); } }}><Pencil aria-hidden />Edit Link Destination</Button>}
            <Button type="button" variant="outline" className="h-10 px-2 text-sm sm:h-8" onClick={close}>Close</Button>
          </div>
          <p id="link-confirm-hint" aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">{confirmHint}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
