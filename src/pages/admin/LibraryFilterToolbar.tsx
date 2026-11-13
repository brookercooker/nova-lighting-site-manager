import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, ArrowDownWideNarrow, ChevronDown, X, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { useManagerLayout } from "./designChat/useManagerLayout";
import { useLabelsForScope, type LabelScope } from "./useAllLabels";
import { colorFor } from "./labelColors";
import { activeLibraryFilters, clearLibraryFilters, validLibraryDates, type LibraryFilters } from "./libraryFilters";
import LabelSearchList from "./LabelSearchList";
import { LABEL_SEP, MAX_DEPTH, validateLeafName } from "./labelPath";
import { libraryCount } from "./labelSearch";
import { registerLabelPath, useInvalidateLabels } from "./useAllLabels";
import { shortLabelName } from "./libraryLabels";
import LibraryViewToggle from "./LibraryViewToggle";
import UsedOnChoices from "./UsedOnChoices";
import type { LibraryView } from "./libraryView";

type Option = { v: string; label: string };
export default function LibraryFilterToolbar({ scope, noun, search, onSearch, value, onApply, fields, sort, onSort, sortOptions, count, countResults, extraLabel, extraOptions = [], onAdd, onEdit, editing, editTools, action, navigation, labelUsageCounts = {}, view, onViewChange }: {
  view?: LibraryView; onViewChange?: (view: LibraryView) => void;
  labelUsageCounts?: Record<string, number>;
  scope: LabelScope; noun: string; search: string; onSearch: (v: string) => void; value: LibraryFilters; onApply: (v: LibraryFilters) => void;
  fields: Option[]; sort: string; onSort: (v: string) => void; sortOptions: Option[]; count: number; countResults: (v: LibraryFilters) => number;
  extraLabel?: string; extraOptions?: Option[]; onAdd: () => void; onEdit: () => void; editing: boolean; editTools?: ReactNode; action?: ReactNode; navigation?: ReactNode;
}) {
  const { phone } = useManagerLayout();
  const { data: labels = [] } = useLabelsForScope(scope);
  const invalidateLabels = useInvalidateLabels(scope);
  const [labelError, setLabelError] = useState("");
  const createLabel = async (query: string) => { const parts = query.trim().toLowerCase().split(LABEL_SEP); const invalid = parts.map(validateLeafName).find(Boolean); if (invalid || parts.length > MAX_DEPTH) { setLabelError(invalid ?? `Max nesting depth is ${MAX_DEPTH}.`); return; } try { const id = await registerLabelPath(query, scope); if (!id) { setLabelError("Could not create label."); return; } invalidateLabels(); setDraft(d => ({ ...d, labels: [...new Set([...d.labels, query.trim().toLowerCase()])] })); setLabelError(""); } catch (e) { setLabelError(e instanceof Error ? e.message : "Could not create label."); } };
  const [managing, setManaging] = useState(false);
  useEffect(() => { const openManagement = (e: Event) => { if ((e as CustomEvent).detail === scope) setManaging(true); }; window.addEventListener("nova:manage-library-labels", openManagement); return () => window.removeEventListener("nova:manage-library-labels", openManagement); }, [scope]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const filterRef = useRef<HTMLButtonElement>(null);
  const chips = activeLibraryFilters(value, fields, extraOptions);
  const changeOpen = (next: boolean) => { if (next) { setDraft({ ...value, labels: [...value.labels] }); } setOpen(next); };
  const apply = () => { if (!validLibraryDates(draft)) return; onApply(draft); setOpen(false); };
  const patch = (next: Partial<LibraryFilters>) => setDraft(d => ({ ...d, ...next }));
  const labelColor = (path: string) => colorFor(path, labels.find(l => l.path === path)?.color_index);
  const choices = (title: string, options: Option[], selected: string, onSelect: (v: string) => void) => <div>
    <h3 className="mb-1 font-sans text-[10px] font-semibold uppercase text-muted-foreground">{title}</h3>
    <div role="group" aria-label={title} className="flex min-w-0 flex-wrap gap-1.5">{options.map(o => <Button key={o.v} type="button" variant={selected === o.v ? "default" : "outline"} aria-pressed={selected === o.v} title={o.label} className="h-11 min-w-0 max-w-full rounded-full px-3 text-xs" onClick={() => onSelect(o.v)}><span className="truncate">{o.label}</span></Button>)}</div>
  </div>;
  const panel = <>
    <div className="flex h-14 shrink-0 items-center justify-between border-b px-4"><h2 className="font-sans text-base font-semibold">Filters</h2><Button variant="ghost" className="h-11 w-11 p-0" aria-label="Close Filters" onClick={() => changeOpen(false)}><X className="h-4 w-4" /></Button></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
      {choices("Modified", [{ v: "all", label: "All" }, { v: "hour", label: "1h" }, { v: "day", label: "24h" }, { v: "week", label: "7 Days" }, { v: "custom", label: "Custom" }], draft.timeRange, v => patch({ timeRange: v, ...(v !== "custom" ? { dateFrom: "", dateTo: "" } : {}) }))}
      {draft.timeRange === "custom" && <div><div className="grid grid-cols-2 gap-2">{(["dateFrom", "dateTo"] as const).map((key, i) => <label key={key} className="min-w-0 text-xs">{i ? "To" : "From"}<Input type="date" aria-label={i ? "To" : "From"} value={draft[key]} onChange={e => patch({ [key]: e.target.value })} className="mt-1 h-11 w-full min-w-0 text-xs" /></label>)}</div><Button variant="link" className="h-10 px-0 text-xs" onClick={() => patch({ dateFrom: "", dateTo: "" })}>Clear Dates</Button>{!validLibraryDates(draft) && <p role="alert" className="text-xs text-destructive">From must be on or before To.</p>}</div>}
      <div><h3 className="mb-1 font-sans text-[10px] font-semibold uppercase text-muted-foreground">Labels</h3>
        <LabelSearchList labels={labels} selected={draft.labels} counts={labelUsageCounts} onToggle={path => { const next = { ...value, labels: draft.labels.includes(path) ? draft.labels.filter(p => p !== path) : [...draft.labels, path] }; patch({ labels: next.labels }); onApply(next); }} onCreate={query => void createLabel(query)} />
        {labelError && <p role="alert" className="text-xs text-destructive">{labelError}</p>}
        <Button variant="link" className="h-11 px-0 text-xs text-muted-foreground" onClick={() => { setOpen(false); setManaging(true); }}>Manage Labels</Button>
      </div>
      {extraLabel === "Used On" ? <UsedOnChoices options={extraOptions} selected={draft.extra} onSelect={v => patch({ extra: v })} /> : extraLabel && choices(extraLabel, extraOptions, draft.extra, v => patch({ extra: v }))}
      {choices("Search In", fields, draft.searchField, v => patch({ searchField: v, ...(v === "date_taken" ? { timeRange: "custom" } : {}) }))}
      <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-medium">Show Archived Only<Switch checked={draft.archived} onCheckedChange={v => patch({ archived: v })} aria-label="Show Archived Only" /></label>
    </div>
    <div className="shrink-0 border-t bg-background p-3"><div className="flex gap-2"><Button variant="outline" className="h-11" onClick={() => setDraft(clearLibraryFilters())}>Clear All</Button><Button className="h-11 min-w-0 flex-1" disabled={!validLibraryDates(draft)} onClick={apply}>Show {libraryCount(validLibraryDates(draft) ? countResults(draft) : 0, "Results")}</Button></div></div>
  </>;
  const trigger = <Button ref={filterRef} variant="ghost" className="nova-library-filter-end h-11 shrink-0 gap-1 rounded-none border-l px-3 hover:bg-muted" aria-label={`Filter${chips.length ? `: ${chips.length} Active` : ""}`} aria-expanded={open} onClick={phone ? () => changeOpen(true) : undefined}><SlidersHorizontal className="h-4 w-4" /><span className="nova-library-filter-label">Filter</span>{chips.length > 0 && <span className="rounded-full bg-foreground px-1.5 text-xs text-background">{chips.length}</span>}</Button>;
  const sortMenu = <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="h-11 min-w-11 shrink-0 gap-1 px-2" aria-label="Sort"><ArrowDownWideNarrow className="h-4 w-4" /><span className="hidden sm:inline">{sortOptions.find(o => o.v === sort)?.label}</span><ChevronDown className="hidden h-3 w-3 sm:block" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuRadioGroup value={sort} onValueChange={onSort}>{sortOptions.map(o => <DropdownMenuRadioItem key={o.v} value={o.v} className="min-h-11">{o.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>;
  return <>
    <div data-library-toolbar data-library-editing={editing} className="sticky top-0 z-30 min-w-0 bg-background pb-1">
      <div className="flex min-w-0 items-center gap-1.5"><div data-library-search-bar className="flex min-w-0 flex-1 items-center overflow-hidden rounded-full border bg-background focus-within:ring-1 focus-within:ring-ring"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label={`Search ${noun}`} placeholder={`Search ${noun.toLowerCase()}…`} value={search} onChange={e => onSearch(e.target.value)} className="h-11 min-w-0 rounded-none border-0 pl-9 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" /></div>
        {phone ? <><Dialog open={open} onOpenChange={changeOpen}><DialogContent aria-describedby={undefined} onCloseAutoFocus={e => { e.preventDefault(); filterRef.current?.focus(); }} className="nova-library-filter-sheet"><DialogTitle className="sr-only">Filters</DialogTitle>{panel}</DialogContent></Dialog>{trigger}</> : <Popover modal open={open} onOpenChange={changeOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger><PopoverContent align="end" aria-label="Filters" onCloseAutoFocus={e => { e.preventDefault(); filterRef.current?.focus(); }} className="flex max-h-[85vh] w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0">{panel}</PopoverContent></Popover>}
        </div>{!onViewChange && sortMenu}{!["images", "videos"].includes(scope) && <Button className="hidden h-11 shrink-0 sm:flex" onClick={onAdd}><Plus className="h-4 w-4" />Add {noun.replace(/s$/, "")}</Button>}
      </div>
      {chips.length > 0 && <div className="nova-filter-options mt-1" aria-label="Active Filters">{chips.map(c => <Button key={c.id} variant="outline" className={`h-11 min-w-0 max-w-full gap-1 rounded-full px-2 text-xs ${c.labelPath ? "nova-label-selected" : ""}`} style={c.labelPath ? { "--nova-label-bg": labelColor(c.labelPath).bg, "--nova-label-border": labelColor(c.labelPath).border, "--nova-label-text": labelColor(c.labelPath).text } as React.CSSProperties : undefined} title={c.label} aria-label={`${c.label} Remove`} onClick={() => onApply(c.clear(value))}>{c.labelPath && <span className="nova-filter-label-dot" style={{ "--nova-label-dot": labelColor(c.labelPath).swatch } as React.CSSProperties} />}<span className="truncate">{c.labelPath ? shortLabelName(labels.find(l => l.path === c.labelPath)?.name ?? c.label) : c.label}</span><X className="h-3 w-3 shrink-0" /><span className="sr-only">Remove</span></Button>)}<Button variant="link" className="h-10 shrink-0 px-1 text-xs" onClick={() => onApply(clearLibraryFilters())}>Clear All</Button></div>}
      <div className={`flex ${onViewChange ? "h-12" : "h-10"} min-w-0 items-center gap-1 text-xs text-muted-foreground`}>{navigation}{onViewChange && sortMenu}<span className="truncate">{libraryCount(count, noun.toLowerCase())}{!onViewChange && ` · ${sortOptions.find(o => o.v === sort)?.label}`}</span><div className="flex-1" />{onViewChange && view && <><LibraryViewToggle value={view} onChange={onViewChange} /></>}{action}<Button variant="ghost" className="h-11 shrink-0 px-2 text-xs hover:bg-muted" onClick={onEdit}><Pencil className="h-3 w-3" />{editing ? "Done" : ["objects", "images", "videos"].includes(scope) ? "Select" : "Edit"}</Button></div>
    </div>
    <Dialog open={managing} onOpenChange={setManaging}><DialogContent aria-describedby={undefined} className="nova-label-management max-h-[85dvh] overflow-y-auto"><DialogTitle>Manage Labels</DialogTitle>{editTools}</DialogContent></Dialog>
    {!editing && !["images", "videos"].includes(scope) && <Button onClick={onAdd} className="fixed bottom-20 right-4 z-40 h-12 rounded-full shadow-lg sm:hidden"><Plus className="h-4 w-4" />Add {noun.replace(/s$/, "")}</Button>}
  </>;
}