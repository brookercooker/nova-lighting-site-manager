import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import type { AssetUsage } from "./assetUsages";

/**
 * Compact "Used on N pages" chip that opens a popover listing every page/
 * landing/object that uses the asset. Links navigate in the SAME window
 * (react-router <Link>) so the user stays in the Lovable preview.
 *
 * Mirrors the ObjectsTab UsedOnChip. When usages is empty, renders a
 * muted "Not used" pill (no popover).
 */
export default function UsedOnChip({
  usages,
  label,
}: {
  usages: AssetUsage[];
  label?: (count: number) => string;
}) {
  const count = usages.length;
  const text = (label ?? defaultLabel)(count);
  const tone = count === 0
    ? "bg-muted text-muted-foreground border-border"
    : "bg-brass/10 text-foreground border-brass/40 hover:bg-brass/20";

  if (count === 0) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${tone}`}
        title="Not used on any page"
      >
        {text}
      </span>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex min-h-9 sm:min-h-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-colors cursor-pointer ${tone}`}
          title="Show pages that use this asset"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2 border-b text-[11px] uppercase tracking-wider text-muted-foreground">
          Used On {count} page{count === 1 ? "" : "s"}
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {usages.map((u) => (
            <li key={`${u.type}:${u.path}`}>
              <Link
                to={u.path}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-primary/10 hover:text-primary transition-colors group"
              >
                <Badge variant="outline" className="text-[10px] uppercase shrink-0">
                  {u.type}
                </Badge>
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="truncate group-hover:underline">{u.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground truncate group-hover:text-primary/70">
                    {u.path}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline "Used On" section for detail dialogs — shows a fixed-height,
 * scrollable list of pages that reference the asset. Mirrors the same
 * visual treatment as the Object edit dialog.
 */
export function UsedOnList({ usages }: { usages: AssetUsage[] }) {
  const count = usages.length;
  return (
    <div>
      <div className="text-xs mb-1 flex items-center justify-between">
        <span>Used On</span>
        <span className="text-muted-foreground">
          {count === 0 ? "Not used on any page" : `${count} page${count === 1 ? "" : "s"}`}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground italic rounded border bg-muted/20 px-3 py-3">
          Not referenced on any page yet.
        </p>
      ) : (
        <ul className="text-sm rounded border bg-muted/20 divide-y max-h-40 overflow-y-auto">
          {usages.map((u) => (
            <li key={`${u.type}:${u.path}`}>
              <Link
                to={u.path}
                className="flex items-center gap-2 px-3 py-2 hover:bg-primary/10 hover:text-primary group"
              >
                <Badge variant="outline" className="text-[10px] uppercase shrink-0">
                  {u.type}
                </Badge>
                <span className="truncate group-hover:underline">{u.name}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate group-hover:text-primary/70">
                  {u.path}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function defaultLabel(count: number) {
  if (count === 0) return "Not used";
  if (count === 1) return "On 1 page";
  return `On ${count} pages`;
}
