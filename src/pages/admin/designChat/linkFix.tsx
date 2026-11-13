import { useEffect, useState } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDesignChat } from "./DesignChatContext";
import { useModeSwitch } from "./ModeSwitchContext";
import { CONTENT_SAVED } from "./contentSavedEvent";
import { fixBannerText, fixPage, frameOrigin, linkAddress } from "./linkCheck";
import { walk, useWalk } from "./submitWalkthroughStore";
import type { ChangedRow, LinkGroup, ReviewLink } from "./submitWalkthrough";

function useNav(): (to: string) => void {
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const navigate = inRouter ? useNavigate() : null;
  return (to) => navigate?.(to);
}

/** Change This Link: remembers the return point, closes the walkthrough and opens the link's page in Manual Edit Mode. */
export function useChangeLink() {
  const chat = useDesignChat() as Partial<ReturnType<typeof useDesignChat>>;
  const guard = useModeSwitch();
  const nav = useNav();
  return async (link: ReviewLink, group: LinkGroup, rows: ChangedRow[], fingerprint: string) => {
    const page = fixPage(group, rows);
    walk.startFix({ key: link.key, fingerprint, path: page.path, pageName: page.name, address: linkAddress(link), href: link.href });
    chat.setReviewOpen?.(false);
    const back = () => { walk.clearFix(); walk.reopen("links"); chat.setReviewOpen?.(true); };
    const open = async () => {
      const [{ registerPreviewPage }, { workingPageFrom }] = await Promise.all([import("./usePreviewPage"), import("./pageSelection")]);
      const target = await registerPreviewPage(page);
      chat.selectPage?.(workingPageFrom(target)); nav("/manage/preview"); chat.startEditing?.();
    };
    try {
      const ok = guard ? await guard.requestManual(open) : (await open(), true);
      if (!ok) back();
    } catch { toast.error("Couldn't open this page for editing. Try again."); back(); }
  };
}

/** Slim banner above the page editor while Change This Link is open. */
export function LinkFixBanner() {
  const s = useWalk();
  const { editing, setReviewOpen } = useDesignChat();
  const guard = useModeSwitch();
  const nav = useNav();
  const fix = s.fix;
  useEffect(() => {
    if (!fix) return;
    const on = () => walk.fixSaved();
    window.addEventListener(CONTENT_SAVED, on);
    return () => window.removeEventListener(CONTENT_SAVED, on);
  }, [!!fix]);
  const found = useEditSelectLink(fix && editing ? fix.href ?? null : null);
  if (!fix || !editing) return null;
  const backToReview = async () => {
    walk.fixReturning(true);
    const ok = guard ? await guard.requestChat() : true;
    if (!ok) { walk.fixReturning(false); return; }
    walk.finishFix(); setReviewOpen(true); nav("/manage/preview");
  };
  return <div role="region" aria-label="Changing a Link" data-link-fix className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-secondary px-3 py-3 text-sm text-secondary-foreground sm:py-2">
    <div className="w-full min-w-0 break-words sm:w-auto sm:flex-1">
      <p>{fixBannerText(fix.pageName, fix.address)}</p>
      {found.state === "missing" && <p role="status" className="mt-2 text-xs leading-relaxed">Couldn't select this link.</p>}
      {found.state === "found" && found.count > 1 && <p role="status" className="mt-2 text-xs leading-relaxed">{found.count} links on this page go there; the first is selected.</p>}
    </div>
    <Button type="button" variant={fix.saved ? "default" : "outline"} className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => void backToReview()}>
      <ArrowLeft className="h-4 w-4" aria-hidden />{fix.saved ? "Done, Back to Review" : "Back to Review"}
    </Button>
  </div>;
}

/** Leaving Manual Edit Mode any way other than the banner's Back to Review forgets the return point. */
export function useClearFixOnExit(editing: boolean) {
  useEffect(() => {
    const f = walk.get().fix;
    if (!editing && f && !f.returning) walk.clearFix();
  }, [editing]);
}

export type SelectLinkResult = { state: "pending" | "found" | "missing"; count: number };
/**
 * Wait for the editor's edit-ready/edit-init gate, then retry for six seconds.
 * Replies count only from the exact ready frame window and origin, for this href.
 */
export function useEditSelectLink(href: string | null, getFrame: () => HTMLIFrameElement | null = () => document.querySelector<HTMLIFrameElement>("iframe[data-site-editor]")): SelectLinkResult {
  const [result, setResult] = useState<SelectLinkResult>({ state: "pending", count: 0 });
  useEffect(() => {
    setResult({ state: "pending", count: 0 });
    if (!href) return;
    let active: HTMLIFrameElement | null = null;
    let finished = false;
    let retry: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { clearInterval(retry); clearTimeout(deadline); };
    const send = () => {
      const f = getFrame(), origin = frameOrigin(f);
      if (f !== active || !f?.contentWindow || !origin || finished) return;
      try { f.contentWindow.postMessage({ source: "nova-manager", type: "edit-select-link", href }, origin); } catch { /* frame gone */ }
    };
    const begin = () => {
      const f = getFrame();
      if (!f?.contentWindow || !frameOrigin(f) || f === active) return;
      stop(); active = f; finished = false;
      setResult({ state: "pending", count: 0 });
      retry = setInterval(send, 500);
      deadline = setTimeout(() => { stop(); if (!finished) setResult({ state: "missing", count: 0 }); }, 6000);
      send();
    };
    const checkReady = () => {
      const f = getFrame();
      if (active && (f !== active || f?.getAttribute?.("data-edit-ready") === "false")) {
        stop(); active = null; finished = false; setResult({ state: "pending", count: 0 });
      }
      if (f?.getAttribute?.("data-edit-ready") === "true") begin();
    };
    const on = (e: MessageEvent) => {
      const f = getFrame();
      if (!f?.contentWindow || e.source !== f.contentWindow || e.origin !== frameOrigin(f)) return;
      const d = e.data;
      if (!d || typeof d !== "object" || d.source !== "nova-site") return;
      // Defer until FramedPageEditor has sent edit-init from the same trusted readiness signal.
      if (d.type === "edit-ready") { clearTimeout(readyTimer); readyTimer = setTimeout(checkReady, 0); return; }
      if (f !== active || d.type !== "edit-select-link-result" || d.href !== href || d.found !== true) return;
      finished = true; stop();
      const count = Number.isSafeInteger(d.count) && d.count > 0 && d.count <= 10000 ? d.count : 1;
      setResult({ state: "found", count });
    };
    window.addEventListener("message", on);
    const observer = new MutationObserver(checkReady);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-edit-ready"] });
    checkReady();
    return () => { stop(); clearTimeout(readyTimer); observer.disconnect(); window.removeEventListener("message", on); };
  }, [href]);
  return result;
}
