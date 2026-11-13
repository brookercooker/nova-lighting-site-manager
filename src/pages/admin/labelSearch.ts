import { labelKey } from "./objectLabelFilter";
export type SearchLabel = { path: string; name: string; color_index?: number | null };
export function matchingLabels(labels: SearchLabel[], query: string, selected: string[], counts: Record<string, number>) {
  const term = labelKey(query), chosen = new Set(selected.map(labelKey));
  return labels.filter(l => !term || labelKey(l.name).includes(term)).sort((a, b) => Number(chosen.has(labelKey(b.path))) - Number(chosen.has(labelKey(a.path))) || (counts[b.path] ?? 0) - (counts[a.path] ?? 0) || a.path.localeCompare(b.path));
}
export function labelMatchParts(name: string, query: string): { text: string; match: boolean }[] {
  const term = labelKey(query); if (!term) return [{ text: name, match: false }];
  const parts: { text: string; match: boolean }[] = []; let start = 0;
  const lower = name.toLowerCase(); let index = lower.indexOf(term);
  while (index >= 0) { if (index > start) parts.push({ text: name.slice(start, index), match: false }); parts.push({ text: name.slice(index, index + term.length), match: true }); start = index + term.length; index = lower.indexOf(term, start); }
  if (start < name.length) parts.push({ text: name.slice(start), match: false }); return parts;
}
export const libraryCount = (count: number, noun: string) => `${count} ${count === 1 ? noun.replace(/s$/, "") : noun}`;
export const labelCount = (count: number) => count === 0 ? "No labels" : libraryCount(count, "labels");