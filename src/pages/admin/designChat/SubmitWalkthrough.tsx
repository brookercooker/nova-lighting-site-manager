import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Eye, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { postToHelper } from "./helper";
import { useDesignChat } from "./DesignChatContext";
import { undoPendingGate } from "./logic";
import { useManagerLayout } from "./useManagerLayout";
import { useWalkthroughData, type WalkthroughData } from "./useWalkthroughData";
import { publicPreviewBase, publicPreviewPage } from "./publicPreviewUrl";
import { OTHER_KEY, checklistItems, itemTicked, linkChip, remaining, type Chip, type ChangedRow, type LinkGroup, type ReviewLink } from "./submitWalkthrough";
import { add, toggle, useWalk, walk, type WalkStep } from "./submitWalkthroughStore";

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
  const hasLinksStep = data.links.status === "failed" || allLinks.length > 0;
  const linksLeft = allLinks.filter((l) => !s.linkTicked.includes(l.key)).length;
  const items = checklistItems(pageRows, allLinks.length > 0, pagesLeft === 0, linksLeft === 0);
  const checksLeft = items.filter((i) => !itemTicked(i, s.checks)).length;
  const steps: WalkStep[] = ["pages", ...(hasLinksStep ? ["links" as const] : []), "checklist"];
  const step = steps.includes(s.step) ? s.step : "checklist";
  return { pageRows, pagesLeft, allLinks, linksLeft, items, checksLeft, steps, step };
}

function pageCount(rows: ChangedRow[], ticked: string[]): string {
  if (!rows.length) return "No pages were changed in this draft.";
  return `${rows.filter((r) => ticked.includes(r.key)).length} of ${rows.length} pages checked`;
}
const rowName = (r: ChangedRow) => r.page?.name ?? "Other site changes";
const rowPath = (r: ChangedRow) => r.page?.path ?? "/";
/** The draft site address for a page (new tab), or null when no draft address is configured. */
function draftPageUrl(path: string): string | null {
  try { const base = publicPreviewBase(null); return base ? publicPreviewPage(base, path) : null; } catch { return null; }
}

function linkPath(link: ReviewLink, group: LinkGroup): { path: string; part: string | null } {
  const [path, part] = link.href.split("#");
  return { path: path || group.page?.path || "/", part: part ? decodeURIComponent(part) : null };
}

/**
 * Submit for Review (or Publish): pages, links (when any changed) and a first-person checklist, then submit.
 * Controlled by the host; progress lives in submitWalkthroughStore so View Page can close and reopen it.
 */
export function SubmitConfirmDialog({ open, onOpenChange, fallback = false }: { open: boolean; onOpenChange: (open: boolean) => void; fallback?: boolean }) {
  const id = useId();
  const s = useWalk();
  useEffect(() => walk.mount(id, fallback), [id, fallback]);
  useEffect(() => { if (open) walk.open(id); }, [open, id]);
  const shown = s.open && s.host === id;
  const close = () => { walk.close(); onOpenChange(false); };
  const { phone } = useManagerLayout();
  if (!shown) return null;
  const body = <Walkthrough onClose={close} phone={phone} />;
  return phone ? (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent side="bottom" data-submit-confirm className="flex h-[100dvh] max-h-[100dvh] flex-col gap-0 overflow-hidden p-0">{body}</SheetContent>
    </Sheet>
  ) : (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent data-submit-confirm className="flex max-h-[90vh] max-w-xl flex-col gap-0 overflow-hidden p-0">{body}</DialogContent>
    </Dialog>
  );
}

function Walkthrough({ onClose, phone }: { onClose: () => void; phone: boolean }) {
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
  useEffect(() => { if (state && count === 0 && data.rows.length === 0) walk.update((w) => ({ ...w, viewed: [], ticked: [], linkOpened: [], linkTicked: [], checks: [], step: "pages" })); }, [state, count, data.rows.length]);
  const reviewOn = state?.review?.enabled !== false;
  const label = reviewOn ? "Submit for Review" : "Publish";
  const Title = phone ? SheetTitle : DialogTitle;
  const Desc = phone ? SheetDescription : DialogDescription;
  const idx = p.steps.indexOf(p.step);
  const setStep = (step: WalkStep) => walk.update((w) => ({ ...w, step }));

  const openPage = (path: string, checking: { key: string; kind: "page" | "link"; name: string }) => {
    walk.update((w) => ({ ...w, open: false, checking, ...(checking.kind === "page" ? { viewed: add(w.viewed, checking.key) } : { linkOpened: add(w.linkOpened, checking.key) }) }));
    onClose();
    if (showPreviewPath) showPreviewPath(path); else selectPage?.({ name: checking.name, path });
    goToPreview();
  };
  const left = remaining(p.pagesLeft, p.steps.includes("links") ? p.linksLeft : 0, p.checksLeft);
  const undoGate = undoPendingGate(state);
  const canSubmit = !left && !sending && !undoGate;
  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    try { const res = await postToHelper("/publish"); if (res?.ok) walk.reset(); refreshSoon(); onClose(); }
    finally { setSending(false); }
  };
  const nextDisabled = p.step === "pages" ? p.pagesLeft > 0 : p.step === "links" ? p.linksLeft > 0 : true;
  const changes = `${count} ${count === 1 ? "change" : "changes"}`;

  return (
    <>
      <div className="shrink-0 space-y-1 border-b px-4 py-3 pr-12">
        <p className="text-xs text-muted-foreground" aria-live="polite">Step {idx + 1} of {p.steps.length}</p>
        <Title asChild><h2 ref={headingRef} tabIndex={-1} className="font-sans text-lg font-semibold outline-none">{STEP_TITLE[p.step]}</h2></Title>
        <Desc className="text-sm text-muted-foreground">
          {p.step === "pages" ? "Open each changed page and say whether it looks right."
            : p.step === "links" ? "Open each link that was added or changed and make sure it goes to the right place."
            : reviewOn ? "Your changes will be reviewed automatically, and anything it can't approve may go to a developer. Approved changes are put on the public site."
            : `This puts all ${changes} waiting in your draft on the public site right away. Visitors will see these changes as soon as publishing finishes.`}
        </Desc>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3">
        {p.step === "pages" && <PagesStep rows={p.pageRows} onView={(r) => openPage(rowPath(r), { key: r.key, kind: "page", name: rowName(r) })} />}
        {p.step === "links" && <LinksStep data={data} onOpenInternal={(l, g) => openPage(linkPath(l, g).path, { key: l.key, kind: "link", name: l.label ?? l.href })} />}
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
                    {lockedItem && !ticked && <span className="block text-xs text-muted-foreground">{item.id === "pages" ? "This ticks itself once every page is checked." : "This ticks itself once every link is checked."}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t px-4 py-3">
        {p.step === "pages" && <p className="text-sm" aria-live="polite">{pageCount(p.pageRows, s.ticked)}</p>}
        {p.step === "links" && data.links.status === "ok" && <p className="text-sm" aria-live="polite">{p.allLinks.length - p.linksLeft} of {p.allLinks.length} links checked</p>}
        {p.step === "checklist" && left && <p className="text-sm text-muted-foreground" aria-live="polite">{left.charAt(0).toUpperCase() + left.slice(1)}.</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" className="h-11 mr-auto" disabled={sending} onClick={onClose}>Cancel</Button>
          {idx > 0 && <Button type="button" variant="outline" className="h-11" disabled={sending} onClick={() => setStep(p.steps[idx - 1])}><ArrowLeft className="h-4 w-4" aria-hidden />Back</Button>}
          {p.step !== "checklist"
            ? <Button type="button" className="h-11" disabled={nextDisabled} onClick={() => setStep(p.steps[idx + 1])}>Next<ArrowRight className="h-4 w-4" aria-hidden /></Button>
            : <Button type="button" variant="review" className="h-11" disabled={!canSubmit} onClick={() => void submit()}><Send className="h-4 w-4" aria-hidden />{sending ? "Sending…" : label}</Button>}
        </div>
      </div>
    </>
  );
}

function Tick({ id, label, checked, disabled, hint, onChange }: { id: string; label: string; checked: boolean; disabled: boolean; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <div>
      <div className="flex min-h-11 items-center gap-2">
        <Checkbox id={id} className="h-5 w-5" checked={checked} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} onCheckedChange={(v) => onChange(v === true)} />
        <label htmlFor={id} className={cn("text-sm", disabled ? "text-muted-foreground" : "cursor-pointer")}>{label}</label>
      </div>
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PagesStep({ rows, onView }: { rows: ChangedRow[]; onView: (r: ChangedRow) => void }) {
  const s = useWalk();
  const tick = (key: string, v: boolean) => walk.update((w) => ({ ...w, ticked: toggle(w.ticked, key, v) }));
  const opened = (key: string) => walk.update((w) => ({ ...w, viewed: add(w.viewed, key) }));
  if (!rows.length) return <p className="text-sm text-muted-foreground">No pages were changed in this draft.</p>;
  return (
    <ul className="space-y-2" aria-label="Changed Pages">
      {rows.map((r) => {
        const viewed = s.viewed.includes(r.key);
        const other = r.key === OTHER_KEY;
        const tab = r.page ? draftPageUrl(r.page.path) : null;
        return (
          <li key={r.key} data-walk-row={r.key} className="space-y-1 rounded-md border p-3">
            <p className="break-words font-medium">{rowName(r)} {r.page && <span className="break-all font-mono text-xs font-normal text-muted-foreground">{r.page.path}</span>}</p>
            {r.how && <p className="break-words text-xs text-muted-foreground">{r.how}</p>}
            <div className="flex flex-wrap items-start gap-x-4 gap-y-1 pt-1">
              <Button type="button" className="h-11" onClick={() => onView(r)}><Eye className="h-4 w-4" aria-hidden />{other ? "Open Site" : "Open Page"}</Button>
              {tab && <Button asChild variant="outline" className="h-11"><a href={tab} target="_blank" rel="noopener noreferrer" onClick={() => opened(r.key)}><ExternalLink className="h-4 w-4" aria-hidden />Open in New Tab</a></Button>}
              <Tick id={`tick-${r.key}`} label="Yup, looks good" checked={s.ticked.includes(r.key)} disabled={!viewed} hint={viewed ? undefined : "Open the page first"} onChange={(v) => tick(r.key, v)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const CHIP_TONE: Record<Chip["tone"], string> = { ok: "border-border bg-secondary text-secondary-foreground", warn: "border-border bg-muted text-foreground", bad: "border-destructive bg-destructive text-destructive-foreground" };

function LinksStep({ data, onOpenInternal }: { data: WalkthroughData; onOpenInternal: (l: ReviewLink, g: LinkGroup) => void }) {
  const s = useWalk();
  const [copied, setCopied] = useState<string | null>(null);
  if (data.links.status === "failed") return <p role="status" className="text-sm">Links couldn't be listed right now. Open the changed pages and click the links you added or changed.</p>;
  if (data.links.status !== "ok") return <p className="text-sm text-muted-foreground">Listing the changed links…</p>;
  const { groups, unread, partial, truncated } = data.links;
  const opened = (k: string) => walk.update((w) => ({ ...w, linkOpened: add(w.linkOpened, k) }));
  return (
    <div className="space-y-4">
      {unread > 0 && <p className="text-xs text-muted-foreground">{unread} {unread === 1 ? "change" : "changes"} couldn't be checked for links. Check those pages by hand.</p>}
      {(partial || truncated) && <p className="text-xs text-muted-foreground">Some links may be missing from this list.</p>}
      {groups.map((g) => (
        <section key={g.label + (g.page?.path ?? "")} aria-label={g.label}>
          <h3 className="mb-2 text-sm font-semibold">{g.label}</h3>
          <ul className="space-y-2">
            {g.links.map((l) => {
              const chip = linkChip(l, data.pages);
              const manual = l.kind === "mail" || l.kind === "phone";
              const address = manual ? l.href.replace(/^(mailto|tel):/i, "") : l.href;
              const part = l.kind === "anchor" ? linkPath(l, g).part : null;
              const enabled = manual || s.linkOpened.includes(l.key);
              return (
                <li key={l.key} data-walk-link={l.key} className="space-y-1 rounded-md border p-3">
                  <p className="break-words text-sm font-medium">{l.label ?? address}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{address}</p>
                  {chip && <p className="flex flex-wrap items-center gap-2 text-xs"><span className={cn("rounded-full border px-2 py-0.5", CHIP_TONE[chip.tone])}>{chip.text}</span>{chip.detail && <span className="break-words text-muted-foreground">{chip.detail}</span>}</p>}
                  {chip?.tone === "bad" && <p className="text-xs text-destructive">Fix this before submitting, or tick it if it is meant.</p>}
                  {part && <p className="text-xs text-muted-foreground">Opens the part of the page called “{part}”.</p>}
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-1 pt-1">
                    {l.kind === "external" ? (
                      <Button asChild variant="outline" className="h-11"><a href={l.href} target="_blank" rel="noopener noreferrer" onClick={() => opened(l.key)}><ExternalLink className="h-4 w-4" aria-hidden />Open Link</a></Button>
                    ) : manual ? (
                      <Button type="button" variant="outline" className="h-11" onClick={() => { void navigator.clipboard?.writeText(address).catch(() => {}); setCopied(l.key); }}>
                        {copied === l.key ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied === l.key ? "Copied" : "Copy Address"}
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" className="h-11" onClick={() => onOpenInternal(l, g)}><Eye className="h-4 w-4" aria-hidden />Open Link</Button>
                    )}
                    <Tick id={`link-${l.key}`} label="Yup, this link works" checked={s.linkTicked.includes(l.key)} disabled={!enabled} hint={enabled ? undefined : "Open the link first"}
                      onChange={(v) => walk.update((w) => ({ ...w, linkTicked: toggle(w.linkTicked, l.key, v) }))} />
                  </div>
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
  const { state } = useDesignChat();
  const data = useWalkthroughData(state, true);
  const pageRows = data.rows;
  const at = pageRows.findIndex((r) => r.key === c.key);
  const back: WalkStep = c.kind === "page" ? "pages" : "links";
  const yup = () => {
    walk.update((w) => c.kind === "page" ? { ...w, ticked: add(w.ticked, c.key) } : { ...w, linkTicked: add(w.linkTicked, c.key) });
    walk.reopen(back);
  };
  return (
    <div role="region" aria-label="Checking Changes" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-secondary px-3 py-1.5 text-sm text-secondary-foreground">
      <p className="w-full min-w-0 break-words sm:w-auto sm:flex-1">
        Checking {c.name}{c.kind === "page" && at >= 0 ? ` · ${at + 1} of ${pageRows.length} pages` : ""}
      </p>
      <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => walk.reopen(back)}><ArrowLeft className="h-4 w-4" aria-hidden />Back to Review</Button>
      <Button type="button" className="h-11 flex-1 sm:flex-none" onClick={yup}><Check className="h-4 w-4" aria-hidden />{c.kind === "page" ? "Yup, looks good" : "Yup, this link works"}</Button>
    </div>
  );
}
