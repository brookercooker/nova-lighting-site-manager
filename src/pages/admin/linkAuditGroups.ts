/** Display-only helpers for Link Audit: never change stored rows or identity keys. */

/** Wildcard / parameter routes (the Not Found "*" route, "/products/:id") are not real pages to scan. */
export function isScannablePath(path: string): boolean {
  return !!path && !path.includes("*") && !path.split("/").some((seg) => seg.startsWith(":"));
}

export interface GroupableRow {
  id: string; location: string; destination: string; status: string; link_text: string;
  is_deleted?: boolean; source_pages?: string[] | null;
}

export type LinkItem<R extends GroupableRow> =
  | { kind: "row"; row: R }
  | { kind: "group"; key: string; location: string; destination: string; status: string; rows: R[] };

export const GROUP_MIN = 5;

/** Free-text search across a row's own fields; grouping runs after this, so any text inside a group still matches. */
export function linkMatches(r: GroupableRow, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return [r.destination, r.link_text, r.location, ...(r.source_pages || [])].some((v) => (v || "").toLowerCase().includes(t));
}

/** Rows sharing location + destination + status (and deleted state) collapse into one item when there are `min` or more. */
export function groupLinkRows<R extends GroupableRow>(rows: R[], min = GROUP_MIN): LinkItem<R>[] {
  const buckets = new Map<string, R[]>();
  const order: string[] = [];
  for (const r of rows) {
    const key = JSON.stringify([r.location, r.destination, r.status, !!r.is_deleted]);
    const b = buckets.get(key);
    if (b) b.push(r); else { buckets.set(key, [r]); order.push(key); }
  }
  const out: LinkItem<R>[] = [];
  for (const key of order) {
    const b = buckets.get(key)!;
    if (b.length >= min && b[0].destination) out.push({ kind: "group", key, location: b[0].location, destination: b[0].destination, status: b[0].status, rows: b });
    else b.forEach((row) => out.push({ kind: "row", row }));
  }
  return out;
}
