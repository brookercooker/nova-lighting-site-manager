import { useState } from "react";
import { Monitor, Smartphone, Tablet, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDesignChat, type Device } from "./DesignChatContext";
import WaitProgress from "./WaitProgress";
import { undoPendingGate, undoPendingReason } from "./logic";

/**
 * Device size stays with the component pickers; navigation lives in PreviewToolbar.
 * Submit for review stays in the top bar (SubmitButton).
 */
export default function PreviewTools({ showViewControls, tight = false, review = false }: { showViewControls: boolean; tight?: boolean; review?: boolean }) {
  const { device, setDevice } = useDesignChat();

  return (
    <div className="flex shrink-0 items-center gap-2">
      {showViewControls && (
        <>
          {!tight && <ToggleGroup type="single" value={device} onValueChange={(v) => v && setDevice(v as Device)} variant="outline" size="sm"
            className={`flex gap-0 [&>button]:rounded-none [&>button:first-child]:rounded-l-md [&>button:last-child]:rounded-r-md [&>button+button]:-ml-px ${review ? "[&>button]:h-11 [&>button]:w-11" : ""}`} aria-label="Preview Size">
            <ToggleGroupItem value="mobile" aria-label="Mobile Preview" title="Mobile Preview"><Smartphone className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="tablet" aria-label="Tablet Preview" title="Tablet Preview"><Tablet className="h-4 w-4" /></ToggleGroupItem>
            <ToggleGroupItem value="desktop" aria-label="Desktop Preview" title="Desktop Preview"><Monitor className="h-4 w-4" /></ToggleGroupItem>
          </ToggleGroup>}
        </>
      )}
    </div>
  );
}

export { SubmitConfirmDialog } from "./SubmitWalkthrough";
import { SubmitConfirmDialog } from "./SubmitWalkthrough";

/**
 * Submit for review (or Publish, when review is off): changes can be waiting whichever tab is open.
 * The compatibility opener enters the left-column walkthrough; phone overflow can still host that opener outside its menu.
 */
export function SubmitButton({ compact = false, showProgress = true, onRequestSubmit }: { compact?: boolean; showProgress?: boolean; onRequestSubmit?: () => void }) {
  const { state, waitProgress } = useDesignChat();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const p = state?.publish ?? { ok: true, open: 0 };
  const reviewOn = state?.review?.enabled;
  const undoPending = undoPendingGate(state);
  const submitDisabled = !state || state.busy || p.open === 0 || (!p.ok && !p.willReview) || undoPending;
  const label = reviewOn === false ? "Publish" : "Submit for Review";
  return (
    <div className="shrink-0"><Button type="button" variant="review" size="sm" className={compact ? "w-9 shrink-0 px-0" : "shrink-0"} aria-label={label} title={label} disabled={submitDisabled} onClick={() => (onRequestSubmit ? onRequestSubmit() : setConfirmOpen(true))}>
      <Send className="h-4 w-4" aria-hidden />
      {!compact && label}
    </Button>{undoPending && <p role="status" className="mt-1 max-w-64 text-xs text-muted-foreground">{undoPendingReason(state)}</p>}{showProgress && <WaitProgress progress={waitProgress?.submit} className="mt-2 w-full max-w-64" />}
    {!onRequestSubmit && <SubmitConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} />}</div>
  );
}
