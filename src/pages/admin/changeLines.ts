import { parseKey, type InlineEdits } from "@/lib/inlineEditCore";
import { publicLinkAddress, shortLinkLabel } from "./linkDisplay";

/** Plain-language summaries of a Manual Edit save, sent to the relay as `changes`. Never CSS names, keys or ids. */
export type ElementLabel = { tag?: string; kind?: string; text?: string; style?: Record<string, string> };
type BlockLike = { id: string; type: string; name?: string; url?: string; caption?: string; alt?: string; objectId?: string };

export const MAX_LINES = 30;
const MAX_LINE = 200;
const SWAP = "objectSwap:";

export function quote(text: string, max = 50): string {
  const t = text.replace(/\s+/g, " ").trim();
  return `"${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}"`;
}
const plain = (html = "") => html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const clip = (line: string) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line);
const readStyle = (v?: string): Record<string, string> => { try { const o = v ? JSON.parse(v) : {}; return o && typeof o === "object" ? o : {}; } catch { return {}; } };
const camel = (p: string) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const STYLE_NAMES: Record<string, string> = {
  "font-size": "text size", color: "text colour", "font-family": "font", "font-weight": "weight", "font-style": "italic",
  "text-transform": "capitals", "text-decoration": "underline", "text-align": "alignment", "letter-spacing": "letter spacing",
  "line-height": "line spacing", width: "width", height: "height", "object-fit": "picture fit", "border-radius": "corner rounding",
  visibility: "visibility", "background-color": "background colour", "margin-top": "space above", "margin-bottom": "space below",
};
const SKIP = new Set(["display", "flex-direction"]);
const WEIGHTS: Record<string, string> = { "100": "Thin", "200": "Extra Light", "300": "Light", "400": "Regular", "500": "Medium", "600": "Semibold", "700": "Bold", "800": "Extra Bold", "900": "Black" };

function friendly(prop: string, value: string | undefined): string {
  if (!value) return "default";
  if (prop === "font-family") return value.split(",")[0].replace(/["']/g, "").trim();
  if (prop === "font-weight") return WEIGHTS[value] ?? value;
  return value.trim();
}
function stylePart(prop: string, from?: string, to?: string): string {
  const name = prop.startsWith("border-") ? "border" : STYLE_NAMES[prop] ?? "style";
  const a = friendly(prop, from), b = friendly(prop, to);
  const unit = /^-?[\d.]+px$/.test(a) && /^-?[\d.]+px$/.test(b) ? " px" : "";
  return from === undefined && !to ? name : `${name} ${unit ? a.replace(/px$/, "") : a} → ${unit ? b.replace(/px$/, "") : b}${unit}`;
}
function noun(label?: ElementLabel): string {
  const tag = (label?.tag ?? "").toLowerCase(), kind = label?.kind ?? "";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "button" || kind === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "img" || kind === "image") return "picture";
  if (tag === "video" || kind === "video") return "video";
  if (tag === "input" || tag === "textarea" || kind === "input") return "form field";
  if (tag === "p") return "paragraph";
  return "text";
}

/** Inline (wording, style, picture, link, placeholder, copy) edits between two saved states, one line per element. */
export function inlineChangeLines(subject: string, before: InlineEdits, after: InlineEdits, labels: Record<string, ElementLabel> = {}, swapNames: Record<string, string> = {}): string[] {
  const lines: string[] = [];
  const byPath = new Map<string, string[]>();
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] === after[key] || key.startsWith("fp:")) continue;
    if (key.startsWith(SWAP)) {
      const slot = key.slice(SWAP.length), name = swapNames[slot];
      lines.push(after[key] ? `${subject}: made its own copy of ${name ? quote(name) : "a shared object"}` : `${subject}: went back to the shared ${name ? quote(name) : "object"}`);
      continue;
    }
    // Keep summaries of historical saves even when the exact current core lacks these kinds.
    const legacy = /^(hidden|placeholder):(\d+(?:\.\d+)*)?$/.exec(key);
    const p = parseKey(key) ?? (legacy ? { kind: legacy[1], path: legacy[2] ?? "" } : null);
    if (!p) continue;
    byPath.set(p.path, [...(byPath.get(p.path) ?? []), key]);
  }
  for (const [path, keys] of byPath) {
    const label = labels[path];
    const n = noun(label);
    const htmlKey = keys.find(k => parseKey(k)?.kind === "html");
    const oldText = htmlKey ? plain(before[htmlKey] ?? label?.text ?? "") : plain(label?.text ?? "");
    const newText = htmlKey ? plain(after[htmlKey] ?? label?.text ?? "") : "";
    const parts: string[] = [];
    let wording: string | null = null, link: string | null = null, picture = false, moved = false;
    for (const key of keys) {
      const legacy = /^(hidden|placeholder):(\d+(?:\.\d+)*)?$/.exec(key);
      const parsed = parseKey(key) ?? (legacy ? { kind: legacy[1], path: legacy[2] ?? "" } : null); if (!parsed) continue;
      const kind = parsed.kind;
      if (kind === "hidden") { lines.push(after[key] === "1" ? `Picture removed from ${subject}` : `Picture restored on ${subject}`); continue; }
      if (kind === "html") {
        if (oldText !== newText) wording = newText;
        else parts.push("text formatting");
      } else if (kind === "style") {
        const a = readStyle(before[key]), b = readStyle(after[key]);
        for (const prop of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (a[prop] === b[prop] || SKIP.has(prop)) continue;
          if (prop === "order") { moved = true; continue; }
          const part = stylePart(prop, a[prop] ?? label?.style?.[camel(prop)] ?? label?.style?.[prop], b[prop]);
          if (!parts.includes(part)) parts.push(part);
        }
      } else if (kind === "img" || kind === "icon") picture = true;
      else if (kind === "link") {
        const l = readStyle(after[key]) as { href?: string; unlinked?: boolean };
        link = l.href ? `link to ${l.href}` : after[key] ? "removed the link" : "restored the original link";
      } else if (kind === "placeholder") parts.push(`placeholder ${quote(before[key] ?? "")} → ${quote(after[key] ?? "")}`);
    }
    const named = oldText ? `the ${n} ${quote(oldText)}` : `a ${n}`;
    const extras = [...(wording !== null ? [`wording → ${quote(wording)}`] : []), ...(link ? [link] : []), ...(picture ? ["picture replaced"] : []), ...(moved ? ["moved"] : []), ...parts];
    let line: string;
    if (extras.length === 0) continue;
    if (extras.length === 1 && wording !== null) line = `changed ${named} to ${quote(wording)}`;
    else if (extras.length === 1 && link) line = link.startsWith("link to ") ? `Changed link: ${shortLinkLabel(oldText || "Text link")} to ${publicLinkAddress(link.slice(8))}` : `${link} on ${named}`;
    else if (extras.length === 1 && picture) line = `replaced the picture${oldText ? ` in ${quote(oldText)}` : ""}`;
    else if (extras.length === 1 && moved) line = `moved ${named}`;
    else line = `${oldText ? `${n} ${quote(oldText)}` : n} ${extras.join(", ")}`;
    lines.push(`${subject}: ${line}`);
  }
  return lines.map(clip);
}

function blockName(b: BlockLike): string {
  if (b.type === "page") return "the page content";
  const what = b.type === "object" ? "object" : b.type === "image" ? "picture" : b.type === "video" ? "video" : "section";
  const name = b.name || b.caption || b.alt || (b.url ? b.url.split("/").pop()?.split("?")[0] : "");
  return name ? `the ${what} ${quote(name)}` : `a ${what}`;
}

/** Added, removed and moved sections (the page-content marker counts as "the page content"). */
export function blockChangeLines(subject: string, before: BlockLike[], after: BlockLike[]): string[] {
  const lines: string[] = [];
  const beforeIds = new Set(before.map(b => b.id)), afterIds = new Set(after.map(b => b.id));
  // A missing marker means page content first; compare with it in place on both sides.
  const withMarker = (list: BlockLike[], other: BlockLike[]) => (!list.some(b => b.type === "page") && other.some(b => b.type === "page") ? [{ id: "page-content", type: "page" }, ...list] : list);
  const b0 = withMarker(before, after), a0 = withMarker(after, before);
  for (const b of after) if (!beforeIds.has(b.id) && b.type !== "page") lines.push(`${subject}: added ${blockName(b)}`);
  for (const b of before) if (!afterIds.has(b.id) && b.type !== "page") lines.push(`${subject}: removed ${blockName(b)}`);
  const ids = new Set(a0.map(b => b.id));
  const cur = b0.filter(b => ids.has(b.id)).map(b => b.id);
  const target = a0.filter(b => cur.includes(b.id)).map(b => b.id);
  for (let guard = 0; guard < 50 && cur.join() !== target.join(); guard++) {
    let best = "", shift = 0;
    for (const id of cur) {
      const s = target.indexOf(id) - cur.indexOf(id);
      const isMarker = id === "page-content";
      if (Math.abs(s) > Math.abs(shift) || (Math.abs(s) === Math.abs(shift) && s !== 0 && best === "page-content" && !isMarker)) { best = id; shift = s; }
    }
    if (!best) break;
    cur.splice(cur.indexOf(best), 1); cur.splice(target.indexOf(best), 0, best);
    lines.push(`${subject}: moved ${blockName(a0.find(b => b.id === best)!)} ${shift < 0 ? "up" : "down"}`);
  }
  return lines.map(clip);
}

/** Merges line lists from several saves: order kept, duplicates dropped, capped at 30. */
export function mergeChangeLines(...lists: (string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap(l => l ?? []).map(l => l.trim()).filter(Boolean))].slice(0, MAX_LINES).map(clip);
}
