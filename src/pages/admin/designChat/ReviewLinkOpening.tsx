import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useDesignChat } from "./DesignChatContext";
import { useWalk, walk } from "./submitWalkthroughStore";
import { frameOrigin, isLinkCheckReady, postLinkCheck, postLinkFocus } from "./linkCheck";
import { normPath } from "./submitWalkthrough";
import { shownPreviewFrame } from "./previewNavigate";

/** A matching location must arrive before readiness can reveal/focus the destination page. */
export function ReviewLinkOpening() {
  const { showPreviewPath, previewLocation, previewNavigating } = useDesignChat();
  const s = useWalk();
  const pending = s.openingLink;
  useEffect(() => {
    if (!pending || pending.failed) return;
    let arrived = !previewNavigating && !!previewLocation && normPath(previewLocation.path) === normPath(pending.path);
    let arrivedWindow: Window | null = arrived ? shownPreviewFrame()?.contentWindow ?? null : null;
    const receive = (event: MessageEvent) => {
      const frame = shownPreviewFrame();
      if (!frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== frameOrigin(frame)) return;
      const d = event.data;
      if (d?.source === "nova-site" && d.type === "location" && typeof d.path === "string" && normPath(d.path) === normPath(pending.path)) {
        arrived = true; arrivedWindow = frame.contentWindow;
        postLinkCheck(frame, true, pending.entries ?? [{ raw: pending.href, state: "todo" }]);
      }
      if (!arrived || arrivedWindow !== frame.contentWindow || !isLinkCheckReady(event, frame)) return;
      if (walk.get().openingLink !== pending) return;
      postLinkFocus(frame, pending.href);
      walk.update(w => ({ ...w, openingLink: null }));
    };
    window.addEventListener("message", receive);
    if (arrived) postLinkCheck(shownPreviewFrame(), true, pending.entries ?? [{ raw: pending.href, state: "todo" }]);
    const timer = setTimeout(() => { if (walk.get().openingLink === pending) walk.update(w => ({ ...w, openingLink: { ...pending, failed: true } })); }, 15000);
    return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [pending, previewLocation?.path, previewNavigating]);
  if (!pending) return null;
  return <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-background px-4 text-center" role="status">
    <p className="text-sm">{pending.failed ? `${pending.name} couldn't be opened for checking.` : `Opening ${pending.name}…`}</p>
    {pending.failed && <Button type="button" variant="outline" className="h-11" onClick={() => { walk.update(w => ({ ...w, openingLink: { ...pending, failed: false } })); showPreviewPath(pending.path); }}>Retry</Button>}
    <Button type="button" variant="outline" className="h-11" onClick={() => walk.reopen("links")}>Back to Review</Button>
  </div>;
}