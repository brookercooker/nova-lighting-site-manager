import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function UsedOnChoices({ options, selected, onSelect }: {
  options: { v: string; label: string }[]; selected: string; onSelect: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase())), [options, query]);
  const visible = expanded ? matches : options.slice(0, 6);
  const extraSelected = !expanded ? options.find(o => o.v === selected && !visible.some(v => v.v === selected)) : undefined;
  return <div className="min-w-0">
    <h3 className="mb-1 font-sans text-[10px] font-semibold uppercase text-muted-foreground">Used On</h3>
    {expanded && <Input aria-label="Find Pages" placeholder="Find pages…" value={query} className="mb-2 h-11" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); } }} />}
    <div role="group" aria-label="Used On" className="flex min-w-0 flex-wrap gap-1.5">
      {[...visible, ...(extraSelected ? [extraSelected] : [])].map(o => <Button key={o.v} variant={selected === o.v ? "default" : "outline"} aria-pressed={selected === o.v} title={o.label} className="h-11 min-w-0 max-w-full rounded-full px-3 text-xs" onClick={() => onSelect(o.v)}><span className="truncate">{o.label}</span></Button>)}
      {!expanded && options.length > 6 && <Button variant="outline" className="h-11 rounded-full px-3 text-xs" onClick={() => setExpanded(true)}>+ More</Button>}
    </div>
    {expanded && !matches.length && <p role="status" className="py-2 text-xs text-muted-foreground">No pages match '{query.trim()}'</p>}
    {expanded && <Button variant="link" className="h-11 px-0 text-xs" onClick={() => { setExpanded(false); setQuery(""); }}>Show Fewer</Button>}
  </div>;
}