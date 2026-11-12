import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ErrorText from "./errorText";
import { Box, CheckCircle2, Film, Image as ImageIcon, Loader2, Mic, Paperclip, Pencil, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import ApprovalCard from "./ApprovalCard";
import ReviewProblems from "./ReviewProblems";
import { DEFAULT_UPLOADS, postToHelper } from "./helper";
import { useDesignChat } from "./DesignChatContext";
import { fmtDur, fmtSize, isWorking, LIVE_NOTE, problemsModel, visibleText, workHint, workLabel } from "./logic";
import { useAttachments } from "./useAttachments";
import { useHint } from "./useHint";
import { useVoice } from "./useVoice";
import { kindLabel, referenceKey, withReferences } from "./references";
import { useModeSwitch } from "./ModeSwitchContext";
import { useChatDraft } from "./useChatDraft";
import WaitProgress from "./WaitProgress";
import { useManagerLayout } from "./useManagerLayout";
import type { WaitView } from "./waitEstimates";
import { elapsedTime } from "./stageRibbon";
import { useChangeQueue } from "./useChangeQueue";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { needsManualContentEdit, rememberContentHandoff } from "./savedContentHandoff";
import { waitSuggestions, type WaitAction } from "./waitSuggestions";
import { supabase } from "@/prototype/client";
import { loadModePages } from "./pageSelection";
import WorkingPageChip from "./WorkingPageChip";
import { DismissErrorButton, ErrorDetails, useChatPerson, useErrorDismissals, type ErrorEntry } from "./chatErrors";

const SUGGESTIONS = [
  "Make the headline larger",
  "Change the main button to our brand colour",
  "Add a short section about our showroom hours below the intro",
];

const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

/**
 * The chat, always on the right of the Site Manager: what was said, the live "working on it" line, problems the person can
 * fix, the page they picked to work on, and the box to type in.
 */
export default function ChatPanel({ opening = 0, onDraw, onAttention, saveProgress }: { opening?: number; onDraw?: () => void; onAttention?: () => void; saveProgress?: WaitView | null } = {}) {
  const { state, offline, refreshSoon, retryNow, workingPage, drawing, editing, preview, refs, chatDraft, waitProgress, requestRetry, setDevice, setReviewOpen, previewPage, selectPage, startEditing, device, boxRef } = useDesignChat();
  const navigate = useNavigate();
  const handoffPage = workingPage?.id ? workingPage : previewPage;
  const openSavedContent = async (reply: string) => {
    if (!handoffPage?.id || !modeSwitch) return;
    try { await modeSwitch.requestManual(() => {
      rememberContentHandoff(handoffPage.id ?? "", reply);
      selectPage(handoffPage); navigate("/manage/preview"); startEditing();
    }); } catch { toast.error("Couldn't open this page for editing. Try again."); }
  };
  const modeSwitch = useModeSwitch();
  const { phone } = useManagerLayout();
  const fallbackDraft = useChatDraft();
  const { text, setText, selection } = chatDraft ?? fallbackDraft;
  const [now, setNow] = useState(() => Date.now());
  const [dragging, setDragging] = useState(false);
  const { hint, setHint } = useHint();
  const attentionCallback = useRef(onAttention); attentionCallback.current = onAttention;
  useEffect(() => { if (hint.bad && hint.text) attentionCallback.current?.(); }, [hint.bad, hint.text]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (el && selection.current.focused) {
      const saved = selection.current;
      el.focus({ preventScroll: true });
      el.setSelectionRange(saved.start, saved.end, saved.direction);
    }
  }, [selection]);
  const rememberSelection = (el: HTMLTextAreaElement, focused = document.activeElement === el) => {
    selection.current = { start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection, focused };
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const dragDepth = useRef(0);
  const valueRef = useRef("");
  valueRef.current = text;
  useLayoutEffect(() => {
    if (!opening) return;
    stick.current = true;
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    textRef.current?.focus({ preventScroll: true });
  }, [opening]);

  const attachments = useAttachments(state?.uploads, setHint);
  // A library item was picked in the top bar: put the cursor in the box so the person can say what to do with it.
  useEffect(() => { if (refs.focusTick) textRef.current?.focus(); }, [refs.focusTick]);
  const voice = useVoice(useCallback(() => valueRef.current, []), setText, setHint);

  const busy = Boolean(state?.busy);
  const changing = !!state?.job && !/^(publish|review|content|content[-_]?sync)$/i.test(state.job.kind ?? "") && !/^(content|reviewing|publishing|updating)$/.test(state.job.status) && (busy || state.job.status === "approval" || state.job.status === "queued");
  const deliver = (body: Record<string, unknown>) => requestRetry ? requestRetry.sendPrepared(body) : postToHelper("/send", body);
  const queue = useChangeQueue(state, workingPage?.id ?? "", async body => { const result = await deliver(body); refreshSoon(); return result; }, useCallback(() => setHint("Your queued changes were removed because you switched pages."), [setHint]));
  const [pageContext, setPageContext] = useState<{ id?: string; content?: unknown; type?: string; otherPages: boolean }>({ otherPages: false });
  const waitId = state?.job?.id ?? state?.job?.startedAt;
  useEffect(() => {
    if (!changing || !handoffPage?.id) return;
    let active = true;
    setPageContext({ id: handoffPage.id, otherPages: false });
    void (async () => {
      try {
        const [page, pages] = await Promise.all([supabase.from("pages").select("content,page_type").eq("id", handoffPage.id).maybeSingle(), loadModePages()]);
        if (active) setPageContext({ id: handoffPage.id, content: page.data?.content, type: page.data?.page_type, otherPages: pages.some(p => p.path !== handoffPage.path) });
      } catch { /* Unavailable context simply omits those suggestions. */ }
    })();
    return () => { active = false; };
  }, [changing, handoffPage?.id]);
  const previousSet = useRef<string[]>([]);
  const suggestionRun = useRef<string | number | undefined>();
  if (waitId && suggestionRun.current !== waitId) {
    suggestionRun.current = waitId;
    try { const saved = JSON.parse(sessionStorage.getItem("nova:wait-suggestions") ?? "[]"); previousSet.current = Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []; } catch { previousSet.current = []; }
  }
  const suggestions = waitSuggestions({
    page: handoffPage, editable: !!handoffPage?.id && !!modeSwitch && pageContext.id === handoffPage.id,
    content: pageContext.id === handoffPage?.id ? pageContext.content : undefined,
    draftCount: state?.draft?.requests?.length ?? 0,
    otherDraftPages: (state?.draft?.requests ?? []).flatMap(r => r.page && r.page.path !== handoffPage?.path ? [r.page.path] : []),
    otherPages: pageContext.otherPages, previewLoaded: !!preview.loaded, device, elapsed: waitProgress?.request?.ribbon?.elapsed ?? (now - (state?.job?.startedAt ?? now)) / 1000,
    request: [...(state?.history ?? [])].reverse().find(e => e.role === "user")?.text ?? "", queued: queue.items.length > 0, previewReady: !!waitProgress?.request?.ribbon?.ready,
    available: ["write", "library", "pages", "reminder", ...(queue.items.some(item => item.status !== "sending") ? ["queue"] as WaitAction[] : []), ...(setDevice ? ["phone", "tablet"] as WaitAction[] : []), ...(setReviewOpen ? ["draft"] as WaitAction[] : []), ...(modeSwitch && handoffPage?.id ? ["manual", "videos"] as WaitAction[] : []), ...(boxRef?.current ? ["preview"] as WaitAction[] : [])],
  }, previousSet.current);
  const suggestionKey = suggestions.map(s => s.id).join("|");
  useEffect(() => {
    if (!waitId || !suggestionKey) return;
    try { sessionStorage.setItem("nova:wait-suggestions", JSON.stringify(suggestionKey.split("|"))); } catch { /* Keep in-tab behavior when storage is unavailable. */ }
  }, [waitId, suggestionKey]);
  const runSuggestion = (action: WaitAction) => {
    if (action === "phone" || action === "tablet") setDevice(action === "phone" ? "mobile" : "tablet");
    else if (action === "draft") setReviewOpen(true);
    else if (action === "write") textRef.current?.focus();
    else if (action === "queue") logRef.current?.querySelector<HTMLElement>("[data-queued-change] button")?.focus();
    else if (action === "manual" || action === "videos") void openSavedContent(action === "videos" ? "video" : "");
    else if (action === "library") navigate("/manage/videos");
    else if (action === "pages") navigate("/manage/pages");
    else if (action === "preview") { boxRef?.current?.scrollIntoView({ block: "nearest" }); boxRef?.current?.querySelector("iframe")?.focus(); }
    else setHint("Changes are saved in your draft. You can leave this page and come back.");
  };
  const working = isWorking(state);
  const { person, isAdmin } = useChatPerson();
  const dismissals = useErrorDismissals(person);
  const allMessages = useMemo(
    () => [...(state?.history ?? []), ...(requestRetry?.localErrors ?? [])].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)).map((e, i) => ({ e, i, shown: visibleText(e) })).filter((m) => m.shown !== null),
    [state?.history, requestRetry?.localErrors.map(e => e.ts).join(",")],
  );
  // Dismissing only hides a line for this person; busy, blocked and Submit state never read this.
  const messages = allMessages.filter(m => !dismissals.hidden(m.e as ErrorEntry));
  const problems = problemsModel(state);
  const rules = state?.uploads ?? DEFAULT_UPLOADS;

  // A clock for the working line.
  useEffect(() => {
    if (!working) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);

  // Keep the newest message in view, unless the person has scrolled up to read.
  const onScroll = () => {
    const el = logRef.current;
    // A hidden log (phone Preview tab) reports zero height; that is not the person scrolling up.
    if (el && el.clientHeight > 0) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  // Showing the log again (phone Chat tab) or resizing it keeps the newest message in view.
  useEffect(() => {
    const el = logRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (el.clientHeight > 0 && stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, working, problems?.title, state?.approval?.id, queue.items.length]);

  // The box grows as the person types, up to half the window.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(phone ? 62 : 210, Math.min(el.scrollHeight + 2, phone ? 150 : window.innerHeight / 2))}px`;
  }, [text, phone]);

  const send = async () => {
    const submittedText = text;
    const message = text.trim();
    if (busy && !changing || offline) return;
    const hasDrawing = drawing.strokes.length > 0;
    // A service that hasn't been updated would drop the drawing and send the words alone, so don't send it at all.
    if (hasDrawing && state?.drawing !== true) {
      setHint("The design service hasn't been updated to take drawings yet, so this would be sent without your drawing. Ask whoever runs the service to update it, or remove the drawing and send again.", true);
      return;
    }
    if (!message) {
      if (hasDrawing) setHint("Say what you'd like done with your drawing.", true);
      else if (refs.references.length && !attachments.files.length) setHint("Say what you'd like done with the attached item(s).", true);
      else if (attachments.files.length) setHint(`Say what you'd like done with the attached file${attachments.files.length > 1 ? "s" : ""}.`, true);
      return;
    }
    if (attachments.uploading) { setHint("Still uploading your files. One moment."); return; }
    if (editing && (!modeSwitch || !await modeSwitch.requestChat())) return;
    voice.stop();
    // The drawing: ask the site what is under it, and take the picture if it was switched on.
    let marks: unknown;
    let image: string | null = null;
    if (hasDrawing) {
      setHint("Reading your drawing…");
      const d = await drawing.prepare();
      if (d) { marks = d.marks; image = d.image; }
    }
    const body = {
      message: withReferences(message, refs.references), uploadIds: attachments.ids(), ...(workingPage ? { page: workingPage } : {}),
      ...(marks ? { marks } : {}), ...(image ? { image } : {}),
    };
    if (changing || queue.items.length > 0) {
      queue.add(message, body); setText(""); attachments.clear(); refs.clearReferences(); drawing.cancel(); return;
    }
    const res = await deliver(body);
    if (res.ok) {
      const took = Number(res.data?.marks ?? 0);
      const expected = hasDrawing && marks ? (marks as { marks: unknown[] }).marks.length : 0;
      if (valueRef.current === submittedText) setText("");
      attachments.clear(); refs.clearReferences(); drawing.cancel();
      setHint(expected && took !== expected ? "Your request was sent, but the service didn't take in your drawing." : expected ? `Sent with ${took} ${took === 1 ? "mark" : "marks"}${res.data?.picture ? " and a picture" : ""}.` : "", expected > 0 && took !== expected);
    } else setHint(res.error, true);
    refreshSoon();
  };


  const job = state?.job;
  const hintForWork = job && state ? workHint(job, state, now) : "";
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  return (
    <section className="flex h-full flex-col bg-background min-h-0 overflow-hidden" aria-label="Design Chat">
      <div ref={logRef} onScroll={onScroll} className={cn("flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 flex flex-col gap-2.5 text-sm", editing && "hidden")} role="log">
        {messages.length === 0 && (
          <div className="text-muted-foreground space-y-2">
            <p>Describe a change to the site. You'll see it in the Preview tab. To work on one page, pick it in the Pages tab. Nothing goes live until you press Submit for Review.</p>
            <p>
              {state?.review?.mode === "simulated"
                ? "Demo mode: your changes are checked once together by fixed rules, not by an AI reading the code, and they go live automatically if the check passes."
                : "When you submit, your changes are checked once together, and they go live automatically if the check passes."}
            </p>
            <p>Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => { setText(s); textRef.current?.focus(); }}
                  className="rounded-full border bg-background px-3 py-1 text-xs text-foreground hover:bg-muted text-left">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(({ e, i, shown }) => (
          <div key={i} className={cn(
            "max-w-[92%] rounded-lg px-3 py-2 whitespace-pre-wrap break-words leading-snug",
            e.role === "user" && "self-end bg-primary text-primary-foreground",
            e.role === "assistant" && "self-start bg-muted",
            e.role === "note" && shown !== LIVE_NOTE && "self-stretch max-w-none bg-amber-50 text-amber-900 text-xs",
            e.role === "note" && shown === LIVE_NOTE && "self-stretch max-w-none flex items-center gap-1.5 border border-review/40 bg-review/10 text-review text-xs font-medium",
            e.role === "error" && "self-stretch max-w-none bg-destructive/10 text-destructive",
          )} data-live-note={e.role === "note" && shown === LIVE_NOTE ? "" : undefined}>
            {e.role === "note" && shown === LIVE_NOTE && <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />}
            {e.role === "error" ? <div className="flex items-start gap-1"><div className="min-w-0 flex-1">{typeof shown === "string" ? <ErrorText text={shown} /> : shown}</div><DismissErrorButton phone={phone} onDismiss={() => dismissals.dismiss(e as ErrorEntry)} /></div> : shown}
            {e.role === "error" && isAdmin && (e as ErrorEntry).hasDetail === true && <ErrorDetails id={(e as ErrorEntry).id} />}
            {e.role === "error" && requestRetry && e.ts !== undefined && !requestRetry.isReviewFailure(e.ts) && <div className="mt-1 text-xs">
              {requestRetry.canRetry(e.ts) ? <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={requestRetry.disabled || editing} onClick={() => { void requestRetry.retry(e.ts ?? 0, () => waitProgress?.request?.errorControls?.dismiss()).then(result => { if (result && !result.ok) setHint(result.error, true); }); }}>Try Again</Button>
                : <p>{requestRetry.retryNote(e.ts)}</p>}
            </div>}
            {e.role === "assistant" && needsManualContentEdit(e.text) && handoffPage?.id && <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>This saved content can be changed here.</p>
              <Button type="button" variant="link" size="sm" className="h-auto whitespace-normal p-0 text-left text-xs" onClick={() => void openSavedContent(e.text)}>Edit in Manual Edit Mode</Button>
            </div>}
            {(e.role === "user" || e.role === "assistant") && e.ts ? <time className="mt-1 block text-[11px] opacity-70">{fmtTime(e.ts)}</time> : null}
          </div>
        ))}

        {saveProgress && <div role="status" className={cn("self-stretch text-xs text-muted-foreground transition-opacity duration-200 motion-reduce:transition-none", saveProgress.fading && "opacity-0", saveProgress.error && "text-destructive")}>{saveProgress.label}</div>}

        {working && job && state && !changing && job.status !== "content" && !/^(content|content[-_]sync)$/i.test(job.kind) && !waitProgress?.request && !waitProgress?.submit && (
          <div role="status" className="self-stretch grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-1 rounded-lg border bg-muted/60 px-3 py-2.5">
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((n) => <i key={n} className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${n * 0.2}s` }} />)}
            </span>
            <span className="font-medium">{workLabel(job, now)}</span>
            <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">{fmtDur(now - job.startedAt)}</span>
            {hintForWork && <span className="col-span-3 text-xs text-muted-foreground">{hintForWork}</span>}
          </div>
        )}

        {(changing || waitProgress?.request && !waitProgress.request.error && !waitProgress.request.fading) && <div className="self-stretch rounded-lg border bg-muted/60 px-3 py-2.5 space-y-3">
          <p className="font-medium">Your change is on its way · {elapsedTime(waitProgress?.request?.ribbon?.elapsed ?? (now - (job?.startedAt ?? now)) / 1000)}</p>
          <p className="text-xs text-muted-foreground">You don't need to watch. Keep going, and we'll tell you the moment the preview is ready.</p>
          <p className="text-[11px] uppercase text-muted-foreground">While you wait</p>
          <div className="flex flex-col items-start gap-1">
            {suggestions.map(s => <Button key={s.id} type="button" variant="link" className="h-auto whitespace-normal p-0 text-left text-xs" onClick={() => runSuggestion(s.action)}>{s.label}</Button>)}
          </div>
        </div>}
        {waitProgress?.request && (!waitProgress.request.ribbon || waitProgress.request.error) && <div className="self-stretch rounded-lg border bg-muted/60 px-3 py-2.5"><WaitProgress progress={waitProgress.request} /></div>}
        {waitProgress?.submit && <div className="self-stretch rounded-lg border bg-muted/60 px-3 py-2.5"><WaitProgress progress={waitProgress.submit} /></div>}
        {queue.items.map((item, index) => <div key={item.id} data-queued-change className="self-end max-w-[92%] rounded-lg border bg-muted px-3 py-2 text-sm">
          <p className="whitespace-pre-wrap break-words">{item.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">{item.status === "error" ? item.error ?? "The current change couldn't finish. Your next change wasn't sent." : item.status === "sending" ? "Sending…" : "Queued · sends after the current reply"}</p>
          <div className="flex gap-3">
            {item.status === "error" && <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" disabled={index !== 0 || busy || offline || !!state?.approval} onClick={() => queue.sendNow(item.id)}>Send now</Button>}
            {item.status !== "sending" && <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => queue.remove(item.id)}>{item.status === "error" ? "Remove" : "Cancel"}</Button>}
          </div>
        </div>)}

        {state?.approval && <ApprovalCard approval={state.approval} onAnswered={refreshSoon} />}

        <ReviewProblems />
      </div>

      <form
        className={cn("border-t p-3 flex shrink-0 flex-col gap-2", editing && "[&>*:not(:last-child)]:hidden", dragging && "outline-2 outline-dashed outline-primary -outline-offset-4 bg-muted")}
        autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); send(); }}
        onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth.current++; setDragging(true); } }}
        onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
        onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDragging(false); attachments.add(e.dataTransfer.files); }}
      >
        {/* On larger screens this chip sits just below the mode switch (see AdminIndex). */}
        {phone && <WorkingPageChip />}

        {drawing.strokes.length > 0 && (
          <div className="flex items-center gap-2 rounded-md border bg-muted py-1 pl-2.5 pr-1 text-xs" aria-label="Your drawing on the preview">
            <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              <strong>{drawing.strokes.length} {drawing.strokes.length === 1 ? "mark" : "marks"}</strong>
              <span className="text-muted-foreground"> on the preview will be sent with this request{drawing.picture ? ", with a picture" : ""}</span>
            </span>
            <button type="button" aria-label="Remove the drawing" title="Remove the drawing" onClick={drawing.cancel}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-border hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {refs.references.length > 0 && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-2" aria-label="Library items for this request">
            <p className="mb-1.5 text-xs font-semibold" data-references-heading>
              Selected ({refs.references.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
            {refs.references.map((r) => {
              const Icon = r.kind === "image" ? ImageIcon : r.kind === "video" ? Film : Box;
              return (
                <span key={referenceKey(r)} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-tag-selected bg-tag-selected py-0.5 pl-1 pr-1 text-xs text-tag-selected-foreground">
                  {r.thumb ? <img src={r.thumb} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" /> : <Icon className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span>{kindLabel(r.kind)}</span>
                  <span className="min-w-0 max-w-[180px] truncate">{r.name}</span>
                  <button type="button" aria-label={`Remove ${r.name}`} onClick={() => refs.removeReference(referenceKey(r))}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-tag-selected-foreground hover:bg-tag-selected-foreground/10">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            </div>
          </div>
        )}

        {attachments.files.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Attached Files">
            {attachments.files.map((f) => (
              <span key={f.key} className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted py-0.5 pl-2.5 pr-1 text-xs">
                <span className="max-w-[220px] truncate">{f.name}</span>
                {f.status === "uploading"
                  ? <Loader2 className="h-3 w-3 animate-spin" aria-label="Uploading" />
                  : <span className="text-muted-foreground">{fmtSize(f.size)}</span>}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => attachments.remove(f.key)}
                  className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-border hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {changing && <label htmlFor="next-change" className="text-xs text-muted-foreground">Next change (sends when this one finishes)</label>}
        <Textarea
          id="next-change"
          key="chat-composer"
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onSelect={(e) => rememberSelection(e.currentTarget)}
          onFocus={(e) => rememberSelection(e.currentTarget, true)}
          onBlur={(e) => rememberSelection(e.currentTarget, false)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData?.files ?? []);
            if (!pasted.length) return;
            e.preventDefault();
            attachments.addPasted(pasted);
          }}
          placeholder="Describe the change you want, for example: add a contact section with an email address and phone number"
          aria-label={changing ? "Next change (sends when this one finishes)" : "Describe a Change"}
          rows={2}
          className={cn("resize-none overflow-y-auto leading-snug", phone ? "min-h-[62px] max-h-[150px]" : "min-h-[210px] max-h-[50vh]")}
        />

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={rules.accept}
            onChange={(e) => { attachments.add(e.target.files); e.target.value = ""; }}
          />
          <Button type="button" variant="outline" size="icon" className="rounded-full shrink-0" title="Attach pictures or documents"
            aria-label="Attach pictures or documents" onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button type="button" variant={drawing.on ? "default" : "outline"} size="icon" className="rounded-full shrink-0"
            onClick={onDraw ?? drawing.toggle} disabled={!drawing.available || !preview.loaded || editing} aria-pressed={drawing.on}
            aria-label={drawing.on ? "Stop drawing and remove the marks" : "Draw on the preview"}
            title={editing ? "Drawing isn't available while editing a page" : !drawing.available ? "Open the Preview tab to draw on it" : drawing.on ? "Stop drawing and remove the marks" : "Draw on the preview"}>
            <Pencil className="h-4 w-4" />
          </Button>
          {voice.supported && (
            <Button type="button" variant={voice.listening ? "destructive" : "outline"} size="icon"
              className={cn("rounded-full shrink-0", voice.listening && "animate-pulse")}
              title="Speak your request" aria-label="Speak your request" aria-pressed={voice.listening} onClick={voice.toggle}>
              <Mic className="h-4 w-4" />
            </Button>
          )}
          {(offline || hint.text) && <div role="status" className={cn("order-last basis-full min-w-0 flex flex-wrap items-center gap-x-2 text-xs break-words", offline || hint.bad ? "text-destructive" : "text-muted-foreground")}>
            <span className="min-w-0">{offline ? "Can't reach the design service right now. It will keep trying." : hint.text}</span>
            {offline && <Button type="button" variant="link" size="sm" className="min-h-9 h-auto px-0 text-xs text-destructive" onClick={retryNow}>Try Again</Button>}
          </div>}
          <Button type="submit" disabled={busy && !changing || offline || attachments.uploading || requestRetry?.sending} className="ml-auto gap-2">
            <Send className="h-4 w-4" /> {changing ? "Queue it" : "Send"}
          </Button>
        </div>
      </form>
    </section>
  );
}
