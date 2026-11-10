import { useMemo, useState } from "react";
import { Tag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import LabelPicker from "./LabelPicker";
import { useLabelsForScope, type LabelScope } from "./useAllLabels";
import { colorFor } from "./labelColors";

interface Props {
  scope: LabelScope;
  value: string[];
  onChange: (next: string[]) => void;
  itemName?: string;
}

/**
 * Compact per-tool labels indicator (see the "Used On" chip pattern).
 * Labels are scoped to the current tool; label colors and choices come
 * only from `scope`.
 */
export default function LabelsCell({ scope, value, onChange, itemName }: Props) {
  const [open, setOpen] = useState(false);
  const { data: allLabels = [] } = useLabelsForScope(scope);
  const count = value.length;
  const hasAny = count > 0;

  const tint = useMemo(() => {
    if (!hasAny) return null;
    const map = new Map(allLabels.map((l) => [l.path, l.color_index]));
    return colorFor(value[0], map.get(value[0]) ?? null);
  }, [hasAny, value, allLabels]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={hasAny ? `${count} label${count === 1 ? "" : "s"} — click to edit` : "No labels — click to add"}
        aria-label={hasAny ? `${count} labels, edit` : "Add Labels"}
        className={`inline-flex min-h-9 sm:min-h-0 items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium transition-colors ${
          hasAny ? "" : "border-dashed border-muted-foreground/30 text-muted-foreground hover:bg-muted"
        }`}
        style={hasAny && tint ? { background: tint.bg, borderColor: tint.border, color: tint.text } : undefined}
      >
        <Tag
          className="w-3.5 h-3.5"
          style={hasAny && tint ? { color: tint.iconStroke, fill: tint.iconFill } : undefined}
        />
        <span className="tabular-nums">{hasAny ? count : "0"}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Labels{itemName ? ` — ${itemName}` : ""}</DialogTitle>
            <DialogDescription>
              Add or remove labels for this item. Labels here only apply to this tool.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <LabelPicker
              scope={scope}
              value={value}
              onChange={onChange}
              triggerLabel="Add label"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
