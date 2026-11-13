import type { ReactNode } from "react";
import { FileText, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import LibraryCardLabels from "./LibraryCardLabels";
import type { LabelScope } from "./useAllLabels";
import type { LibraryView } from "./libraryView";

export default function LibraryListRow({ name, date, thumbnail, badges, menu, onOpen, onTitle, selection, draggable, onDragStart, labelScope, labels = [], onLabelFilter, view = "list" }: {
  view?: LibraryView;
  name: string; date: ReactNode; thumbnail: ReactNode; badges: ReactNode; menu: ReactNode; onOpen: () => void; onTitle?: () => void; selection?: ReactNode; draggable?: boolean; onDragStart?: React.DragEventHandler;
  labelScope?: LabelScope; labels?: string[]; onLabelFilter?: (path: string) => void;
}) {
  const grid = view === "grid";
  return <div data-library-row data-library-view={view} data-library-scope={labelScope} data-row-editing={!!selection} draggable={draggable} onDragStart={onDragStart} className={grid ? "nova-library-grid-card" : "nova-library-list-row"} onClick={grid ? e => { if (!(e.target instanceof Element) || !e.target.closest('button,input,[role="checkbox"],[role="menuitem"]')) onOpen(); } : undefined}>
    {selection && <div className="nova-library-row-selection">{selection}</div>}
    <Button variant="ghost" className={grid ? "nova-library-grid-thumb overflow-hidden rounded-lg bg-muted p-0" : "nova-library-row-thumb h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted p-0"} onClick={onOpen} aria-label={`Open ${name}`}>{grid && (labelScope === "static" || labelScope === "landing") ? <FileText className="h-8 w-8 text-muted-foreground" /> : thumbnail}</Button>
    <div className="nova-library-row-body min-w-0 flex-1"><div className="nova-library-row-title min-w-0"><Button variant="link" className={grid ? "nova-library-grid-name block max-w-full p-0 text-left text-sm font-medium" : "block h-auto max-w-full truncate p-0 text-left text-sm font-medium"} onClick={grid ? onOpen : onTitle ?? onOpen} title={name} aria-label={name}>{name}</Button><div className="nova-library-row-date mt-1 truncate text-[11px] text-muted-foreground">{date}</div><div className={grid ? "nova-library-grid-chips" : undefined}><div className="nova-library-row-badges mt-1 flex min-w-0 gap-1 overflow-hidden text-[10px]">{badges}</div>{grid && labelScope && onLabelFilter && <LibraryCardLabels scope={labelScope} paths={labels} onFilter={onLabelFilter} />}</div></div>{!grid && labelScope && onLabelFilter && <LibraryCardLabels scope={labelScope} paths={labels} onFilter={onLabelFilter} />}</div>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className={grid ? "nova-library-grid-options h-11 w-11 shrink-0 p-0" : "h-11 w-11 shrink-0 p-0"} aria-label={`Options for ${name}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-h-[75vh] w-72 max-w-[calc(100vw-24px)] overflow-y-auto [&_[role=menuitem]]:min-h-11">{menu}{labelScope && <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent("nova:manage-library-labels", { detail: labelScope }))}>Manage Labels</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
  </div>;
}