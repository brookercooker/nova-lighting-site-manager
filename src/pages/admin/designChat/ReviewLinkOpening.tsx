import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useDesignChat } from "./DesignChatContext";
import { useWalk, walk } from "./submitWalkthroughStore";
import { frameOrigin, isLinkCheckReady, postLinkCheck, postLinkFocus } from "./linkCheck";
import { normPath } from "./submitWalkthrough";
import { shownPreviewFrame } from "./previewNavigate";

/** Focus immediately on trusted arrival; handshake retries never block the preview. */
export function ReviewLinkOpening() {
  const { showPreviewPath, previewLocation, previewNavigating } = useDesignChat();
  const s = useWalk();
  const pending = s.openingLink;
  useEffect(() => {
    if (!pending || pending.failed) return;
    let arrived = !previewNavigating && !!previewLocation && normPath(previewLocation.path) === normPath(pending.path);
    let retried = false;
    const focus = () => {
      const frame = shownPreviewFrame();
      postLinkCheck(frame, true, pending.entries ?? [{ raw: pending.href, state: "todo" }]);
      postLinkFocus(frame, pending.href, { elementKey: pending.elementKey, scope: pending.scope, inventoryIndex: pending.inventoryIndex });
    };
    const finish = () => {
      if (walk.get().openingLink !== pending) return;
      focus();
      walk.update(w => ({ ...w, openingLink: null }));
    };
    const receive = (event: MessageEvent) => {
      const frame = shownPreviewFrame();
      if (!frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== frameOrigin(frame)) return;
      const d = event.data;
      if (d?.source === "nova-site" && d.type === "location" && typeof d.path === "string" && normPath(d.path) === normPath(pending.path)) {
        arrived = true;
        finish();
      }
      if (arrived && isLinkCheckReady(event, frame)) finish();
    };
    window.addEventListener("message", receive);
    if (arrived) finish();
    const retry = () => {
      if (arrived || walk.get().openingLink !== pending) return;
      retried = true;
      showPreviewPath(pending.path);
    };
    const failed = (event: Event) => {
      if (event.target !== shownPreviewFrame()) return;
      if (arrived || walk.get().openingLink !== pending) return;
      if (!retried) retry();
      else walk.update(w => ({ ...w, openingLink: { ...pending, failed: true } }));
    };
    const timer = setTimeout(retry, 4000);
    const root = document.querySelector("section[aria-label='Preview']") ?? document;
    root.addEventListener("error", failed, true);
    return () => { clearTimeout(timer); root.removeEventListener("error", failed, true); window.removeEventListener("message", receive); };
  }, [pending, previewLocation?.path, previewNavigating]);
  if (!pending) return null;
  return <div className="absolute bottom-2 left-2 right-2 z-30 flex flex-wrap items-center justify-center gap-2 rounded-md border bg-background px-2 text-center" role="status">
    <p className="text-xs">{pending.failed ? `${pending.name} couldn't be opened for checking.` : pending.name}</p>
    {pending.failed && <Button type="button" variant="outline" className="h-11" onClick={() => { walk.update(w => ({ ...w, openingLink: { ...pending, failed: false } })); showPreviewPath(pending.path); }}>Retry</Button>}
    <Button type="button" variant="outline" className="h-11" onClick={() => walk.reopen("links")}>Back to Review</Button>
  </div>;
}