import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";

export default function LibraryListRow({ name, date, thumbnail, badges, menu, onOpen, onTitle, selection, draggable, onDragStart }: {
  name: string; date: ReactNode; thumbnail: ReactNode; badges: ReactNode; menu: ReactNode; onOpen: () => void; onTitle?: () => void; selection?: ReactNode; draggable?: boolean; onDragStart?: React.DragEventHandler;
}) {
  return <div data-library-row draggable={draggable} onDragStart={onDragStart} className="nova-library-list-row">
    {selection && <div className="nova-library-row-selection">{selection}</div>}
    <Button variant="ghost" className="nova-library-row-thumb h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-muted p-0" onClick={onOpen} aria-label={`Open ${name}`}>{thumbnail}</Button>
    <div className="nova-library-row-title min-w-0"><Button variant="link" className="block h-auto max-w-full truncate p-0 text-left text-sm font-medium" onClick={onTitle ?? onOpen} title={name}>{name}</Button><div className="nova-library-row-date mt-1 truncate text-[11px] text-muted-foreground">{date}</div><div className="nova-library-row-badges mt-1 flex min-w-0 gap-1 overflow-hidden text-[10px]">{badges}</div></div>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="h-11 w-11 shrink-0 p-0" aria-label={`Actions: ${name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-h-[75vh] w-72 max-w-[calc(100vw-24px)] overflow-y-auto [&_[role=menuitem]]:min-h-11">{menu}</DropdownMenuContent></DropdownMenu>
  </div>;
}