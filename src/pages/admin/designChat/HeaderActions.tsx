import { ClipboardList, CircleHelp, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDesignChat } from "./DesignChatContext";
import { reviewDisplayCount } from "./reviewLog";
import { useState, useEffect } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useWalk } from "./submitWalkthroughStore";
import ReviewChangesView from "./ReviewChangesView";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ReviewStatusDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const show = () => setOpen(true); window.addEventListener("nova-review-status", show); return () => window.removeEventListener("nova-review-status", show); }, []);
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[85dvh] min-w-0 flex-col overflow-hidden"><DialogHeader><DialogTitle>Status</DialogTitle></DialogHeader><ReviewChangesView embedded onShowPreview={() => {}} /></DialogContent></Dialog>;
}

/** Review Status as a Tools menu item: expands the column first, then toggles the review view. */
export function StatusMenuItem({ onExpand }: { onExpand?: () => void }) {
  const { state, editing, reviewOpen, setReviewOpen } = useDesignChat();
  const w = useWalk();
  const showStatus = () => { onExpand?.(); if (w.open || w.checking) window.dispatchEvent(new Event("nova-review-status")); else setReviewOpen(!reviewOpen); };
  const count = reviewDisplayCount(state);
  return <DropdownMenuItem disabled={editing} aria-label={`Review Status${count ? `: ${count} Waiting` : ""}`} onClick={showStatus}>
    <ClipboardList className="mr-2 h-4 w-4" aria-hidden />Status
    <span className="ml-auto pl-3 text-xs text-muted-foreground">{count > 0 ? `${count} ${count === 1 ? "change" : "changes"} waiting` : "No changes waiting"}</span>
  </DropdownMenuItem>;
}

/** Relay publish.open is authoritative; chat messages are not a pending-change ledger. `hideStatus` leaves Status to the Tools menu. */
export default function HeaderActions({ onExpand, menuItems = false, showLabels = true, hideStatus = false }: { onExpand?: () => void; menuItems?: boolean; showLabels?: boolean; hideStatus?: boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const { state, editing, previewLocation, workingPage, reviewOpen, setReviewOpen } = useDesignChat();
  const w = useWalk();
  const showStatus = () => { onExpand?.(); if (w.open || w.checking) window.dispatchEvent(new Event("nova-review-status")); else setReviewOpen(!reviewOpen); };
  const count = reviewDisplayCount(state);
  const copySummary = async () => {
    const latest = [...(state?.history ?? [])].reverse().find((entry) => entry.role === "user" || entry.role === "assistant");
    const page = previewLocation?.path ?? workingPage?.path ?? "No page selected";
    try {
      await navigator.clipboard.writeText(`Site Manager problem report\nPage: ${page}\nMode: ${editing ? "Manual Edit Mode" : "Chat Mode"}\nLast action: ${latest?.text ?? "No action recorded"}\nWaiting for review: ${count}`);
      toast.success("Problem summary copied. Share it with the site owner.");
    } catch { toast.error("The summary couldn't be copied. Try again."); }
  };
  if (menuItems) return <>
    <DropdownMenuItem disabled={editing} onClick={showStatus}><ClipboardList className="mr-2 h-4 w-4" />Status<span className="ml-auto pl-3 text-xs text-muted-foreground">{count > 0 ? `${count} ${count === 1 ? "change" : "changes"} waiting` : "No changes waiting"}</span></DropdownMenuItem>
    <DropdownMenuItem onSelect={e => { e.preventDefault(); setHelpOpen(true); }}><CircleHelp className="mr-2 h-4 w-4" />Help</DropdownMenuItem>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent><DialogHeader><DialogTitle>Help</DialogTitle></DialogHeader><p className="text-sm">Describe a change in chat, or choose Edit to change the page by hand. Save Changes saves your edits. Status lists changes waiting for review.</p><Button variant="outline" onClick={() => void copySummary()}><Copy className="h-4 w-4" />Copy Problem Summary</Button></DialogContent></Dialog>
  </>;
  return <TooltipProvider delayDuration={200}>
    <div className="flex max-w-full shrink-0 items-center justify-center gap-1">
      {!hideStatus && <Tooltip><TooltipTrigger asChild>
        <span tabIndex={editing ? 0 : undefined}>
          <Button variant={reviewOpen ? "secondary" : "ghost"} size={showLabels ? "sm" : "icon"} className={showLabels ? "h-8 shrink-0 gap-1.5 whitespace-nowrap px-2" : "h-8 w-8 shrink-0"} aria-label={`Review Status${count ? `: ${count} Waiting` : ""}`} aria-pressed={reviewOpen} disabled={editing} onClick={showStatus}>
            <ClipboardList className="h-4 w-4" aria-hidden />
            {showLabels && <span>Status</span>}
            {showLabels && count > 0 && <span aria-hidden className="text-xs font-normal text-muted-foreground">{count}</span>}
          </Button>
        </span>
      </TooltipTrigger><TooltipContent>{editing ? "Finish editing before reviewing your changes." : reviewOpen ? "Back to Chat" : "Review Status"}</TooltipContent></Tooltip>}
      <Popover>
        <Tooltip><TooltipTrigger asChild><PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Help"><CircleHelp className="h-4 w-4" aria-hidden /></Button>
        </PopoverTrigger></TooltipTrigger><TooltipContent>Help</TooltipContent></Tooltip>
        <PopoverContent align="start" collisionPadding={12} className="w-80 max-w-[calc(100vw-24px)] space-y-3">
          <h2 className="font-sans text-sm font-semibold">Help</h2>
          <ul className="list-disc space-y-2 pl-4 text-sm">
            <li>In Chat Mode, describe what you want changed. In Manual Edit Mode, change text, pictures and links yourself.</li>
            <li>In Manual Edit Mode, open Objects in the top bar, pick objects, then choose Add N Objects. Pictures and videos are also in the top bar.</li>
            <li>Discard Changes means undo everything since you last saved.</li>
            <li>Save Changes (top right) saves your hand edits and returns to Chat Mode. Tools, then Status, lists the changes waiting for review.</li>
            <li>If something looks wrong, pause and share a problem summary with the site owner before submitting.</li>
          </ul>
          <Button variant="outline" size="sm" onClick={() => void copySummary()}><Copy className="h-4 w-4" aria-hidden />Copy Problem Summary</Button>
        </PopoverContent>
      </Popover>
    </div>
  </TooltipProvider>;
}