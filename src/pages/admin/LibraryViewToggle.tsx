import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryView } from "./libraryView";

export default function LibraryViewToggle({ value, onChange }: { value: LibraryView; onChange: (value: LibraryView) => void }) {
  return <div role="group" aria-label="Library View" className="flex shrink-0 overflow-hidden rounded-md border">
    {([['list', List], ['grid', LayoutGrid]] as const).map(([view, Icon]) => <Button key={view} variant={value === view ? "default" : "ghost"} className="h-11 gap-1.5 rounded-none px-3 text-xs" aria-label={view === "list" ? "List view" : "Grid view"} title={view === "list" ? "List view" : "Grid view"} aria-pressed={value === view} onClick={() => onChange(view)}><Icon className="h-4 w-4" />{view === "list" ? "List" : "Grid"}</Button>)}
  </div>;
}