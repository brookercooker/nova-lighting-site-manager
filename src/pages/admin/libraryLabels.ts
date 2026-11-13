import type { LabelRow } from "./useAllLabels";

export const shortLabelName = (name: string) => Array.from(name).length > 12 ? `${Array.from(name).slice(0, 11).join("")}…` : name;
export function cardLabelSummary(paths: string[], rows: LabelRow[]) {
  const unique = [...new Set(paths)];
  return { visible: unique.slice(0, 2).map(path => ({ path, name: rows.find(r => r.path === path)?.name ?? path.split("/").pop() ?? path, colorIndex: rows.find(r => r.path === path)?.color_index })), remaining: Math.max(0, unique.length - 2) };
}
export const rankLibraryLabels = (rows: LabelRow[], counts: Record<string, number>) => [...rows].sort((a, b) => (counts[b.path] ?? 0) - (counts[a.path] ?? 0) || a.path.localeCompare(b.path));
export const addLibraryLabelFilter = (current: string[], path: string) => current.includes(path) ? current : [...current, path];