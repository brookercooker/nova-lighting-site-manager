import { useEffect, useRef, useState } from "react";
import { Pencil, Save, X, Undo2, Unlink, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { publicPreviewBase, publicPreviewPage } from "./publicPreviewUrl";
import { LINK_DESTINATION_ERROR, validTextLink } from "../textAdornment";
import { normPath } from "./submitWalkthrough";
import { isInternalPath } from "./registerPage";
import { fixPage } from "./linkCheck";
import { useDesignChat } from "./DesignChatContext";
import { useChangeLink } from "./linkFix";
import { walk, useWalk } from "./submitWalkthroughStore";
import { resolveReviewLink, saveReviewLink, resetReviewLink, refreshRemovedReviewLink, FIND_LINK_ERROR, type ResolvedReviewLink } from "./reviewLinkSave";
import type { ManagerPage } from "./submitWalkthrough";
import { publicLinkAddress } from "../linkDisplay";
import { linkText } from "./linkCheck";
import { hostWarnings } from "./linkRisk";
import { ReviewRiskFlags } from "./ReviewLinkRiskDetails";

function draftPageUrl(path: string, embed: unknown): string | undefined {
  try { return publicPreviewPage(publicPreviewBase(embed), path); } catch { return undefined; }
}

/** One local draft per panel opening; native field undo remains local until the explicit save. */
export function ReviewLinkEditor({ pages, knownDomains = [], trustedDomains = [] }: { pages: ManagerPage[]; knownDomains?: string[]; trustedDomains?: string[] }) {
  const s = useWalk();
  const edit = s.reviewEdit;
  return edit ? <ReviewLinkForm key={edit.link.key} edit={edit} pages={pages} knownDomains={knownDomains} trustedDomains={trustedDomains} /> : null;
}
function ReviewLinkForm({ edit, pages, knownDomains, trustedDomains }: { edit: NonNullable<ReturnType<typeof useWalk>["reviewEdit"]>; pages: ManagerPage[]; knownDomains: string[]; trustedDomains: string[] }) {
  const { preview } = useDesignChat();
  const fallback = useChangeLink();
  const [address, setAddress] = useState(publicLinkAddress(edit.link.href));
  const [blank, setBlank] = useState(false);
  const [resolved, setResolved] = useState<ResolvedReviewLink | null>(null);
  const [finding, setFinding] = useState(true);
  const [resolutionHint, setResolutionHint] = useState(FIND_LINK_ERROR);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const page = fixPage(edit.group, edit.rows);
  const embed = preview?.frames.find(f => f.id === preview.shownId)?.url;
  const destination = publicLinkAddress(address);
  const valid = validTextLink(destination);
  const destinationHint = !valid ? LINK_DESTINATION_ERROR : destination.startsWith("/") && !pages.some(p => normPath(p.path) === normPath(destination)) ? "This page doesn't exist yet" : "";
  const savingRef = useRef(false);
  useEffect(() => {
    let active = true;
    void resolveReviewLink(page.path, edit.link.href, edit.link.label, embed, { elementKey: edit.link.elementKey, scope: edit.link.scope }).then(r => {
      if (active) { setResolved(r); setBlank(r.blank); setFinding(false); }
    }).catch(e => { if (active) { setResolutionHint(e instanceof Error ? e.message : FIND_LINK_ERROR); setFinding(false); } });
    return () => { active = false; };
  }, [page.path, edit.link.href, edit.link.label, embed]);
  const cancel = () => { if (!savingRef.current) walk.update(s => ({ ...s, reviewEdit: null })); };
  const save = async () => {
    const destination = publicLinkAddress(address);
    if (!validTextLink(destination)) { setError(LINK_DESTINATION_ERROR); return; }
    if (!resolved || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const lines = await saveReviewLink(resolved, destination, blank);
      const kind = /^mailto:/i.test(destination) ? "mail" : /^tel:/i.test(destination) ? "phone" : destination.startsWith("/") ? "internal" : "external";
      walk.savedLink(page.path, { ...edit.link, target: blank ? "_blank" : null, href: destination, originalHref: resolved.element.originalHref ?? edit.link.originalHref, kind, elementKey: resolved.element.key, scope: resolved.element.scope, label: resolved.element.label || edit.link.label, ariaLabel: resolved.element.ariaLabel || edit.link.ariaLabel, visibleText: resolved.element.visibleText || edit.link.visibleText, image: resolved.element.image || edit.link.image, requestIds: [], status: null });
      const { notifyContentEdited } = await import("./contentSync");
      notifyContentEdited(lines);
    } catch (e) { setError(e instanceof Error ? e.message : "Your new link couldn't be saved. Please try again."); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const reset = async (action: "restore" | "remove") => {
    if (!resolved || savingRef.current) return;
    const original = resolved.element.originalHref;
    if (action === "restore" && !original) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const lines = await resetReviewLink(resolved, action);
      const href = action === "restore" ? original ?? edit.link.href : edit.link.href;
      const kind = /^mailto:/i.test(href) ? "mail" : /^tel:/i.test(href) ? "phone" : href.startsWith("#") ? "anchor" : href.startsWith("/") ? "internal" : "external";
      if (action === "restore") walk.savedLink(page.path, { ...edit.link, originalHref: original ?? edit.link.originalHref, label: resolved.element.label || edit.link.label, visibleText: resolved.element.visibleText || edit.link.visibleText, image: resolved.element.image || edit.link.image, href, kind, target: undefined });
      const { notifyContentEdited } = await import("./contentSync");
      notifyContentEdited(lines);
      if (action === "remove") {
        walk.update(s => ({ ...s, linkReplaced: { ...s.linkReplaced, [edit.link.key]: edit.fingerprint }, linkTicked: s.linkTicked.filter(k => k !== edit.link.key), linkApprovals: Object.fromEntries(Object.entries(s.linkApprovals).filter(([k]) => k !== edit.link.key)), savedReviewLinks: s.savedReviewLinks.filter(x => x.link.key !== edit.link.key) }));
        setRemoved(true);
        setResolved(null);
        setFinding(true);
        try { setResolved(await refreshRemovedReviewLink(resolved)); }
        catch (e) { setResolutionHint(e instanceof Error ? e.message : FIND_LINK_ERROR); }
        finally { setFinding(false); }
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Your link couldn't be updated. Please try again."); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const suggestions = pages.filter(p => validTextLink(p.path) && !isInternalPath(p.path) && (!address || p.name.toLowerCase().includes(address.toLowerCase()) || p.path.toLowerCase().includes(address.toLowerCase()))).slice(0, 12);
  const content = <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} className="min-w-0 space-y-2" aria-label="Edit Link Destination">
    <div className="space-y-1"><label htmlFor="review-link-address" className="text-sm">New Destination</label>
      <Input id="review-link-address" className="h-11 text-sm sm:h-8" value={address} aria-invalid={!valid || !!error} aria-describedby={!valid || destinationHint ? "review-link-hint" : error ? "review-link-error" : undefined} disabled={saving}
        onFocus={() => setSuggesting(true)} onChange={e => { setAddress(e.target.value); setSuggesting(true); if (resolved) setError(""); }} onKeyDown={e => { if (e.key === "Escape") setSuggesting(false); }} />
      {destinationHint && <p id="review-link-hint" role="status" className="text-xs text-muted-foreground">{destinationHint}</p>}
      <div aria-live="polite"><ReviewRiskFlags flags={hostWarnings(destination.trim(), knownDomains, trustedDomains)} onJump={() => {}} /></div>
      {suggesting && suggestions.length > 0 && <div aria-label="Page Suggestions" className="max-h-48 overflow-y-auto overscroll-contain border bg-popover p-1">{suggestions.map(p => <Button type="button" key={p.path} variant="ghost" className="h-auto min-h-11 sm:min-h-8 w-full justify-start whitespace-normal break-words text-left" disabled={saving} onMouseDown={e => e.preventDefault()} onClick={() => { setAddress(p.path); setSuggesting(false); if (resolved) setError(""); }}>{p.name}</Button>)}</div>}
    </div>
    {valid && <Button asChild variant="ghost" size="icon" className="h-11 w-11"><a aria-label="Open New Destination in New Tab" title="Open New Destination in New Tab" href={destination.startsWith("/") ? draftPageUrl(destination, embed) ?? undefined : destination} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden /></a></Button>}
    {finding && <span role="status" aria-label="Loading"><Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none text-muted-foreground" /></span>}
    {error && resolved && <p id="review-link-error" role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {!finding && !resolved && <><p role="status" className="text-sm">{resolutionHint}</p><Button type="button" className="h-auto min-h-11 whitespace-normal px-2 text-sm sm:h-8 sm:min-h-8 [&_svg]:h-3 [&_svg]:w-3" onClick={() => { walk.update(s => ({ ...s, reviewEdit: null })); void fallback(edit.link, edit.group, edit.rows, edit.fingerprint); }}><Pencil className="h-4 w-4" aria-hidden />Open in Manual Edit</Button></>}
    {resolved?.element.originalHref && <div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="link" className="h-auto min-h-11 w-full whitespace-normal px-1 text-xs" disabled={saving || !resolved.element.originalHref} onClick={() => void reset("restore")}><Undo2 aria-hidden />Restore Original Link</Button>
      <Button type="button" variant="link" className="h-auto min-h-11 w-full whitespace-normal px-1 text-xs text-destructive" disabled={saving || removed || !resolved.element.originalHref} onClick={() => setConfirmRemove(true)}><Unlink aria-hidden />Remove Link</Button>
    </div>}
    <div className="grid grid-cols-2 gap-2">{(finding || resolved) && <Button type="button" className="h-11 w-full whitespace-nowrap px-2 text-sm" disabled={!resolved || saving || !valid} onClick={() => void save()}><Save className="h-4 w-4" aria-hidden />{saving ? "Saving…" : "Save"}</Button>}<Button type="button" variant="outline" className="h-11 w-full whitespace-nowrap px-2 text-sm" disabled={saving} onClick={cancel}><X className="h-4 w-4" aria-hidden />Cancel</Button></div>
    <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove Link</AlertDialogTitle><AlertDialogDescription>Remove this link: “{publicLinkAddress(linkText(edit.link, pages))}”? The text stays on the page but it will no longer be clickable. You can restore the original link later.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-11">Cancel</AlertDialogCancel><AlertDialogAction className="h-11" onClick={() => void reset("remove")}>Remove Link</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
  return <div className="mt-2 border-t pt-2">{content}</div>;
}
