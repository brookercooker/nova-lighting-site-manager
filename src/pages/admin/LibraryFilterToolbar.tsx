import { useRef, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, ArrowDownWideNarrow, ChevronDown, Check, X, Plus, Pencil } from "lucide-react";
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
import { cn } from "@/lib/utils";

type Option = { v: string; label: string };
export default function LibraryFilterToolbar({ scope, noun, search, onSearch, value, onApply, fields, sort, onSort, sortOptions, count, countResults, extraLabel, extraOptions = [], onAdd, onEdit, editing, editTools, action, navigation }: {
  scope: LabelScope; noun: string; search: string; onSearch: (v: string) => void; value: LibraryFilters; onApply: (v: LibraryFilters) => void;
  fields: Option[]; sort: string; onSort: (v: string) => void; sortOptions: Option[]; count: number; countResults: (v: LibraryFilters) => number;
  extraLabel?: string; extraOptions?: Option[]; onAdd: () => void; onEdit: () => void; editing: boolean; editTools?: ReactNode; action?: ReactNode; navigation?: ReactNode;
}) {
  const { phone } = useManagerLayout();
  const { data: labels = [] } = useLabelsForScope(scope);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [more, setMore] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  const filterRef = useRef<HTMLButtonElement>(null);
  const chips = activeLibraryFilters(value, fields, extraOptions);
  const changeOpen = (next: boolean) => { if (next) { setDraft({ ...value, labels: [...value.labels] }); setMore(false); setLabelSearch(""); } setOpen(next); };
  const apply = () => { if (!validLibraryDates(draft)) return; onApply(draft); setOpen(false); };
  const patch = (next: Partial<LibraryFilters>) => setDraft(d => ({ ...d, ...next }));
  const labelColor = (path: string) => colorFor(path, labels.find(l => l.path === path)?.color_index);
  const choices = (title: string, options: Option[], selected: string, onSelect: (v: string) => void) => <div>
    <h3 className="mb-1 font-sans text-[10px] font-semibold uppercase text-muted-foreground">{title}</h3>
    <div role="group" aria-label={title} className="nova-filter-options">{options.map(o => <Button key={o.v} type="button" variant={selected === o.v ? "default" : "outline"} aria-pressed={selected === o.v} className="h-11 shrink-0 rounded-full px-3 text-xs" onClick={() => onSelect(o.v)}>{o.label}</Button>)}</div>
  </div>;
  const panel = <>
    <div className="flex h-14 shrink-0 items-center justify-between border-b px-4"><h2 className="font-sans text-base font-semibold">Filters</h2><Button variant="ghost" className="h-11 w-11 p-0" aria-label="Close Filters" onClick={() => changeOpen(false)}><X className="h-4 w-4" /></Button></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
      {choices("Modified", [{ v: "all", label: "All" }, { v: "hour", label: "1h" }, { v: "day", label: "24h" }, { v: "week", label: "7 Days" }, { v: "custom", label: "Custom" }], draft.timeRange, v => patch({ timeRange: v, ...(v !== "custom" ? { dateFrom: "", dateTo: "" } : {}) }))}
      {draft.timeRange === "custom" && <div><div className="grid grid-cols-2 gap-2">{(["dateFrom", "dateTo"] as const).map((key, i) => <label key={key} className="min-w-0 text-xs">{i ? "To" : "From"}<Input type="date" aria-label={i ? "To" : "From"} value={draft[key]} onChange={e => patch({ [key]: e.target.value })} className="mt-1 h-11 w-full min-w-0 text-xs" /></label>)}</div><Button variant="link" className="h-10 px-0 text-xs" onClick={() => patch({ dateFrom: "", dateTo: "" })}>Clear Dates</Button>{!validLibraryDates(draft) && <p role="alert" className="text-xs text-destructive">From must be on or before To.</p>}</div>}
      <div><h3 className="mb-1 font-sans text-[10px] font-semibold uppercase text-muted-foreground">Labels</h3>
        {more && <Input aria-label="Find Labels" placeholder="Find labels…" value={labelSearch} onChange={e => setLabelSearch(e.target.value)} className="mb-2 h-11" />}
        <div role="group" aria-label="Labels" className={more ? "flex flex-wrap gap-1.5" : "nova-filter-options"}>
          {(more ? labels.filter(l => l.path.toLowerCase().includes(labelSearch.toLowerCase())) : labels.slice(0, 6)).map(l => {
            const c = labelColor(l.path), selected = draft.labels.includes(l.path);
            return <Button key={l.path} variant="outline" className={cn("h-11 shrink-0 rounded-full border-2 px-3 text-xs", selected && "nova-filter-label-selected")} style={{ "--nova-label-bg": c.bg, "--nova-label-border": c.border, "--nova-label-text": c.text, "--nova-label-dot": c.swatch } as React.CSSProperties} title={l.path} aria-pressed={selected} onClick={() => patch({ labels: selected ? draft.labels.filter(p => p !== l.path) : [...draft.labels, l.path] })}><span className="nova-filter-label-dot" />{l.name}{selected && <Check className="h-3 w-3" />}</Button>;
          })}
          <Button variant="outline" className="h-11 shrink-0 rounded-full px-3 text-xs" onClick={() => setMore(v => !v)}>{more ? "Show Fewer" : "+ More"}</Button>
        </div>
      </div>
      {extraLabel && choices(extraLabel, extraOptions, draft.extra, v => patch({ extra: v }))}
      {choices("Search in", fields, draft.searchField, v => patch({ searchField: v, ...(v === "date_taken" ? { timeRange: "custom" } : {}) }))}
      <label className="flex min-h-11 items-center justify-between gap-3 text-xs font-medium">Show Archived Only<Switch checked={draft.archived} onCheckedChange={v => patch({ archived: v })} aria-label="Show Archived Only" /></label>
    </div>
    <div className="flex shrink-0 gap-2 border-t bg-background p-3"><Button variant="outline" className="h-11" onClick={() => setDraft(clearLibraryFilters())}>Clear All</Button><Button className="h-11 min-w-0 flex-1" disabled={!validLibraryDates(draft)} onClick={apply}>Show {validLibraryDates(draft) ? countResults(draft) : 0} Results</Button></div>
  </>;
  const trigger = <Button ref={filterRef} variant={chips.length ? "default" : "outline"} className="h-11 shrink-0 gap-1 px-3" aria-label={`Filter${chips.length ? `: ${chips.length} Active` : ""}`} aria-expanded={open} onClick={phone ? () => changeOpen(true) : undefined}><SlidersHorizontal className="h-4 w-4" /><span>Filter</span>{chips.length > 0 && <span className="rounded-full bg-background px-1.5 text-xs text-foreground">{chips.length}</span>}</Button>;
  const sortMenu = <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="h-11 min-w-11 shrink-0 gap-1 px-2" aria-label="Sort"><ArrowDownWideNarrow className="h-4 w-4" /><span className="hidden sm:inline">{sortOptions.find(o => o.v === sort)?.label}</span><ChevronDown className="hidden h-3 w-3 sm:block" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuRadioGroup value={sort} onValueChange={onSort}>{sortOptions.map(o => <DropdownMenuRadioItem key={o.v} value={o.v} className="min-h-11">{o.label}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>;
  return <>
    <div data-library-toolbar className="sticky top-0 z-30 min-w-0 bg-background pb-1">
      <div className="flex min-w-0 items-center gap-1.5"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input aria-label={`Search ${noun}`} placeholder={`Search ${noun.toLowerCase()}…`} value={search} onChange={e => onSearch(e.target.value)} className="h-11 min-w-0 rounded-full pl-9 text-sm" /></div>
        {phone ? <><Dialog open={open} onOpenChange={changeOpen}><DialogContent aria-describedby={undefined} onCloseAutoFocus={e => { e.preventDefault(); filterRef.current?.focus(); }} className="nova-library-filter-sheet"><DialogTitle className="sr-only">Filters</DialogTitle>{panel}</DialogContent></Dialog>{trigger}</> : <Popover modal open={open} onOpenChange={changeOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger><PopoverContent align="end" aria-label="Filters" onCloseAutoFocus={e => { e.preventDefault(); filterRef.current?.focus(); }} className="flex max-h-[85vh] w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0">{panel}</PopoverContent></Popover>}
        {sortMenu}<Button className="hidden h-11 shrink-0 sm:flex" onClick={onAdd}><Plus className="h-4 w-4" />Add {noun.replace(/s$/, "")}</Button>
      </div>
      {chips.length > 0 && <div className="nova-filter-options mt-1" aria-label="Active Filters">{chips.map(c => <Button key={c.id} variant="outline" className="h-10 shrink-0 gap-1 rounded-full px-2 text-xs" onClick={() => onApply(c.clear(value))}>{c.labelPath && <span className="nova-filter-label-dot" style={{ "--nova-label-dot": labelColor(c.labelPath).swatch } as React.CSSProperties} />}{c.label}<X className="h-3 w-3" /><span className="sr-only">Remove</span></Button>)}<Button variant="link" className="h-10 shrink-0 px-1 text-xs" onClick={() => onApply(clearLibraryFilters())}>Clear All</Button></div>}
      <div className="flex h-10 min-w-0 items-center gap-1 text-xs text-muted-foreground">{navigation}<span className="truncate">{count} {noun.toLowerCase()} · {sortOptions.find(o => o.v === sort)?.label}</span><ChevronDown className="h-3 w-3 shrink-0" /><div className="flex-1" />{action}<Button variant="ghost" className="h-10 shrink-0 px-2 text-xs" onClick={onEdit}><Pencil className="h-3 w-3" />{editing ? "Done" : "Edit"}</Button></div>
    </div>
    {editing && editTools && <details className="border-b pb-2"><summary className="min-h-11 cursor-pointer text-sm">Labels and Selection</summary>{editTools}</details>}
    <Button onClick={onAdd} className="fixed bottom-20 right-4 z-40 h-12 rounded-full shadow-lg sm:hidden"><Plus className="h-4 w-4" />Add {noun.replace(/s$/, "")}</Button>
  </>;
}