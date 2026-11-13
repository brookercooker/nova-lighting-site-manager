import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PageRef } from "./submitWalkthrough";

export function SharedPageUsage({ pages, prefix = "Used on" }: { pages: PageRef[]; prefix?: string }) {
  const [open, setOpen] = useState(false);
  return <div className="min-w-0 text-xs text-muted-foreground" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <Button type="button" variant="ghost" className="h-auto min-h-11 max-w-full whitespace-normal px-0 text-xs" aria-expanded={open} onClick={() => setOpen(value => !value)}>{prefix} {pages.length} {pages.length === 1 ? "page" : "pages"}<ChevronDown aria-hidden className={open ? "rotate-180" : ""} /></Button>
    {open && <ul className="max-h-48 space-y-1 overflow-y-auto overscroll-contain py-1">{pages.map(page => <li key={page.path} className="break-words">{page.name}</li>)}</ul>}
  </div>;
}