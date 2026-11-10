import { WalkthroughCheckBar } from "./SubmitWalkthrough";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Minimize2 } from "lucide-react";
import ScaledViewport from "./ScaledViewport";
import { DESKTOP_VIRTUAL_WIDTH } from "./previewScale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDesignChat, type Device } from "./DesignChatContext";
import StageRibbon from "./StageRibbon";
import { useManagerLayout } from "./useManagerLayout";
import DrawLayer from "./DrawLayer";
import { usePreviewEdits, previewContentLoaded } from "./previewEdits";
import { usePreviewScroll } from "./frameScroll";
import ContentSyncNote from "./ContentSyncNote";

const WIDTH: Record<Device, string> = { mobile: "390px", tablet: "768px", desktop: "100%" };

/**
 * The draft preview of the design site: the picture that fills the Preview tab. The buttons that go with it (sizes, full
 * screen, submit) are in the top bar, see PreviewTools.tsx.
 */
export default function PreviewPanel() {
  const { preview, device, boxRef, inFull, coverFull, toggleFull, drawing, editing, waitProgress, previewNavigating } = useDesignChat();
  const { phone } = useManagerLayout();
  const ribbon = !editing && waitProgress?.request?.ribbon ? waitProgress.request : null;
  const location = useLocation();
  const [updated, setUpdated] = useState(false);
  // Desktop is the starting size; only a later choice of Desktop counts as the person asking for it on a narrow screen.
  const firstDevice = useRef(device);
  const [desktopChosen, setDesktopChosen] = useState(false);
  useEffect(() => { if (device !== firstDevice.current) { firstDevice.current = "" as Device; setDesktopChosen(device === "desktop"); } }, [device]);
  const sectionRef = useRef<HTMLElement>(null);
  const loadedFrames = useRef(new WeakSet<HTMLIFrameElement>());
  const previewFailed = usePreviewEdits(sectionRef);
  const frameAddresses = preview.frames.map(f => `${f.id}:${f.url}`).join("|");
  useEffect(() => {
    // The Chat frame stays mounted while editing; refresh it even when returning causes no load event.
    for (const frame of sectionRef.current?.querySelectorAll<HTMLIFrameElement>("iframe[data-site-preview]") ?? []) {
      if (loadedFrames.current.has(frame)) previewContentLoaded(frame, "mode-or-page-change");
    }
  }, [editing, location.pathname, preview.shownId, frameAddresses]);
  usePreviewScroll(sectionRef, editing, preview.shownId);
  useEffect(() => {
    if (!preview.completedAt) return;
    setUpdated(true);
    const timer = setTimeout(() => setUpdated(false), 4000);
    return () => clearTimeout(timer);
  }, [preview.completedAt]);
  const pending = !editing && !!preview.progressStage;
  const visible = location.pathname.split("/")[2] === "preview" && !editing;

  useEffect(() => {
    drawing.setAvailable(visible && !pending);
    return () => drawing.setAvailable(false);
  }, [drawing.setAvailable, visible, pending]);

  return (
    <section ref={sectionRef} className="flex h-full min-h-0 flex-col" aria-label="Preview">
      <ContentSyncNote previewFailed={previewFailed} />
      <WalkthroughCheckBar />
      <div className={cn("shrink-0 overflow-hidden bg-background transition-[height] duration-200 motion-reduce:transition-none", ribbon && !ribbon.fading ? phone ? "h-2" : "h-12" : "h-0")}>
        <StageRibbon progress={ribbon} thin={phone} className={phone ? "pb-0.5" : "px-2 pt-1 pb-3"} />
      </div>
      <div ref={boxRef} className={cn("relative min-h-0 flex-1 bg-muted flex justify-center", coverFull && "fixed inset-0 z-50 bg-background")}>


        <div ref={drawing.areaRef} className={cn("relative h-full max-w-full overflow-hidden bg-background")}
          style={{ width: WIDTH[device] }}>
          <ScaledViewport className="h-full" enabled={device !== "desktop" || window.innerWidth >= 640} virtualWidth={device === "desktop" ? DESKTOP_VIRTUAL_WIDTH : parseInt(WIDTH[device])} what={device === "desktop" ? "desktop" : device === "tablet" ? "tablet" : "phone"} fallbackWidth={device === "desktop" ? 768 : undefined} explicit={desktopChosen}>
          {preview.frames.map((f) => (
            <iframe
              key={f.id}
              data-site-preview="true"
              src={f.url}
              title={f.id === preview.shownId || preview.shownId === 0 ? "Design Preview" : "Design Preview (Loading)"}
              referrerPolicy="origin"
              data-preview-shown={f.id === preview.shownId || preview.shownId === 0 ? "true" : "false"}
              onLoad={event => {
                const frame = event.currentTarget;
                // about:blank and redirected auth screens are not the public page, even though src still names it.
                try { if (frame.contentWindow?.location.origin !== new URL(frame.src).origin) return; } catch { /* Cross-origin public document. */ }
                loadedFrames.current.add(frame); preview.finish(f.id); previewContentLoaded(frame);
              }}
              className={cn("absolute inset-0 h-full w-full border-0 bg-background", !editing && previewNavigating && "opacity-90", f.id !== preview.shownId && preview.shownId !== 0 && "invisible")}
            />
          ))}
          </ScaledViewport>
          {!pending && drawing.on && preview.loaded && <DrawLayer />}
        </div>

        {!preview.loaded && !preview.error && (
          <div aria-label="Preview Loading" className="pointer-events-none absolute inset-0 bg-background p-6">
            <div className="mx-auto max-w-3xl space-y-6 opacity-[0.58]">
              <div className="h-12 border bg-muted/40" /><div className="h-64 border bg-muted/40" />
              <div className="h-5 w-3/4 bg-muted" /><div className="h-5 bg-muted" /><div className="h-5 w-1/2 bg-muted" />
            </div>
          </div>
        )}
        {preview.error && <div role="alert" className="absolute right-3 top-3 z-30 flex items-center gap-3 rounded-md border bg-background p-2 text-sm text-muted-foreground">{preview.error}<Button type="button" variant="outline" onClick={preview.retry}>Retry</Button></div>}
        {updated && visible && !pending && <div role="status" className="pointer-events-none absolute right-3 top-3 z-30 rounded-full border bg-background px-3 py-1.5 text-xs shadow-sm">Your Preview Is Updated</div>}

        {inFull && !drawing.capturing && (
          <Button type="button" size="sm" aria-label="Exit Full Screen" title="Exit Full Screen" className="absolute right-4 top-4 z-40 gap-2 bg-foreground/80 text-background shadow-sm hover:bg-foreground/90" onClick={toggleFull}>
            <Minimize2 className="h-4 w-4" /> Minimize
          </Button>
        )}
      </div>
    </section>
  );
}
