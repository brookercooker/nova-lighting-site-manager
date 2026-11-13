import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { colorFor, type LabelColor } from "./labelColors";
import { labelMatchParts, matchingLabels, type SearchLabel } from "./labelSearch";

const LabelName = memo(function LabelName({ name, query }: { name: string; query: string }) {
  return <>{labelMatchParts(name, query).map((part, i) => part.match ? <mark key={i} className="rounded-sm bg-accent text-accent-foreground">{part.text}</mark> : <span key={i}>{part.text}</span>)}</>;
});
export default memo(function LabelSearchList({ labels, selected, counts = {}, onToggle, onDone, onCreate, onQueryChange, colorOf, startExpanded = false }: {
  labels: SearchLabel[]; selected: string[]; counts?: Record<string, number>; onToggle: (path: string) => void; onDone?: () => void; onCreate?: (query: string) => void; onQueryChange?: (query: string) => void; colorOf?: (path: string) => LabelColor; startExpanded?: boolean;
}) {
  const [query, setQuery] = useState(""), [expanded, setExpanded] = useState(startExpanded);
  const root = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => matchingLabels(labels, query, selected, counts), [labels, query, selected, counts]);
  const selectedRows = useMemo(() => selected.map(path => labels.find(l => l.path === path) ?? { path, name: path.split("/").pop() ?? path }), [labels, selected]);
  const popular = useMemo(() => matches.filter(l => !selected.includes(l.path)).slice(0, 6), [matches, selected]);
  const full = !!query.trim() || expanded;
  const setSearch = (next: string) => { setQuery(next); onQueryChange?.(next); };
  useEffect(() => {
    if (!query) return;
    const clearFirst = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Node) || !root.current?.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation(); setQuery(""); onQueryChange?.(""); root.current.querySelector<HTMLInputElement>("input")?.focus();
    };
    window.addEventListener("keydown", clearFirst, true);
    return () => window.removeEventListener("keydown", clearFirst, true);
  }, [query, onQueryChange]);
  const keyboard = (e: KeyboardEvent) => {
    if (e.key === "Escape") { if (query) { e.preventDefault(); e.stopPropagation(); setSearch(""); root.current?.querySelector<HTMLInputElement>("input")?.focus(); } return; }
    if (e.key === "Enter" && e.target instanceof HTMLButtonElement && e.target.hasAttribute("data-label-result")) { e.preventDefault(); e.stopPropagation(); e.target.click(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault(); e.stopPropagation();
    const rows = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-label-result]") ?? []);
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(index + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
  };
  const chip = (l: SearchLabel, chosen: boolean) => { const c = colorOf?.(l.path) ?? colorFor(l.path, l.color_index); return <Button key={l.path} variant="outline" aria-label={chosen ? `Remove ${l.path}` : l.name} aria-pressed={chosen} title={l.path} className="nova-label-search-chip h-11 max-w-full gap-1 rounded-full px-2 text-xs" onClick={() => onToggle(l.path)} style={{ "--nova-label-bg": c.bg, "--nova-label-border": c.border, "--nova-label-text": c.text, "--nova-label-dot": c.swatch } as React.CSSProperties}><span className="nova-filter-label-dot" /><span className="truncate">{l.name}</span><span className="text-muted-foreground">{counts[l.path] ?? 0}</span>{chosen && <X className="h-3 w-3 shrink-0" />}</Button>; };
  return <div ref={root} className="min-w-0 space-y-2" data-picker-own-enter="" onKeyDownCapture={keyboard}>
    <Input aria-label="Search Labels" placeholder="Search labels…" value={query} onChange={e => setSearch(e.target.value)} className="h-11" />
    {!full ? <div role="group" aria-label="Labels" className="flex min-w-0 flex-wrap gap-1.5">{selectedRows.map(l => chip(l, true))}{popular.map(l => chip(l, false))}{matches.filter(l => !selected.includes(l.path)).length > 6 && <Button variant="outline" className="h-11 rounded-full px-3 text-xs" onClick={() => setExpanded(true)}>+ More</Button>}</div> : <>
      <div role="group" aria-label="Label Results" className="max-h-[40dvh] overflow-y-auto overscroll-contain touch-pan-y" onWheel={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
        {matches.map(l => { const chosen = selected.includes(l.path), c = colorOf?.(l.path) ?? colorFor(l.path, l.color_index); return <Button key={l.path} type="button" variant="ghost" role="checkbox" aria-checked={chosen} aria-label={l.path} data-label-result="" className="h-11 w-full min-w-0 justify-start gap-2 p-0 text-left text-xs" onClick={() => onToggle(l.path)} style={{ "--nova-label-dot": c.swatch } as React.CSSProperties}><span className="flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden><span className="flex h-4 w-4 items-center justify-center rounded-sm border border-input">{chosen && <Check className="h-3 w-3" />}</span></span><span className="nova-filter-label-dot" /><span className="min-w-0 flex-1 truncate" title={l.path}><LabelName name={l.name} query={query} /></span><span className="pr-2 text-muted-foreground">{counts[l.path] ?? 0}</span></Button>; })}
        {!matches.length && <p role="status" className="py-3 text-xs text-muted-foreground">{query.trim() ? `No labels match '${query.trim()}'` : "No labels"}</p>}
      </div>
      {expanded && !query && <Button variant="link" className="h-11 px-0 text-xs" onClick={() => setExpanded(false)}>Show Fewer</Button>}
    </>}
    {query.trim() && !matches.length && onCreate && <Button variant="link" className="h-11 max-w-full px-0 text-xs" onClick={() => onCreate(query.trim())}>Create '{query.trim()}'</Button>}
    {onDone && <Button variant="outline" className="h-11" onClick={onDone}>Done</Button>}
  </div>;
});