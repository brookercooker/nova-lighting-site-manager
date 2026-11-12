import { ReactNode, useId, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type TimeRange = "all" | "hour" | "day" | "week" | "custom";

const RANGE_CHIPS: { v: TimeRange; label: string }[] = [
  { v: "all", label: "All" },
  { v: "hour", label: "Last Hour" },
  { v: "day", label: "Last 24h" },
  { v: "week", label: "Last 7 days" },
  { v: "custom", label: "Custom" },
];

/**
 * Unified filter toolbar shared by Static Pages, Landing Pages, and Images.
 * One wrapping row: Sort · date chips (+ Custom popover) · Status · Archived · right-aligned action.
 */
export default function FilterBar({
  sort, onSortChange, sortOptions,
  timeRange, onTimeRangeChange,
  dateFrom, dateTo, onDateFromChange, onDateToChange,
  dateFieldLabel = "Modified",
  status, onStatusChange, statusOptions,
  showArchived, onShowArchivedChange, archivedCount,
  extra,
  action,
}: {
  sort: string;
  onSortChange: (v: string) => void;
  sortOptions: { v: string; label: string }[];
  timeRange: TimeRange;
  onTimeRangeChange: (v: TimeRange) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  dateFieldLabel?: string;
  status?: string;
  onStatusChange?: (v: string) => void;
  statusOptions?: { v: string; label: string }[];
  showArchived?: boolean;
  onShowArchivedChange?: (v: boolean) => void;
  archivedCount?: number;
  extra?: ReactNode;
  action?: ReactNode;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const archivedId = useId();
  const hasCustom = !!(dateFrom || dateTo);
  const customLabel = hasCustom
    ? `${dateFrom || "…"} → ${dateTo || "…"}`
    : "Custom";

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="filterbar-sort">
          Sort By
        </label>
        <select
          id="filterbar-sort"
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="text-sm border rounded px-2 py-1 h-9"
        >
          {sortOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      </div>

      <div className="h-6 w-px bg-border mx-1" aria-hidden="true" />

      <div className="nova-library-filter-group flex flex-wrap items-center gap-1.5" role="group" aria-label={`${dateFieldLabel} range`}>
        <span className="text-xs font-medium text-muted-foreground">Show</span>

        {RANGE_CHIPS.map((c) => {
          const active =
            c.v === "custom" ? timeRange === "custom" : timeRange === c.v;
          const label = c.v === "custom" ? customLabel : c.label;
          if (c.v === "custom") {
            return (
              <Popover key={c.v} open={customOpen} onOpenChange={setCustomOpen}>
                <PopoverTrigger asChild>
                  <button
                    onClick={() => {
                      onTimeRangeChange("custom");
                      setCustomOpen(true);
                    }}
                    className={`inline-flex min-h-9 items-center whitespace-nowrap text-xs px-2 py-1 rounded-full border transition-colors sm:min-h-0 ${
                      active
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background hover:bg-muted border-border text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3 pointer-events-auto" align="start">
                  <div className="text-[11px] text-muted-foreground mb-2">
                    {dateFieldLabel} between
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => onDateFromChange(e.target.value)}
                      className="h-9 w-36"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => onDateToChange(e.target.value)}
                      className="h-9 w-36"
                    />
                  </div>
                  <div className="flex justify-end mt-3 gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onDateFromChange("");
                        onDateToChange("");
                        onTimeRangeChange("all");
                        setCustomOpen(false);
                      }}
                    >
                      Clear
                    </Button>
                    <Button size="sm" onClick={() => setCustomOpen(false)}>Done</Button>
                  </div>
                </PopoverContent>
              </Popover>
            );
          }
          return (
            <button
              key={c.v}
              onClick={() => {
                onDateFromChange("");
                onDateToChange("");
                onTimeRangeChange(c.v);
              }}
              className={`inline-flex min-h-9 items-center whitespace-nowrap text-xs px-2 py-1 rounded-full border transition-colors sm:min-h-0 ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background hover:bg-muted border-border text-muted-foreground"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {statusOptions && onStatusChange && (
        <>
          <div className="h-6 w-px bg-border mx-1" aria-hidden="true" />
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="filterbar-status">
              Status
            </label>
            <select
              id="filterbar-status"
              value={status ?? "all"}
              onChange={(e) => onStatusChange(e.target.value)}
              className="text-sm border rounded px-2 py-1 h-9"
            >
              {statusOptions.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
        </>
      )}

      {extra}


      {onShowArchivedChange && (
        <>
          <div className="h-6 w-px bg-border mx-1" aria-hidden="true" />
          <label htmlFor={archivedId} className="text-xs flex min-h-11 items-center gap-1.5 font-medium text-muted-foreground">
            <input
              id={archivedId}
              aria-label="Archived Only"
              type="checkbox"
              checked={!!showArchived}
              onChange={(e) => onShowArchivedChange(e.target.checked)}
            />
            Archived Only
            {archivedCount && archivedCount > 0 ? (
              <span className="text-muted-foreground">({archivedCount})</span>
            ) : null}
          </label>
        </>
      )}

      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
