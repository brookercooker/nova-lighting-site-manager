import { supabase } from "@/prototype/client";
import { parseKey, validateEdits, type InlineEdits } from "@/lib/inlineEditCore";
import { saveRow } from "../saveRow";
import { inlineChangeLines } from "../changeLines";
import { LINK_DESTINATION_ERROR, validTextLink } from "../textAdornment";
import { requestInventory, type InventoryLink } from "./linkInventory";
import { publicPreviewBase, publicPreviewPage } from "./publicPreviewUrl";
import { publicLinkAddress } from "../linkDisplay";

export type ResolvedReviewLink = { table: "pages" | "object_registry"; id: string; name: string; updatedAt: string; edits: InlineEdits; element: InventoryLink; href: string; blank: boolean };
export const FIND_LINK_ERROR = "We couldn't find this link on the page";

/** Only authoritative frame keys and complete link metadata can authorize a direct write. */
export async function resolveReviewLink(path: string, href: string, label: string | null, embed?: string): Promise<ResolvedReviewLink> {
  const inv = await requestInventory(publicPreviewPage(publicPreviewBase(embed), path));
  const candidates = inv?.links.filter(l => l.href === href && parseKey(`link:${l.key}`) && (l.scope === "page" || l.scope.startsWith("object:"))) ?? [];
  const named = label ? candidates.filter(l => l.label === label) : [];
  const pool = named.length ? named : candidates;
  const body = pool.filter(l => l.scope === "page");
  const matches = body.length ? body : pool;
  if (matches.length !== 1) throw new Error(FIND_LINK_ERROR);
  const element = matches[0];
  const table = element.scope === "page" ? "pages" : "object_registry";
  let query = (supabase as any).from(table).select("id,name,updated_at,inline_edits");
  query = table === "pages" ? query.eq("path", path) : query.eq("id", element.scope.slice(7));
  const { data, error } = await query.maybeSingle();
  if (error || !data || typeof data.updated_at !== "string") throw new Error(FIND_LINK_ERROR);
  const edits: InlineEdits = data.inline_edits ?? {};
  let override: { href?: string; target?: string; unlinked?: boolean } | null = null;
  try { override = edits[`link:${element.key}`] ? JSON.parse(edits[`link:${element.key}`]) : null; } catch { throw new Error(FIND_LINK_ERROR); }
  const current = override?.unlinked ? "" : override?.href ?? element.href;
  if (current !== href) throw new Error("This link changed since review opened. Cancel and try again.");
  // Never guess the current target or invent a fingerprint for a cross-origin element.
  const fingerprint = edits[`fp:${element.key}`] ?? element.fingerprint;
  if ((!override && element.target === undefined) || !fingerprint || validateEdits({ [`fp:${element.key}`]: fingerprint }).rejected.length) throw new Error(FIND_LINK_ERROR);
  return { table, id: data.id, name: data.name, updatedAt: data.updated_at, edits: { ...edits, [`fp:${element.key}`]: fingerprint }, element, href: current, blank: override ? override.target === "_blank" : element.target === "_blank" };
}

/** Same confirmed-row save and change descriptions as Manual Edit; successful saves reset local undo history. */
export async function saveReviewLink(resolved: ResolvedReviewLink, href: string, blank: boolean): Promise<string[]> {
  href = publicLinkAddress(href);
  if (!validTextLink(href)) throw new Error(LINK_DESTINATION_ERROR);
  const key = `link:${resolved.element.key}`;
  const next = { ...resolved.edits, [key]: JSON.stringify({ href, ...(blank ? { target: "_blank" } : {}) }) };
  const { error } = await saveRow(resolved.table, { inline_edits: next, updated_at: new Date().toISOString() }, resolved.id, resolved.updatedAt);
  if (error) throw new Error(error.message);
  return inlineChangeLines(resolved.name, resolved.edits, next, { [resolved.element.key]: { text: resolved.element.label ?? "", tag: "a" } });
}