import { ReactNode } from "react";
import { X, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  count: number;
  itemLabel?: string; // e.g. "page", "image", "link"
  onClear: () => void;
  children?: ReactNode; // action buttons
  hint?: ReactNode;
  editing?: boolean;
};

/**
 * Consistent selection action bar used across Site Manager tabs
 * (Pages, Images, Link Audit, etc.). Renders inline; sticks to the
 * top of its scroll container so actions remain reachable.
 */
export default function SelectionBar({ count, itemLabel = "item", onClear, children, hint, editing = false }: Props) {
  if (count <= 0 && !editing) return null;
  const plural = count === 1 ? itemLabel : `${itemLabel}s`;
  return (
    <div role="region" aria-label="Selection Actions" data-phone-selection={editing} className="nova-selection-bar sticky top-0 z-20 flex items-center gap-2 rounded-lg border border-primary/30 bg-background backdrop-blur px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2 pr-3 border-r border-primary/20">
        <CheckSquare className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium tabular-nums">
          <span className="sm:hidden">{count} selected</span><span className="hidden sm:inline">{count} <span className="text-muted-foreground font-normal">{plural} selected</span></span>
        </span>
      </div>
      {hint && <span className="text-xs text-muted-foreground hidden md:inline">{hint}</span>}
      <fieldset disabled={count === 0} className="flex min-w-0 items-center gap-1.5 flex-wrap">{children}</fieldset>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        className="ml-auto h-8 text-muted-foreground hover:text-foreground"
      >
        <X className="w-3.5 h-3.5 mr-1" /> Clear
      </Button>
    </div>
  );
}
