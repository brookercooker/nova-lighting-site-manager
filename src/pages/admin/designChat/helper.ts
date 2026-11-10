/**
 * How the Design Chat tab talks to the design service and to the preview-address function.
 * By default it uses the hosted design service. The local helper (prototyper-local) can still be used
 * by setting "designRelayUrl" in the browser (localStorage) or VITE_DESIGN_RELAY_URL.
 */

import { hasManagerUser, SIGN_IN_REQUIRED } from "@/lib/authGate";
import { toast } from "sonner";

function storedRelay(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const v = window.localStorage.getItem("designRelayUrl");
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  } catch {
    return undefined;
  }
}

const envRelay = import.meta.env.VITE_DESIGN_RELAY_URL as string | undefined;
export const RELAY = (storedRelay() || envRelay || "").replace(/\/$/, "") || "https://nova-relay.a02392549.workers.dev";

/** True only for an https address that isn't this computer. */
export function isHostedRelay(url: string): boolean {
  if (typeof url !== "string" || !url.startsWith("https://")) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return false;
  if (host.endsWith(".localhost")) return false;
  return true;
}

export const RELAY_IS_HOSTED = isHostedRelay(RELAY);

/** Sign-in header for a hosted helper; nothing for the local one. */
export async function relayHeaders(): Promise<Record<string, string>> {
  if (!RELAY_IS_HOSTED) return {};
  const { relayAuthHeader } = await import("./relayAuth");
  return relayAuthHeader();
}
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const EMBED_FN = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/lovable-embed-url` : "";

export type Entry = { role: "user" | "assistant" | "note" | "error"; text: string; ts?: number };

export type Finding = {
  id: string;
  issue: string;
  fix?: string;
  request?: string;
  severity?: string;
  area?: string;
  file?: string;
  accepted?: boolean;
};

export type Job = { id?: string; kind?: string; planOnly?: boolean; status: string; startedAt: number; lastStep?: string; stepStartedAt?: number };

export type UploadRules = { maxFiles: number; maxBytes: number; accept: string };

export type DraftRequest = {
  id: string; request: string; source?: string; at?: number | string; sha?: string; builtAt?: number;
  by?: string | null;
  files?: string[]; siteFiles?: string[]; platformFiles?: string[]; setupFiles?: string[];
  notes?: string;
  /** Rejected requests carry { reason, at, by }; older relays omit it. Validate unknown relay data before displaying it. */
  decision?: unknown;
  undoPending?: boolean;
  isUndo?: boolean;
  /** Sent by redeployed relays only. */
  page?: { name: string; path: string } | null;
  /** Every page the request changed (newer relays); fall back to `page` when absent. */
  pages?: { name: string; path: string }[];
  /** Names of shared objects the request touched; every page using them changed too. */
  objects?: string[];
  /** Plain lines saying what changed; empty for older requests. */
  details?: string[];
};

export type RelayState = {
  busy: boolean;
  job: Job | null;
  previewVersion: number;
  previewBuiltAt?: number | null;
  previewChecking?: boolean;
  /** True when the design service takes drawings (marks and a picture) with a request. */
  drawing?: boolean;
  history: Entry[];
  changes?: DraftRequest[];
  publish?: { ok?: boolean; open: number; status?: string; willReview?: boolean; reason?: string };
  /** requests: the changes in the draft awaiting review (newer relays only). */
  draft?: { gate?: { status?: string; reason?: string }; requests?: DraftRequest[]; review?: { state?: string; locked?: boolean; findings?: Finding[]; headline?: string; summary?: string; retry?: boolean } };
  review?: { enabled?: boolean; mode?: string };
  liveUrl?: string | null;
  embedEnabled?: boolean;
  uploads?: UploadRules;
  approval?: Approval | null;
};

export type ApprovalField = {
  key: string;
  label: string;
  kind: "text" | "longtext" | "number" | "yesno" | "choice";
  options?: string[];
  required: boolean;
  help?: string;
};
export type Approval = {
  id: string;
  title: string;                       // plain-words summary, e.g. "Review the builder's plan"
  detail: string;                      // for a plan: the plan text; otherwise what exactly is proposed. Plain text, may be long
  kind: "plan" | "action";
  rule: "ok" | "editor" | "never";     // ok = can be answered here; editor = can only be answered in the builder's own editor (secrets/keys, forms this chat can't show); never = publishing, decline only
  editorUrl: string | null;
  fields: ApprovalField[] | null;      // values the builder wants typed in, if any
  createdAt: number;
  deciding: boolean;
};

/** Used until the helper has said what it accepts (these match the helper's own rules). */
export const DEFAULT_UPLOADS: UploadRules = {
  maxFiles: 5,
  maxBytes: 10 * 1024 * 1024,
  accept: ".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.doc,.txt,.md,.csv",
};

/** POST JSON to the helper. Returns { ok } or { ok: false, error } with a message fit to show. */
export async function postToHelper(path: string, body?: unknown): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    if (!await hasManagerUser()) {
      if (path !== "/content/sync") toast.info(SIGN_IN_REQUIRED);
      return { ok: false, error: SIGN_IN_REQUIRED };
    }
    const res = await fetch(`${RELAY}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await relayHeaders()) },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const fallback = res.status === 401 || res.status === 403
        ? "You need to be signed in to use the design service."
        : "That didn't go through. Try again.";
      return { ok: false, error: data.error || fallback, data };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Can't reach the design service right now. Try again in a moment." };
  }
}
