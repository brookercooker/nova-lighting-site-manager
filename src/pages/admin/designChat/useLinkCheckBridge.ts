import { useEffect, useRef, type RefObject } from "react";
import { frameOrigin, isLinkCheckReady, linkCheckList, parseLinkClick, postLinkCheck, type LinkCheckEntry, type LinkClick } from "./linkCheck";
import { shownPreviewFrame } from "./previewNavigate";
import { matchChangedLink } from "./linkCheck";
import { useDesignChat } from "./DesignChatContext";
import { useWalkthroughData } from "./useWalkthroughData";
import { useWalk, walk } from "./submitWalkthroughStore";

/** Mounted only while a page is checked in the visible preview, so an idle preview never queries anything. */
export function LinkCheckBridge({ root, frameKey }: { root: RefObject<HTMLElement>; frameKey: string }) {
  const { state } = useDesignChat();
  const s = useWalk();
  const data = useWalkthroughData(state, true);
  const links = data?.links.status === "ok" ? linkCheckList(data.links.groups, s.linkTicked, s.linkReplaced) : [];
  const { setReviewOpen } = useDesignChat();
  useLinkCheckBridge(root, true, frameKey, links, (click) => {
    const groups = data.links.status === "ok" ? data.links.groups : [];
    const link = click.match ? matchChangedLink(groups, click.path, click.match) ?? groups.flatMap(g => g.links).find(l => l.href === click.match) : null;
    walk.selectLink(link?.key ?? null);
    setReviewOpen?.(true);
  });
  return null;
}

/**
 * While a walkthrough page is being checked in the visible preview, sends the public frame the changed links (protocol v2)
 * and selects inline review rows on trusted clicks. All-link interception requires Public's interceptAll support.
 * Turned off when checking ends, on Keep Editing and in Manual Edit.
 */
export function useLinkCheckBridge(root: RefObject<HTMLElement>, active: boolean, frameKey: string, links: LinkCheckEntry[] = [], onClick?: (click: LinkClick) => void) {
  const clickRef = useRef(onClick); clickRef.current = onClick;
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
      if (d?.source === "nova-site" && d.type === "preview-ready" && event.source === f.contentWindow && event.origin === frameOrigin(f)) { supported = false; postLinkCheck(f, true, linksRef.current); sentTo.current = f; return; }
      if (isLinkCheckReady(event, f)) { supported = true; return; }
      if (!supported) return;
      const click = parseLinkClick(event, f, linksRef.current.map(l => l.raw), true);
      if (!click) return;
      if (clickRef.current) clickRef.current(click);
      else walk.selectLink(click.match ?? null);
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
