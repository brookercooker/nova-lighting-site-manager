import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryView } from "./libraryView";

export default function LibraryViewToggle({ value, onChange }: { value: LibraryView; onChange: (value: LibraryView) => void }) {
  return <div role="group" aria-label="Library View" className="flex shrink-0 overflow-hidden rounded-md border">
    {([['list', List], ['grid', LayoutGrid]] as const).map(([view, Icon]) => <Button key={view} variant={value === view ? "default" : "ghost"} className="h-11 w-11 rounded-none p-0" aria-label={view === "list" ? "List view" : "Grid view"} title={view === "list" ? "List view" : "Grid view"} aria-pressed={value === view} onClick={() => onChange(view)}><Icon className="h-4 w-4" /></Button>)}
  </div>;
}