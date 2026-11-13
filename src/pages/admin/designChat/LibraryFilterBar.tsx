import LabelSearchList from "../LabelSearchList";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { leafOf, parentPath } from "../labelPath";
import { colorFor } from "../labelColors";
import type { LabelColorOf } from "./LibraryCard";
import type { LabelMatchMode } from "./objectPickerFilter";

export type SortKey = "name" | "name-desc" | "newest" | "oldest" | "label";

/** Bounded popular chips plus a searchable, folder-grouped complete label list. */
export default function LibraryFilterBar({ colorOf = (p) => colorFor(p), labels, labelCounts = {}, label, setLabel, multiLabels, onToggleLabel, labelMode = "any", setLabelMode, sort, setSort, showDates, shown, total, filtering, onClear }: {
  colorOf?: LabelColorOf; labels: string[]; labelCounts?: Record<string, number>; label: string; setLabel: (l: string) => void;
  multiLabels?: string[]; onToggleLabel?: (label: string) => void; labelMode?: LabelMatchMode; setLabelMode?: (mode: LabelMatchMode) => void;
  sort: SortKey; setSort: (s: SortKey) => void; showDates: boolean;
  shown: number; total: number; filtering: boolean; onClear: () => void;
}) {
  const [more, setMore] = useState(false);
  const chipRow = useRef<HTMLDivElement>(null);
  const [scrollChips, setScrollChips] = useState(false);
  const selected = multiLabels ?? (label ? [label] : []);
  const choose = (path: string) => multiLabels !== undefined ? onToggleLabel?.(path) : setLabel(path);
  const popular = useMemo(() => {
    const ranked = [...labels].sort((a, b) => (labelCounts[b] ?? 0) - (labelCounts[a] ?? 0) || a.localeCompare(b));
    if (multiLabels !== undefined) {
      const first = ranked.slice(0, 8);
      return [...first, ...multiLabels.filter(path => labels.includes(path) && !first.includes(path))];
    }
    const first = ranked.slice(0, 8);
    if (label && !first.includes(label)) return [...first.slice(0, 7), label];
    return first;
  }, [labels, labelCounts, label, multiLabels]);
  const groups = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const path of [...labels].sort((a, b) => a.localeCompare(b))) {
      const folder = parentPath(path);
      grouped.set(folder, [...(grouped.get(folder) ?? []), path]);
    }
    return [...grouped.entries()];
  }, [labels]);
  useLayoutEffect(() => {
    const row = chipRow.current;
    if (!row) return;
    const measure = () => {
      let lines = 1, used = 0;
      for (const child of Array.from(row.children)) {
        const width = child.getBoundingClientRect().width;
        if (used > 0 && used + 8 + width > row.clientWidth) { lines += 1; used = width; }
        else used += (used > 0 ? 8 : 0) + width;
      }
      setScrollChips(window.innerWidth < 640 && lines > 3);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(row);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [popular, labels.length]);
  return (
    <div className="min-w-0 space-y-2">
      {labels.length > 0 && (
        <div className="space-y-2" role="group" aria-label="Filter by Label">
          <span className="block text-xs font-medium text-muted-foreground">Labels</span>
          <div ref={chipRow} data-label-chips="" className={`flex min-w-0 gap-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible ${scrollChips ? "flex-nowrap overflow-x-auto" : "flex-wrap"}`}>
            <Button variant={selected.length === 0 ? "default" : "outline"} size="sm" className="h-11 shrink-0 rounded-full text-xs sm:h-8" aria-pressed={selected.length === 0} data-picker-own-enter="" onClick={() => choose("")}>All</Button>
            <Popover open={more} onOpenChange={setMore}>
              <PopoverTrigger asChild><Button variant="outline" size="sm" className="h-11 shrink-0 gap-1 rounded-full text-xs sm:h-8" data-picker-own-enter="">More Labels<ChevronDown className="h-3 w-3" aria-hidden /></Button></PopoverTrigger>
              <PopoverContent align="start" className="w-80 max-w-[85vw] p-0" data-picker-own-enter="">
                <div className="p-3"><LabelSearchList startExpanded labels={labels.map(path => ({ path, name: leafOf(path) }))} selected={selected} counts={labelCounts} colorOf={colorOf} onToggle={path => choose(multiLabels !== undefined ? path : selected.includes(path) ? "" : path)} onDone={() => setMore(false)} /></div>
              </PopoverContent>
            </Popover>
            {popular.map((path) => {
              const c = colorOf(path), on = selected.includes(path);
              return <Button key={path} variant="outline" size="sm" title={path} aria-label={leafOf(path)} aria-pressed={on} data-picker-own-enter="" onClick={() => choose(multiLabels !== undefined ? path : on ? "" : path)}
                className={`h-11 max-w-full shrink-0 justify-start gap-1 rounded-full px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 sm:h-8 ${(labelCounts[path] ?? 0) === 0 ? "opacity-[0.55]" : ""}`}
                style={on ? { background: c.swatch, borderColor: c.swatch, color: "hsl(var(--nova-cream))" } : { background: c.bg, borderColor: c.border, color: c.text }}>
                <span className="h-3 w-3 shrink-0" aria-hidden>{on && <Check className="h-3 w-3" />}</span><span className="truncate">{leafOf(path)}</span><span aria-hidden className="shrink-0">{labelCounts[path] ?? 0}</span>
              </Button>;
            })}
          </div>
          {selected.length > 0 && multiLabels === undefined && <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label="Clear Label" title="Clear Label" data-picker-own-enter="" onClick={() => choose("")}><X className="h-3.5 w-3.5" /></Button>}
          {multiLabels !== undefined && multiLabels.length >= 2 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show Objects With">
              <span className="text-xs text-muted-foreground">Show objects with:</span>
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {(["any", "all"] as const).map(mode => <Button key={mode} type="button" size="sm" variant={labelMode === mode ? "default" : "ghost"}
                  aria-pressed={labelMode === mode} data-picker-own-enter="" className={`h-11 rounded-none text-xs sm:h-9 ${mode === "all" ? "border-l border-border" : ""}`}
                  onClick={() => setLabelMode?.(mode)}>{mode === "any" ? "Any Label" : "All Labels"}</Button>)}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground" role="status">{shown} of {total} shown{multiLabels !== undefined && multiLabels.length >= 2 ? ` · matching ${labelMode} of ${multiLabels.length} labels` : ""}</span>
        {filtering && <Button variant="link" size="sm" data-picker-own-enter="" onClick={onClear} className="h-auto shrink-0 p-0 text-xs">Clear Filters</Button>}
        <label className="flex w-full items-center gap-1.5 text-xs text-muted-foreground sm:w-auto">
          Sort
          <select aria-label="Sort" className="rounded border bg-background px-1.5 py-1 text-xs text-foreground" value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)} data-picker-own-enter="">
            <option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option>
            {showDates && <option value="newest">Newest First</option>}{showDates && <option value="oldest">Oldest First</option>}
            <option value="label">Label</option>
          </select>
        </label>
      </div>
    </div>
  );
}
