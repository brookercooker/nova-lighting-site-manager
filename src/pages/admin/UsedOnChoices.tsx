import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

export default function UsedOnChoices({ options, selected, onSelect }: {
  options: { v: string; label: string }[]; selected: string; onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const special = options.filter(o => ["all", "none", "used"].includes(o.v));
  const matches = useMemo(() => query.trim() ? options.filter(o => !["all", "none", "used"].includes(o.v) && o.label.toLowerCase().includes(query.trim().toLowerCase())) : [], [options, query]);
  const selectedPage = options.find(o => o.v === selected && !["all", "none", "used"].includes(o.v));
  return <div className="min-w-0">
    <h3 className="mb-1 font-sans text-[10px] font-semibold uppercase text-muted-foreground">Used On</h3>
    <Input aria-label="Find a Page" placeholder="Find a page" value={query} className="mb-2 h-11 min-w-0" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); } }} />
    <div role="group" aria-label="Used On" className="flex min-w-0 flex-wrap gap-1.5">
      {special.map(o => <Button key={o.v} variant={selected === o.v ? "default" : "outline"} aria-pressed={selected === o.v} className="h-11 rounded-full px-3 text-xs" onClick={() => onSelect(o.v)}>{o.label}</Button>)}
      {selectedPage && <Button variant="outline" aria-label={`Remove ${selectedPage.label}`} className="h-11 min-w-0 max-w-full gap-1 rounded-full px-3 text-xs" onClick={() => onSelect("all")}><span className="truncate">{selectedPage.label}</span><X className="h-3 w-3 shrink-0" /></Button>}
    </div>
    <div role="group" aria-label="Matching Pages" className="mt-2 max-h-[30dvh] overflow-y-auto overscroll-contain" onWheel={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>{matches.map(o => <Button key={o.v} variant={selected === o.v ? "secondary" : "ghost"} aria-pressed={selected === o.v} title={o.label} className="h-11 w-full min-w-0 justify-start text-xs hover:bg-muted focus:bg-muted" onClick={() => onSelect(o.v)}><span className="truncate">{o.label}</span></Button>)}</div>
    {query.trim() && !matches.length && <p role="status" className="py-2 text-xs text-muted-foreground">No pages match '{query.trim()}'</p>}
  </div>;
}