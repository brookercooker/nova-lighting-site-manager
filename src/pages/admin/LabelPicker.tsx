import { useMemo, useState } from "react";
import LabelSearchList from "./LabelSearchList";
import { useLabelUsageCounts } from "./useLabelUsageCounts";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { X, Tag, Check } from "lucide-react";
import {
  useLabelsForScope,
  registerLabelPath,
  setLabelColorById,
  useInvalidateLabels,
  type LabelScope,
  type LabelRow,
} from "./useAllLabels";
import { colorFor, pickLeastUsedColor } from "./labelColors";
import ColorSwatchPicker from "./ColorSwatchPicker";
import { LABEL_SEP, MAX_DEPTH, validateLeafName, joinPath } from "./labelPath";

interface Props {
  scope: LabelScope;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  triggerLabel?: string;
  className?: string;
  compact?: boolean;
  inline?: boolean;
  onDone?: () => void;
}

/**
 * Label picker scoped to a single tool. Supports nested label paths — the
 * search box accepts a plain leaf name (creates under the picked parent)
 * or a "parent/child" path (creates the whole chain if needed).
 */
export default function LabelPicker({
  scope, value, onChange,
  placeholder = "Search labels…",
  triggerLabel = "Add label", className = "", compact = false, inline = false, onDone,
}: Props) {
  const { data: allLabels = [] } = useLabelsForScope(scope);
  const invalidate = useInvalidateLabels(scope);
  const { data: usageCounts = {} } = useLabelUsageCounts(scope);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pendingColor, setPendingColor] = useState<number | null>(null);
  const [pendingParentId, setPendingParentId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const byPath = useMemo(() => {
    const m = new Map<string, LabelRow>();
    for (const l of allLabels) m.set(l.path, l);
    return m;
  }, [allLabels]);

  const add = (path: string) => {
    if (!path || value.includes(path)) { setQ(""); return; }
    onChange([...value, path]);
    setQ("");
  };

  const toggle = (path: string) => {
    if (value.includes(path)) onChange(value.filter((x) => x !== path));
    else onChange([...value, path]);
  };

  const createNew = async (requested?: string) => {
    const term = (requested ?? q).trim().toLowerCase();
    setCreateError(null);
    if (!term) return;
    const parent = pendingParentId ? allLabels.find((r) => r.id === pendingParentId) ?? null : null;
    // Determine full path
    let newPath: string;
    if (term.includes(LABEL_SEP)) {
      // User typed a full path — ignore parent selection.
      const segs = term.split(LABEL_SEP).map((s) => s.trim()).filter(Boolean);
      for (const s of segs) {
        const err = validateLeafName(s);
        if (err) { setCreateError(err); return; }
      }
      if (segs.length > MAX_DEPTH) { setCreateError(`Max nesting depth is ${MAX_DEPTH}.`); return; }
      newPath = joinPath(segs);
    } else {
      const err = validateLeafName(term);
      if (err) { setCreateError(err); return; }
      newPath = parent ? parent.path + LABEL_SEP + term : term;
      if (parent && parent.depth + 1 > MAX_DEPTH - 1) {
        setCreateError(`Max nesting depth is ${MAX_DEPTH}.`); return;
      }
    }
    const color = pendingColor ?? pickLeastUsedColor(allLabels.map((l) => l.color_index));
    try {
      await registerLabelPath(newPath, scope, color);
    } catch (e: any) {
      setCreateError(e?.message ?? "Could not create label.");
      return;
    }
    invalidate();
    add(newPath);
    setPendingColor(null);
    setPendingParentId(null);
  };

  const changeColor = async (row: LabelRow, idx: number) => {
    await setLabelColorById(row.id, idx);
    invalidate();
  };

  const creationOptions = q.trim() && !allLabels.some(l => l.name.toLowerCase().includes(q.trim().toLowerCase())) ? <div className="mt-2 space-y-2"><label className="block text-xs">Nest Label Under<select aria-label="Nest Label Under" className="mt-1 h-11 w-full rounded border bg-background px-2" value={pendingParentId ?? ""} onChange={e => setPendingParentId(e.target.value || null)}><option value="">Top Level</option>{allLabels.filter(l => l.depth < MAX_DEPTH - 1).map(l => <option key={l.id} value={l.id}>{l.path}</option>)}</select></label><ColorSwatchPicker value={pendingColor ?? pickLeastUsedColor(allLabels.map(l => l.color_index))} onChange={setPendingColor} /></div> : null;

  if (inline) return <><LabelSearchList labels={allLabels} selected={value} counts={usageCounts} onToggle={toggle} onQueryChange={setQ} onCreate={query => void createNew(query)} />{creationOptions}{createError && <p role="alert" className="text-xs text-destructive">{createError}</p>}<Button className="mt-3 h-11" onClick={onDone}>Done</Button></>;

  return (
    <div className={`min-w-0 max-w-full ${className}`}>
      <div className="flex flex-wrap gap-1 mb-1 min-w-0 max-w-full">
        {value.map((path) => {
          const row = byPath.get(path);
          const c = colorFor(path, row?.color_index ?? null);
          const label = row ? row.path.split(LABEL_SEP).join(" › ") : path;
          return (
            <Popover key={path}>
              <span
                className="nova-label-selected text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 border min-w-0 max-w-full"
              >
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center gap-1 min-w-0 focus:outline-none" title={`Change color — ${c.name}`}>
                    <Tag className="w-3.5 h-3.5" style={{ color: c.iconStroke, fill: c.iconFill }} />
                    <span className="truncate">{label}</span>
                    <Check className="w-3 h-3 shrink-0" aria-hidden />
                  </button>
                </PopoverTrigger>
                <button type="button" onClick={() => onChange(value.filter((x) => x !== path))}
                  className="hover:text-destructive shrink-0" aria-label={`Remove ${label}`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
              <PopoverContent align="start" className="w-auto p-2" collisionPadding={16}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Color for &ldquo;{label}&rdquo;</div>
                {row && (
                  <ColorSwatchPicker
                    value={(row.color_index ?? c.idx) as number}
                    onChange={(idx) => changeColor(row, idx)}
                  />
                )}
              </PopoverContent>
            </Popover>
          );
        })}
        {value.length === 0 && !compact && (
          <span className="text-xs text-muted-foreground">No labels applied</span>
        )}
      </div>

      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setPendingColor(null); setPendingParentId(null); setCreateError(null); } }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={value.length > 0 ? "secondary" : "outline"}
            size="sm"
            className={compact ? "h-8 min-w-8 px-1.5 gap-1" : "gap-1.5"}
            title={triggerLabel}
            aria-label={triggerLabel}
          >
            <Tag className="w-3.5 h-3.5" />
            {!compact && triggerLabel}
            {value.length > 0 && (
              <span className="text-[10px] font-medium rounded-full bg-primary text-primary-foreground px-1.5 leading-4">
                {value.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,340px)] p-0" align="start" collisionPadding={16}>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
            <div className="text-xs font-medium">
              Labels
              <span className="text-muted-foreground font-normal">
                {value.length > 0 ? ` · ${value.length} selected` : ""}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {value.length > 0 && (
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                  onClick={() => onChange([])}>
                  Clear
                </Button>
              )}
              <Button type="button" size="sm" className="h-7 px-2.5 text-xs gap-1"
                onClick={() => setOpen(false)} aria-label="Done — close label picker">
                <Check className="w-3.5 h-3.5" /> Done
              </Button>
            </div>
          </div>
          <div className="p-3"><LabelSearchList labels={allLabels} selected={value} counts={usageCounts} onToggle={toggle} onQueryChange={setQ} onCreate={query => void createNew(query)} />{creationOptions}{createError && <p role="alert" className="text-xs text-destructive">{createError}</p>}</div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
