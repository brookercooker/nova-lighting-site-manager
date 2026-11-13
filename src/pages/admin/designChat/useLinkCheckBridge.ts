import { useEffect, useRef, type RefObject } from "react";
import { frameOrigin, isLinkCheckReady, linkCheckList, parseLinkClick, postLinkCheck, postLinkFocus, type LinkCheckEntry, type LinkClick } from "./linkCheck";
import { publicLinkAddress } from "../linkDisplay";
import { shownPreviewFrame } from "./previewNavigate";
import { changedLinkForClick } from "./linkCheck";
import { openReviewDestination } from "./openReviewDestination";
import { ownLinkPrint } from "./SubmitWalkthrough";
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
  useEffect(() => {
    const focus = (event: MessageEvent) => {
      const frame = shownPreviewFrame(root.current ?? document);
      if (!isLinkCheckReady(event, frame) || walk.get().openingLink) return;
      const link = data.links.status === "ok" ? data.links.groups.flatMap(g => g.links).find(l => l.key === walk.get().checking?.key) : null;
      if (link) postLinkFocus(frame, link.href, { elementKey: link.elementKey, scope: link.scope, inventoryIndex: link.inventoryIndex });
    };
    window.addEventListener("message", focus);
    return () => window.removeEventListener("message", focus);
  }, [data.links, root, frameKey]);
  useLinkCheckBridge(root, true, frameKey, links, (click) => {
    const groups = data.links.status === "ok" ? data.links.groups : [];
    const link = changedLinkForClick(groups, click);
    const opened = click.opened ?? openReviewDestination(click);
    walk.selectLink(link?.key ?? null);
    if (opened && link) walk.openedVerification(link.key, ownLinkPrint(link));
    if (!opened) walk.update(w => ({ ...w, linkNote: "Your browser blocked the new tab. Use the open icon on the tile." }));
    setReviewOpen?.(true);
  });
  return null;
}

/**
 * While a walkthrough page is being checked in the visible preview, sends the public frame the changed links (protocol v2)
 * and selects inline review rows on trusted clicks. All-link interception requires Public's interceptAll support.
 * Turned off when checking ends, on Return to Edit and in Manual Edit.
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
    const receive = (event: MessageEvent) => {
      const f = frame();
      if (!f) return;
      const d = event.data;
      // A reload announces preview-ready again; resend the full list.
      if (d?.source === "nova-site" && d.type === "preview-ready" && event.source === f.contentWindow && event.origin === frameOrigin(f)) { postLinkCheck(f, true, linksRef.current); sentTo.current = f; return; }
      if (isLinkCheckReady(event, f)) return;
      const click = parseLinkClick(event, f, linksRef.current.map(l => l.raw), true);
      // Inspect only the exact shown Public window/origin, and redact credentials.
      if (import.meta.env.DEV && event.source === f.contentWindow && event.origin === frameOrigin(f) && d?.source === "nova-site" && d.type === "link-click") {
        const address = (v: unknown) => typeof v === "string" ? publicLinkAddress(v).replace(/([?&])[^=&#]*(?:token|secret|auth|key)[^=&#]*=[^&#]*/gi, "$1[redacted]").slice(0, 2048) : typeof v;
        console.debug("[review-link] received link-click", { v: d.v, match: d.match === null ? null : address(d.match), raw: address(d.raw), href: address(d.href), kind: typeof d.kind === "string" ? d.kind.slice(0, 30) : typeof d.kind, path: address(d.path), accepted: !!click });
      }
      if (!click) return;
      if (clickRef.current) clickRef.current(click);
      else walk.selectLink(click.match ?? null);
    };
    window.addEventListener("message", receive);
    sentTo.current = frame();
    postLinkCheck(sentTo.current, true, linksRef.current);
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
