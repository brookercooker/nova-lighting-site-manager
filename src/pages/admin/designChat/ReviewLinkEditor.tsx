import { useEffect, useRef, useState } from "react";
import { Pencil, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { LINK_DESTINATION_ERROR, validTextLink } from "../textAdornment";
import { isInternalPath } from "./registerPage";
import { fixPage } from "./linkCheck";
import { useDesignChat } from "./DesignChatContext";
import { useManagerLayout } from "./useManagerLayout";
import { useChangeLink } from "./linkFix";
import { walk, useWalk } from "./submitWalkthroughStore";
import { resolveReviewLink, saveReviewLink, FIND_LINK_ERROR, type ResolvedReviewLink } from "./reviewLinkSave";
import type { ManagerPage } from "./submitWalkthrough";
import { publicLinkAddress } from "../linkDisplay";

/** One local draft per panel opening; native field undo remains local until the explicit save. */
export function ReviewLinkEditor({ pages }: { pages: ManagerPage[] }) {
  const s = useWalk();
  const edit = s.reviewEdit;
  return edit ? <ReviewLinkForm key={edit.link.key} edit={edit} pages={pages} /> : null;
}
function ReviewLinkForm({ edit, pages }: { edit: NonNullable<ReturnType<typeof useWalk>["reviewEdit"]>; pages: ManagerPage[] }) {
  const { phone } = useManagerLayout();
  const { preview } = useDesignChat();
  const fallback = useChangeLink();
  const [address, setAddress] = useState(publicLinkAddress(edit.link.href));
  const [blank, setBlank] = useState(false);
  const [resolved, setResolved] = useState<ResolvedReviewLink | null>(null);
  const [finding, setFinding] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const page = fixPage(edit.group, edit.rows);
  const embed = preview?.frames.find(f => f.id === preview.shownId)?.url;
  const savingRef = useRef(false);
  useEffect(() => {
    let active = true;
    void resolveReviewLink(page.path, edit.link.href, edit.link.label, embed).then(r => {
      if (active) { setResolved(r); setBlank(r.blank); setFinding(false); }
    }).catch(e => { if (active) { setError(e instanceof Error ? e.message : FIND_LINK_ERROR); setFinding(false); } });
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
      walk.savedLink(page.path, { key: `${edit.group.page?.path ?? ""}|${destination}`, href: destination, kind, label: edit.link.label, requestIds: [], status: null });
      const { notifyContentEdited } = await import("./contentSync");
      notifyContentEdited(lines);
    } catch (e) { setError(e instanceof Error ? e.message : "Your new link couldn't be saved. Please try again."); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const suggestions = pages.filter(p => validTextLink(p.path) && !isInternalPath(p.path) && (!address || p.name.toLowerCase().includes(address.toLowerCase()) || p.path.toLowerCase().includes(address.toLowerCase()))).slice(0, 12);
  const content = <div className="min-w-0 space-y-2" aria-label="Edit Link Destination">
    <div><p className="text-xs text-muted-foreground">Current Destination</p><p className="break-all font-mono text-sm">{publicLinkAddress(resolved?.href ?? edit.link.href)}</p></div>
    <div className="space-y-1"><label htmlFor="review-link-address" className="text-sm">New Destination</label>
      <Input id="review-link-address" className="h-11 text-sm sm:h-8" value={address} aria-invalid={!!error} aria-describedby={error ? "review-link-error" : undefined} disabled={saving}
        onFocus={() => setSuggesting(true)} onChange={e => { setAddress(e.target.value); setSuggesting(true); if (resolved) setError(""); }} onKeyDown={e => { if (e.key === "Escape") setSuggesting(false); }} />
      {suggesting && suggestions.length > 0 && <div aria-label="Page Suggestions" className="max-h-48 overflow-y-auto overscroll-contain border bg-popover p-1">{suggestions.map(p => <Button type="button" key={p.path} variant="ghost" className="h-auto min-h-11 sm:min-h-8 w-full justify-start whitespace-normal break-words text-left" disabled={saving} onMouseDown={e => e.preventDefault()} onClick={() => { setAddress(p.path); setSuggesting(false); if (resolved) setError(""); }}>{p.name}</Button>)}</div>}
    </div>
    <label className="flex min-h-11 sm:min-h-8 items-center justify-between gap-3 text-sm">Open in New Tab<Switch aria-label="Open in New Tab" checked={blank} disabled={!resolved || saving} onCheckedChange={setBlank} /></label>
    {finding && <p role="status" className="text-sm text-muted-foreground">Finding the link on this page…</p>}
    {error && <p id="review-link-error" role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {!finding && !resolved && <><p role="status" className="text-sm">Saving here isn't available yet for this link; Open in Manual Edit</p><Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal px-2 text-sm sm:h-8 sm:min-h-8 [&_svg]:h-3 [&_svg]:w-3" onClick={() => { walk.update(s => ({ ...s, reviewEdit: null })); void fallback(edit.link, edit.group, edit.rows, edit.fingerprint); }}><Pencil className="h-4 w-4" aria-hidden />Open in Manual Edit</Button></>}
    <div className="grid grid-cols-2 gap-1.5"><Button type="button" className="h-auto min-h-11 whitespace-normal px-2 text-sm sm:h-8 sm:min-h-8 [&_svg]:h-3 [&_svg]:w-3" disabled={!resolved || saving} onClick={() => void save()}><Save className="h-4 w-4" aria-hidden />{saving ? "Saving…" : "Save New Link"}</Button><Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal px-2 text-sm sm:h-8 sm:min-h-8 [&_svg]:h-3 [&_svg]:w-3" disabled={saving} onClick={cancel}><X className="h-4 w-4" aria-hidden />Cancel</Button></div>
  </div>;
  return phone ? <Sheet open onOpenChange={o => { if (!o) cancel(); }}><SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto overflow-x-hidden"><SheetHeader className="mb-2"><SheetTitle>Edit Link Destination</SheetTitle><SheetDescription>{page.name}</SheetDescription></SheetHeader>{content}</SheetContent></Sheet>
    : <div className="mt-2 border-t pt-2">{content}</div>;
}