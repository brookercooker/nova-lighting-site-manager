/**
 * The rules for what the Design Chat shows. Plain functions (no React) so they can be tested on their own.
 */
import { readableReferences } from "./references";
import { SIGN_IN_REQUIRED } from "@/lib/authGate";
import type { Approval, ApprovalField, Entry, Finding, Job, RelayState, UploadRules } from "./helper";

export const IDLE_HINT = "";

export const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---- the chat history: only what the person can use ------------------------------------------
/** Shown when the draft goes live; styled in the Submit for Review green. */
export const LIVE_NOTE = "Your changes are live.";
const NOTES: [RegExp, (text: string) => string][] = [
  [/paused for a check-in/i, () => "This change is paused for a check-in that can only be answered in the builder's own editor. Someone with access to the builder's editor needs to continue it there, or you can try rewording the request."],
  [/taking longer than 15 minutes/i, () => "This is taking longer than usual. It may still finish. You can press Submit for Review later to put your changes live."],
  [/^The draft is published/i, () => LIVE_NOTE],
  [/^Approval (granted|declined)/i, (t) => t],
];

/** The text to show for a history entry, or null to hide it (internal notes stay out). */
export function visibleText(entry: Entry): string | null {
  if (entry.role === "note") {
    if (entry.text === SIGN_IN_REQUIRED) return SIGN_IN_REQUIRED;
    for (const [re, out] of NOTES) if (re.test(entry.text)) return out(entry.text);
    return null;
  }
  if (entry.role === "error") return `${entry.text}\nTry sending it again in a moment.`;
  return entry.role === "user" ? readableReferences(entry.text) : entry.text;
}

// ---- the live "working on it" line ------------------------------------------------------------
export function workLabel(job: Job, now: number = Date.now()): string {
  const st = job.status;
  if (st === "approval") return "Waiting for an approval…";
  const variants = st === "content"
    ? ["Adding your edits to the draft…", "Saving your edits…", "Lining your edits up with the draft…", "Working on your draft edits…"]
    : job.kind === "change"
      ? st === "working"
        ? ["Making your change…", "Working on your change…", "Your change is still in progress…", "Giving your change the time it needs…", "Still working on it…"]
        : ["Sending your request…", "Passing your request along…", "Your request is on its way…", "Getting your request through…"]
      : job.kind === "dev"
        ? ["Updating the page…", "Working on the page update…", "The page update is in progress…", "Still working on the page…"]
        : st === "publishing"
          ? ["Going live…", "Putting your changes live…", "Publishing is still in progress…", "Your changes are on their way to the live site…"]
          : st === "updating"
            ? ["Waiting for the live site to update…", "Waiting for your changes to appear live…", "The live site is still catching up…", "Giving the live site time to update…"]
            : ["Reviewing your changes…", "Your changes are under review…", "The review is still in progress…", "Giving the review the time it needs…"];
  const elapsedMs = Math.max(0, now - (job.stepStartedAt || job.startedAt));
  return variants[Math.floor(elapsedMs / 7000) % variants.length];
}

export function workHint(job: Job, s: RelayState, now: number): string {
  const elapsed = now - (job.stepStartedAt || job.startedAt);
  if (job.kind === "change" && job.status === "working" && elapsed > 45000) return "Bigger changes take longer. You can keep this page open.";
  if (job.status === "reviewing" && s.review?.mode === "github") return "A review usually takes a minute or two.";
  if (job.status === "updating") return "The live site can take a minute or two to show the new version.";
  return "";
}

export const isWorking = (s: RelayState | null) =>
  Boolean(s && s.job && s.job.status !== "approval" && (s.busy || s.job.status === "queued"));

// ---- approvals ---------------------------------------------------------------------------------
export function approvalView(a: Approval): { title: string; canApprove: boolean; canDecline: boolean; note: string; editorUrl: string | null; approveLabel: string; declineLabel: string } {
  return {
    title: a.title,
    canApprove: a.rule === "ok" && !a.deciding,
    canDecline: !a.deciding,
    note: a.rule === "editor"
      ? "This one can only be answered in the builder's own editor (for example it involves a secret or key, or a form this chat can't show). Someone with access to the builder's editor can answer it there, or you can decline."
      : a.rule === "never"
        ? "Publishing can't be approved here. Decline this, then use Submit for Review."
        : "",
    editorUrl: a.rule === "editor" ? a.editorUrl : null,
    approveLabel: a.kind === "plan" ? "Approve plan" : "Approve",
    declineLabel: "Decline",
  };
}

export function missingField(fields: ApprovalField[] | null, answers: Record<string, string | number | boolean | undefined>): string | null {
  for (const f of fields ?? []) {
    if (!f.required) continue;
    const v = answers[f.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return f.label;
  }
  return null;
}

// ---- problems after a review stops the changes ------------------------------------------------
const blocking = (f: Finding) => !f.accepted && (f.severity === "high" || (f.severity === "medium" && f.area === "security"));

/** True when the automatic review stopped the changes for problems. People only see that a developer will review them. */
export function reviewBlocked(s: RelayState | null): boolean {
  const r = s?.draft?.review;
  return !!s && !s.busy && (s.publish?.open ?? 0) > 0 && s.publish?.status === "blocked" && r?.state === "failure";
}

/** Every unresolved problem the review found, including developer-only ones. Only the Developer Review page shows these. */
export function developerFindings(s: RelayState | null): Finding[] {
  return reviewBlocked(s) ? (s!.draft!.review!.findings || []).filter(blocking) : [];
}

export type ProblemsModel = { title: string; sub: string; items: Finding[]; devNote?: string };

export function undoPendingGate(s: RelayState | null): boolean {
  return s?.draft?.gate?.status === "undo-pending" || s?.publish?.status === "undo-pending";
}
export function undoPendingReason(s: RelayState | null): string {
  const reason = s?.draft?.gate?.reason ?? s?.publish?.reason;
  return typeof reason === "string" && reason.trim() ? reason : "The rejected change's undo hasn't joined the draft yet.";
}

/** What to show after a failed review: only what the person can act on. Anything that needs a developer is one line. */
export function problemsModel(s: RelayState | null): ProblemsModel | null {
  if (undoPendingGate(s)) return { title: "Undo not in yet", sub: undoPendingReason(s), items: [] };
  if (!s || s.busy) return null;
  const p = s.publish;
  const r = s.draft?.review;
  if (!p || p.open <= 0) return null;
  if (p.status === "error") {
    const unchanged = "Nothing was changed on the live site.";
    const fallback = `${unchanged} Press Submit for Review to try again.`;
    if (r?.state === "error" && r.retry === true && r.headline) {
      const summary = r.summary || fallback;
      return { title: r.headline, sub: summary.includes(unchanged) ? summary : `${unchanged} ${summary}`, items: [] };
    }
    return { title: "The review couldn't finish.", sub: fallback, items: [],
      devNote: "If it keeps happening, a developer can see the details on the Developer Review page." };
  }
  if (p.status === "blocked" && r && r.state === "failure") {
    return { title: "These changes need to be reviewed by a developer.", sub: "They can't go live until a developer reviews them. There is nothing you need to change.", items: [] };
  }
  return null;
}

// ---- attachments -------------------------------------------------------------------------------
/** A message to show if the file can't be attached, or null if it can. (The helper checks again, including the file's contents.) */
export function fileProblem(file: { name: string; size: number }, rules: UploadRules, alreadyAttached: number): string | null {
  if (alreadyAttached >= rules.maxFiles) return `You can attach up to ${rules.maxFiles} files at a time.`;
  const ext = `.${(file.name.split(".").pop() || "").toLowerCase()}`;
  const ok = rules.accept.split(",").filter(Boolean);
  if (ok.length && !ok.includes(ext)) return `${file.name} can't be attached. Pictures (PNG, JPG, GIF, WEBP) and documents (PDF, Word, TXT, MD, CSV) work.`;
  if (file.size > rules.maxBytes) return `${file.name} is larger than ${Math.round(rules.maxBytes / 1024 / 1024)} MB.`;
  if (!file.size) return `${file.name} is empty.`;
  return null;
}

/**
 * The preview address pointed at one page of the design site. The page goes in front of the "?" part (which carries the
 * preview's access token), so https://x.lovable.app/?__lovable_token=abc becomes https://x.lovable.app/about?__lovable_token=abc.
 * Lovable doesn't document a way to open a given page, so this is a best effort; the home page is used if the address
 * can't be read.
 */
export function withPath(embedUrl: string, path?: string | null): string {
  if (!path || path === "/") return embedUrl;
  try {
    const u = new URL(embedUrl);
    const page = "/" + path.replace(/[?#].*$/, "").replace(/^\/+/, "");
    u.pathname = u.pathname.replace(/\/+$/, "") + page;
    return u.toString();
  } catch {
    return embedUrl;
  }
}
