import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { labelCount } from "./labelSearch";
import LabelPicker from "./LabelPicker";
import { type LabelScope } from "./useAllLabels";

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
  const count = value.length;

  return (
    <>
      <Button type="button" variant="ghost" className="h-11 w-full min-w-0 justify-between gap-2 px-2 text-xs" aria-label={`Edit Labels${itemName ? ` for ${itemName}` : ""}`} onClick={() => setOpen(true)}>
        <span>Edit Labels</span><span className="flex min-w-0 items-center gap-1"><span className="truncate">{labelCount(count)}</span><ChevronRight className="h-4 w-4 shrink-0" /></span>
      </Button>

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
              triggerLabel="Add Label"
              inline
              onDone={() => setOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
