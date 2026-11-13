import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDesignChat } from "./DesignChatContext";
import { SubmitButton } from "./PreviewTools";
import ReviewProblems from "./ReviewProblems";
import { supabase } from "@/prototype/client";
import { FindingsList } from "../DeveloperFindings";
import { postToHelper, type DraftRequest } from "./helper";
import { developerFindings, reviewBlocked } from "./logic";
import { atMs, relativeTime, waitingLine } from "./reviewChanges";
import { requestAuthor } from "./submitWalkthrough";
import { groupedLog, publishedNet, reviewDisplayCount, type LogEntry } from "./reviewLog";
import { linkHistoryLine } from "../linkDisplay";

/** Changes waiting for review, from the relay's draft.requests only (never the chat history). Replaces the chat in the left column. */
export default function ReviewChangesView({ embedded = false }: { onShowPreview: () => void; embedded?: boolean }) {
  const { state, setReviewOpen, refreshSoon } = useDesignChat();
  // Staff only: the review's findings and "Fix this for me" are never shown to other people.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data?.user) return;
        const { data: role } = await (supabase as any).rpc("has_role", { _user_id: data.user.id, _role: "admin" });
        if (live) setIsAdmin(!!role);
      } catch { /* not staff */ }
    })();
    return () => { live = false; };
  }, []);
  const findings = isAdmin ? developerFindings(state) : [];
  const [rejectStatus, setRejectStatus] = useState<string | null>(null);
  const rejectAll = async (reason: string): Promise<string | null> => {
    setRejectStatus(null);
    const res = await postToHelper("/reject", { reason });
    if (res.ok) {
      const { undoing, kept } = res.data ?? {};
      if (Number.isInteger(undoing) && undoing >= 0) {
        setRejectStatus(`Undoing ${undoing} ${undoing === 1 ? "request" : "requests"}. The undo will join the draft.${Number.isInteger(kept) && kept > 0 ? ` ${kept} edits made in the Site Manager can't be undone here. Change them back in Manual Edit Mode.` : ""}`);
      }
    }
    refreshSoon();
    return res.ok ? null : "The changes weren't rejected. " + (res.error || "The design service didn't accept the request.");
  };
  const fixIds = async (ids: string[]) => { await postToHelper("/fix", { findingIds: ids }); refreshSoon(); };
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const requests = state?.draft?.requests;
  const count = reviewDisplayCount(state);
  const [limit, setLimit] = useState(10);
  const [showReverted, setShowReverted] = useState(false);
  const entries = publishedNet(state)?.entries ?? groupedLog(requests ?? []);
  const reverted = entries.filter(e => e.reverted);
  const active = entries.filter(e => !e.reverted);
  const shown = (showReverted ? entries : active).slice(0, limit);
  return (
    <section aria-label="Changes Waiting for Review" className="flex min-h-0 flex-1 flex-col bg-background">
      {!embedded && <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setReviewOpen(false)}>
          <ArrowLeft className="h-3 w-3" aria-hidden />Back to Chat
        </Button>
      </div>}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 text-sm">
        <h2 className="font-sans text-base font-semibold">All Changes</h2>
        <p className="text-muted-foreground">{waitingLine(count)}</p>
        {!requests && count > 0 && <p className="text-xs text-muted-foreground">Change details aren't available yet.</p>}
        {!embedded && <SubmitButton />}
        <ReviewProblems />
        {isAdmin && reviewBlocked(state) && <div role="region" aria-label="Review Findings"><FindingsList items={findings} onFix={fixIds} onReject={rejectAll} /></div>}
        {isAdmin && rejectStatus && <p role="status" className="text-xs text-muted-foreground">{rejectStatus}</p>}
        <ul className="divide-y" aria-label="Changes">
          {shown.map(entry => <ChangeCard key={entry.key} entry={entry} now={now} />)}
        </ul>
        {(showReverted ? entries : active).length > limit && <Button variant="ghost" className="h-11" onClick={() => setLimit(n => n + 10)}>Show More</Button>}
        {reverted.length > 0 && <Button variant="ghost" className="h-11" aria-expanded={showReverted} onClick={() => { setShowReverted(v => !v); setLimit(10); }}>{showReverted ? "Hide Reverted Edits" : `Show ${reverted.length} Reverted Edits`}</Button>}

      </div>
    </section>
  );
}

function ChangeCard({ entry, now }: { entry: LogEntry; now: number }) {
  const [more, setMore] = useState(false);
  const r = entry.requests[0];
  const ms = atMs(r?.at);
  return <li data-change-id={r?.id ?? entry.key} className="min-w-0">
    <Button variant="ghost" className="flex h-11 w-full min-w-0 justify-start gap-1 rounded-none px-0 text-left text-sm font-normal" aria-expanded={more} onClick={() => setMore(v => !v)}>
      <span className="min-w-0 flex-1 truncate">{entry.text}</span>
      {Number.isFinite(ms) && <time dateTime={new Date(ms).toISOString()} className="shrink-0 text-xs text-muted-foreground">· {relativeTime(ms, now)}</time>}
    </Button>
    {more && <div className="space-y-2 break-words pb-3 text-xs">
      {entry.requests.map(request => {
        const decision = request.decision;
        const reason = decision && typeof decision === "object" && !Array.isArray(decision) && "reason" in decision && typeof decision.reason === "string" ? decision.reason.trim() : "";
        return <div key={request.id} className="space-y-1">
          <p className="whitespace-pre-wrap">{request.source === "content" ? request.details?.map(linkHistoryLine).join("\n") ?? request.request.replace(/^Edits made in the Site Manager:\s*/, "") : request.request}</p>
          {requestAuthor(request.by) && <p>by {requestAuthor(request.by)}</p>}
          {request.page && <p>{request.page.name} · {request.page.path}</p>}
          {request.undoPending && <Badge variant="secondary">Undo Not in Yet</Badge>}
          {request.isUndo && <Badge variant="secondary">Developer Undo</Badge>}
          {reason && <p>Reason: {reason}</p>}
        </div>;
      })}
    </div>}
  </li>;
}

export function ChangeDetails({ details }: { details: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? details : details.slice(0, 4);
  return (
    <div className="space-y-1">
      <ul className="list-disc space-y-0.5 pl-4 text-xs" aria-label="What Changed">
        {shown.map((d, i) => <li key={i} className="break-words">{linkHistoryLine(d)}</li>)}
      </ul>
      {details.length > 4 && (
        <button type="button" className="text-xs underline underline-offset-2" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${details.length} changes`}
        </button>
      )}
    </div>
  );
}
