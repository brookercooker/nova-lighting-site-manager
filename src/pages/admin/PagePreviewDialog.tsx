import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import { regenerateThumbnail, type ThumbCandidate } from "./useThumbnailCapture";
import { usePageThumbSrc } from "./signedThumb";
import { toast } from "sonner";
import { draftEmbedUrl } from "./siteManifest";
import { publicPreviewBase, publicPreviewPage } from "./designChat/publicPreviewUrl";

/** The page on the public (draft) site — never the Site Manager's own address, which has no visitor pages. */
/** Signed embed addresses are only for the inline frame; new tabs get the plain public address. */
function publicPageUrl(path: string, signed = false): string | null {
  try { return publicPreviewPage((signed ? draftEmbedUrl() : null) ?? publicPreviewBase(null), path.startsWith("/") ? path : `/${path}`); }
  catch { return null; }
}

/**
 * On-demand large preview shown when the user clicks a page/object thumbnail.
 * Renders the stored server-side preview image if available (instant); when
 * not yet captured, falls back to a live iframe so the user still sees content.
 */
export default function PagePreviewDialog({
  page,
  onClose,
  onCaptured,
  placeholderMessage,
}: {
  page:
    | (ThumbCandidate & { name: string; preview_url?: string | null })
    | null;
  onClose: () => void;
  onCaptured?: () => void;
  /** When provided AND there is no stored preview, show this neutral message
   *  instead of falling back to a live iframe capture. */
  placeholderMessage?: string;
}) {
  const [regenerating, setRegenerating] = useState(false);
  const signedPreview = usePageThumbSrc(page?.preview_url);

  const openLive = () => {
    if (!page) return;
    const url = publicPageUrl(page.path);
    if (!url) { toast.error("Couldn't find the public site's address. Open the Preview once, then try again."); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const onRegenerate = async () => {
    if (!page) return;
    setRegenerating(true);
    try {
      await regenerateThumbnail(page);
      toast.success("Thumbnail regenerated");
      onCaptured?.();
    } catch (e: any) {
      toast.error(`Regenerate failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Dialog open={!!page} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl w-[95vw] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 pr-14 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="truncate">{page?.name}</DialogTitle>
              <p className="text-xs font-mono text-muted-foreground mt-1 truncate">{page?.path}</p>
            </div>
            {page && (
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating} className="gap-1.5">
                  <RefreshCw className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`} />
                  Refresh Thumbnail and Preview Images
                </Button>
                <Button variant="outline" size="sm" onClick={openLive} className="gap-1.5">
                  <ExternalLink className="w-4 h-4" /> Open in New Tab
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>
        <div className="bg-muted/30 p-4 max-h-[80vh] overflow-auto">
          {signedPreview ? (
            <img
              src={signedPreview}
              alt={page?.name ?? ""}
              className="w-full h-auto rounded border bg-background shadow-sm"
            />
          ) : placeholderMessage ? (
            <div className="rounded border bg-background flex items-center justify-center text-center text-sm text-muted-foreground px-6" style={{ minHeight: "40vh" }}>
              <div className="max-w-md space-y-2">
                <div className="uppercase tracking-wider text-[10px] opacity-70">No preview yet</div>
                <div className="font-medium text-foreground/80">{placeholderMessage}</div>
                <div className="text-xs">Use "Refresh Thumbnail and Preview Images" after the page is live to capture one.</div>
              </div>
            </div>
          ) : (
            <div className="rounded border bg-background overflow-hidden">
              <div className="px-3 py-2 text-[11px] text-muted-foreground border-b bg-muted/50">
                Preview generating… showing live page in the meantime.
              </div>
              <iframe
                src={(page && publicPageUrl(page.path, true)) ?? "about:blank"}
                title={page?.name ?? "Preview"}
                className="w-full"
                style={{ height: "70vh", border: 0 }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
