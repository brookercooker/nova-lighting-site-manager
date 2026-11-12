import { useEffect } from "react";
import { useInRouterContext, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDesignChat } from "./DesignChatContext";
import { useModeSwitch } from "./ModeSwitchContext";
import { CONTENT_SAVED } from "./contentSavedEvent";
import { fixBannerText, fixPage, linkAddress } from "./linkCheck";
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
    walk.startFix({ key: link.key, fingerprint, path: page.path, pageName: page.name, address: linkAddress(link) });
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
  if (!fix || !editing) return null;
  const backToReview = async () => {
    walk.fixReturning(true);
    const ok = guard ? await guard.requestChat() : true;
    if (!ok) { walk.fixReturning(false); return; }
    walk.finishFix(); setReviewOpen(true); nav("/manage/preview");
  };
  return <div role="region" aria-label="Changing a Link" data-link-fix className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-secondary px-3 py-1.5 text-sm text-secondary-foreground">
    <p className="w-full min-w-0 break-words sm:w-auto sm:flex-1">{fixBannerText(fix.pageName, fix.address)}</p>
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
