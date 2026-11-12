import { useEffect, type RefObject } from "react";
import { isLinkCheckReady, parseLinkClick, postLinkCheck } from "./linkCheck";
import { shownPreviewFrame } from "./previewNavigate";
import { openLinkCheck } from "./SubmitWalkthrough";
import { walk } from "./submitWalkthroughStore";

/**
 * While a walkthrough page is being checked in the visible preview, asks the public frame to report link clicks
 * and opens Check This Link for each validated click. Turned off when checking ends, on Keep Editing and in Manual Edit.
 */
export function useLinkCheckBridge(root: RefObject<HTMLElement>, active: boolean, frameKey: string) {
  useEffect(() => {
    if (!active) return;
    const frame = () => shownPreviewFrame(root.current ?? document);
    let sentTo: HTMLIFrameElement | null = frame();
    postLinkCheck(sentTo, true);
    const receive = (event: MessageEvent) => {
      const f = frame();
      if (!f) return;
      const d = event.data;
      // A reload of the same frame announces preview-ready again; switch link checks back on.
      if (d?.type === "preview-ready" && event.source === f.contentWindow) { postLinkCheck(f, true); sentTo = f; return; }
      if (isLinkCheckReady(event, f)) return;
      const click = parseLinkClick(event, f);
      if (!click) return;
      const checking = walk.get().checking;
      const page = click.path ?? (checking?.kind === "page" && checking.key.startsWith("page:") ? checking.key.slice(5) : null);
      openLinkCheck(click.raw, click.kind, click.label, page, click.href);
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      postLinkCheck(sentTo, false);
      const f = frame(); if (f && f !== sentTo) postLinkCheck(f, false);
    };
  }, [active, frameKey, root]);
}
