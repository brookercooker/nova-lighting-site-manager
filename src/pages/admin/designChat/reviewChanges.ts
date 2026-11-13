import type { DraftRequest } from "./helper";
import { linkHistoryLine } from "../linkDisplay";

export type ChangeKind = "chat" | "content" | "developer" | "automatic";
export const CHANGE_LABEL: Record<ChangeKind, string> = {
  chat: "Chat Request", content: "Manual Edit", developer: "Developer Edit", automatic: "Automatic Update",
};
const CONTENT_PREFIX = "Edits made in the Site Manager:";

const n = (a?: string[]) => a?.length ?? 0;
/** Badge from the relay's own source value; platform/setup-only changes are automatic updates. */
export function changeKind(r: DraftRequest): ChangeKind {
  if (r.source === "content") return "content";
  if (r.source === "developer") return "developer";
  if (r.source === "platform" || r.source === "setup") return "automatic";
  if (n(r.files) + n(r.siteFiles) === 0 && n(r.platformFiles) + n(r.setupFiles) > 0) return "automatic";
  return "chat";
}

export function changeTitle(r: DraftRequest): { title: string | null; body: string } {
  const text = r.request ?? "";
  if (r.source === "content" && text.startsWith(CONTENT_PREFIX)) return { title: "Edits Made in the Site Manager", body: text.slice(CONTENT_PREFIX.length).trim().split("\n").map(linkHistoryLine).join("\n") };
  return { title: null, body: text };
}

export const atMs = (at?: number | string) => {
  if (at == null) return NaN;
  if (typeof at === "number") return at < 1e12 ? at * 1000 : at;
  return Date.parse(at);
};

export const newestFirst = (list: DraftRequest[]) =>
  list.map((r, i) => ({ r, i })).sort((a, b) => (atMs(b.r.at) || 0) - (atMs(a.r.at) || 0) || b.i - a.i).map((x) => x.r);

export function relativeTime(ms: number, now: number): string {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const units: [number, string][] = [[86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [size, name] of units) if (s >= size) { const v = Math.floor(s / size); return `${v} ${name}${v === 1 ? "" : "s"} ago`; }
  return "just now";
}

export const waitingLine = (count: number) => `${count} ${count === 1 ? "change" : "changes"}`;
