import { useEffect, useRef, type RefObject } from "react";
import { isLinkCheckReady, linkCheckList, parseLinkClick, postLinkCheck, type LinkCheckEntry } from "./linkCheck";
import { shownPreviewFrame } from "./previewNavigate";
import { openLinkCheck } from "./SubmitWalkthrough";
import { useDesignChat } from "./DesignChatContext";
import { useWalkthroughData } from "./useWalkthroughData";
import { useWalk, walk } from "./submitWalkthroughStore";

/** Mounted only while a page is checked in the visible preview, so an idle preview never queries anything. */
export function LinkCheckBridge({ root, frameKey }: { root: RefObject<HTMLElement>; frameKey: string }) {
  const { state } = useDesignChat();
  const s = useWalk();
  const data = useWalkthroughData(state, true);
  const links = data?.links.status === "ok" ? linkCheckList(data.links.groups, s.linkTicked, s.linkWrong, s.linkReplaced) : [];
  useLinkCheckBridge(root, true, frameKey, links);
  return null;
}

/**
 * While a walkthrough page is being checked in the visible preview, sends the public frame the changed links (protocol v2)
 * and opens Check This Link only for clicks matching a listed link. Older frames (v1 or no reply) are left alone.
 * Turned off when checking ends, on Keep Editing and in Manual Edit.
 */
export function useLinkCheckBridge(root: RefObject<HTMLElement>, active: boolean, frameKey: string, links: LinkCheckEntry[] = []) {
  const linksRef = useRef(links);
  linksRef.current = links;
  const sig = JSON.stringify(links);
  const sentTo = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const frame = () => shownPreviewFrame(root.current ?? document);
    let supported = false;
    sentTo.current = frame();
    postLinkCheck(sentTo.current, true, linksRef.current);
    const receive = (event: MessageEvent) => {
      const f = frame();
      if (!f) return;
      const d = event.data;
      // A reload announces preview-ready again; resend the full list.
      if (d?.type === "preview-ready" && event.source === f.contentWindow) { supported = false; postLinkCheck(f, true, linksRef.current); sentTo.current = f; return; }
      if (isLinkCheckReady(event, f)) { supported = true; return; }
      if (!supported) return;
      const click = parseLinkClick(event, f, linksRef.current.map(l => l.raw));
      if (!click?.match) return;
      const checking = walk.get().checking;
      const page = click.path ?? (checking?.kind === "page" && checking.key.startsWith("page:") ? checking.key.slice(5) : null);
      openLinkCheck(click.match, click.kind, click.label, page, click.href);
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      postLinkCheck(sentTo.current, false);
      const f = frame(); if (f && f !== sentTo.current) postLinkCheck(f, false);
      sentTo.current = null;
    };
  }, [active, frameKey, root]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (active && sentTo.current) postLinkCheck(sentTo.current, true, linksRef.current);
  }, [sig]);
}
