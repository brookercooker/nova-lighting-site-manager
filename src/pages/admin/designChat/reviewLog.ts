import type { DraftRequest, RelayState } from "./helper";
import { newestFirst, changeTitle, atMs } from "./reviewChanges";
import { linkHistoryLine } from "../linkDisplay";

export type LogEntry = { key: string; text: string; requests: DraftRequest[]; reverted: boolean };
/** Optional service-owned published-baseline net inventory; absence never means zero. */
export function publishedNet(state: RelayState | null): { count: number; entries: LogEntry[] } | null {
  const raw = (state?.draft as unknown as { netChanges?: unknown })?.netChanges;
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { baseline?: unknown; items?: unknown };
  if (data.baseline !== "published" || !Array.isArray(data.items) || data.items.length > 500) return null;
  const entries: LogEntry[] = [];
  const seen = new Set<string>();
  for (const value of data.items) {
    if (!value || typeof value !== "object") return null;
    const item = value as { id?: unknown; summary?: unknown; changed?: unknown; requestIds?: unknown };
    if (typeof item.id !== "string" || !item.id || seen.has(item.id) || typeof item.summary !== "string" || item.summary.length > 1000 || typeof item.changed !== "boolean" || !Array.isArray(item.requestIds) || item.requestIds.some(id => typeof id !== "string")) return null;
    const requestIds = item.requestIds;
    seen.add(item.id);
    entries.push({ key: item.id, text: item.changed ? item.summary : `${item.summary}: no net change`, reverted: !item.changed, requests: newestFirst((state?.draft?.requests ?? []).filter(r => requestIds.includes(r.id))) });
  }
  entries.sort((a, b) => (atMs(b.requests[0]?.at) || 0) - (atMs(a.requests[0]?.at) || 0));
  return { count: entries.filter(e => !e.reverted).length, entries };
}
/** Display grouping only: save descriptions cannot establish published equivalence. */
export function groupedLog(requests: DraftRequest[]): LogEntry[] {
  const entries = new Map<string, LogEntry>();
  for (const r of newestFirst(requests)) {
    const lines = r.source === "content" ? r.details?.length ? r.details : changeTitle(r).body.split("\n").filter(Boolean) : [r.request];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const text = linkHistoryLine(raw).replace(/\s+/g, " ").trim();
      if (!text) continue;
      const changed = /^(.*?): Changed link: (.*?) to (.+)$/.exec(text);
      const restored = /^(.*?): (?:restored the original link|removed the link) on the (?:link|text|button) "(.*?)"$/.exec(text);
      const key = r.source === "content" && (changed || restored) ? `link:${(changed ?? restored)?.[1]}:${(changed ?? restored)?.[2]}` : `request:${r.id}:${i}`;
      const existing = entries.get(key);
      if (existing) { if (!existing.requests.some(old => old.id === r.id)) existing.requests.push(r); }
      else entries.set(key, { key, text: changed ? `${changed[1]}: ${changed[2]} link → ${changed[3]}` : text, requests: [r], reverted: false });
    }
  }
  return [...entries.values()];
}
export const reviewDisplayCount = (state: RelayState | null) => publishedNet(state)?.count ?? state?.publish?.open ?? state?.draft?.requests?.length ?? 0;