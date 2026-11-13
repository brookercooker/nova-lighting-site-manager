import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDesignChat } from "./DesignChatContext";
import { SubmitButton } from "./PreviewTools";
import ReviewProblems from "./ReviewProblems";
import { supabase } from "@/prototype/client";
import { FindingsList } from "../DeveloperFindings";
import { postToHelper, type DraftRequest } from "./helper";
import { developerFindings, reviewBlocked } from "./logic";
import { atMs, CHANGE_LABEL, changeKind, changeTitle, newestFirst, relativeTime, waitingLine } from "./reviewChanges";
import { requestAuthor } from "./submitWalkthrough";
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
  const count = state?.publish?.open ?? requests?.length ?? 0;
  return (
    <section aria-label="Changes Waiting for Review" className="flex min-h-0 flex-1 flex-col bg-background">
      {!embedded && <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setReviewOpen(false)}>
          <ArrowLeft className="h-3 w-3" aria-hidden />Back to Chat
        </Button>
      </div>}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 text-sm">
        <h2 className="font-sans text-base font-semibold">Changes Waiting for Review</h2>
        <p className="text-muted-foreground">{waitingLine(count)}</p>
        {!requests && count > 0 && <p className="text-xs text-muted-foreground">Change details aren't available yet.</p>}
        {!embedded && <SubmitButton />}
        <ReviewProblems />
        {isAdmin && reviewBlocked(state) && <div role="region" aria-label="Review Findings"><FindingsList items={findings} onFix={fixIds} onReject={rejectAll} /></div>}
        {isAdmin && rejectStatus && <p role="status" className="text-xs text-muted-foreground">{rejectStatus}</p>}
        {requests && requests.length > 0 && (
          <TooltipProvider delayDuration={200}>
            <ul className="space-y-2" aria-label="Changes">
              {newestFirst(requests).map((r) => <ChangeCard key={r.id} r={r} now={now} />)}
            </ul>
          </TooltipProvider>
        )}
      </div>
    </section>
  );
}

function ChangeCard({ r, now }: { r: DraftRequest; now: number }) {
  const [more, setMore] = useState(false);
  const { title, body } = changeTitle(r);
  const ms = atMs(r.at);
  const long = body.length > 160 || body.split("\n").length > 3;
  const details = (r.details ?? []).filter((d) => typeof d === "string" && d.trim());
  // Site Manager request text repeats its first lines, so the list replaces it.
  const showBody = !(details.length && title) && !!body;
  const decision = r.decision;
  const reason = decision && typeof decision === "object" && !Array.isArray(decision) && "reason" in decision && typeof decision.reason === "string" ? decision.reason.trim() : "";
  return (
    <li data-change-id={r.id} className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-normal">{r.isUndo === true ? "Developer Undo" : CHANGE_LABEL[changeKind(r)]}</Badge>
        {r.undoPending === true && <Badge variant="secondary">Undo Not in Yet</Badge>}
        {reason && <Badge variant="destructive">Rejected</Badge>}
        {Number.isFinite(ms) && (
          <Tooltip><TooltipTrigger asChild>
            <time tabIndex={0} dateTime={new Date(ms).toISOString()} className="text-xs text-muted-foreground">{relativeTime(ms, now)}</time>
          </TooltipTrigger><TooltipContent>{new Date(ms).toLocaleString()}</TooltipContent></Tooltip>
        )}
      </div>
      {title && <h3 className="font-sans text-sm font-semibold">{title}</h3>}
      {!decision && requestAuthor(r.by) && <p className="break-words text-xs text-muted-foreground">by {requestAuthor(r.by)}</p>}
      {showBody && <p className={`whitespace-pre-wrap break-words ${more ? "" : "line-clamp-3"}`}>{body}</p>}
      {showBody && long && <button type="button" className="text-xs underline underline-offset-2" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Show Less" : "Show More"}</button>}
      {details.length > 0 && <ChangeDetails details={details} />}
      {reason && <p className="text-xs break-words whitespace-pre-wrap">Reason: {reason}</p>}
      {r.page && <p className="truncate text-xs text-muted-foreground" title={`${r.page.name} ${r.page.path}`}>Page: {r.page.name} <span className="font-mono">{r.page.path}</span></p>}
    </li>
  );
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
