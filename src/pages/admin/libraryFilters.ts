export type LibraryFilters = { searchField: string; labels: string[]; timeRange: string; dateFrom: string; dateTo: string; archived: boolean; extra: string };
export const clearLibraryFilters = (): LibraryFilters => ({ searchField: "all", labels: [], timeRange: "all", dateFrom: "", dateTo: "", archived: false, extra: "all" });
export const validLibraryDates = (f: LibraryFilters) => !f.dateFrom || !f.dateTo || f.dateFrom <= f.dateTo;
export function activeLibraryFilters(f: LibraryFilters, fields: { v: string; label: string }[], extras: { v: string; label: string }[] = []) {
  const chips: { id: string; label: string; labelPath?: string; clear: (next: LibraryFilters) => LibraryFilters }[] = [];
  if (f.timeRange !== "all" || f.dateFrom || f.dateTo) chips.push({ id: "date", label: f.timeRange === "custom" ? `${f.dateFrom || "…"} – ${f.dateTo || "…"}` : ({ hour: "Last Hour", day: "Last 24h", week: "Last 7 Days" }[f.timeRange] ?? "Custom"), clear: n => ({ ...n, timeRange: "all", dateFrom: "", dateTo: "" }) });
  for (const path of f.labels) chips.push({ id: `label:${path}`, label: path, labelPath: path, clear: n => ({ ...n, labels: n.labels.filter(p => p !== path) }) });
  if (f.extra !== "all") chips.push({ id: "extra", label: extras.find(o => o.v === f.extra)?.label ?? f.extra, clear: n => ({ ...n, extra: "all" }) });
  if (f.searchField !== "all") chips.push({ id: "field", label: `Search in ${fields.find(o => o.v === f.searchField)?.label ?? f.searchField}`, clear: n => ({ ...n, searchField: "all" }) });
  if (f.archived) chips.push({ id: "archived", label: "Archived", clear: n => ({ ...n, archived: false }) });
  return chips;
}