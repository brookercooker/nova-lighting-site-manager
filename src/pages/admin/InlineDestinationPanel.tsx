import { useEffect, useRef, useState } from "react";
import { Link as LinkIcon, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { detectLinkKind, linkAddress, type LinkKind } from "./linkKind";
import { isInternalPath } from "./designChat/registerPage";
import { originalLink, validLinkHref, type InlineEdits, type LinkEdit } from "@/lib/inlineEditCore";
import type { InlineSelection } from "@/components/InlineEditSurface";
import { ToolField, ToolGroup } from "./designChat/ToolPanel";
import { validTextLink } from "./textAdornment";
import { useWalk } from "./designChat/submitWalkthroughStore";

const ERROR = "That address isn't allowed. Use a web address starting with https://, a page path starting with /, mailto:, tel: or #.";

export default function InlineDestinationPanel({ selection, editsFor, onChange, pages, embedded = false, linkKnown }: {
  selection: InlineSelection | null;
  editsFor: (scope: string) => InlineEdits;
  onChange: (scope: string, next: InlineEdits) => void;
  pages: { id: string; name: string; path: string }[];
  embedded?: boolean;
  /** Whether the frame reported the element that really holds the link (selection.link); defaults to selection.link being set. */
  linkKnown?: boolean;
}) {
  const target = selection?.link;
  const edits = target ? editsFor(target.scope) : {};
  const key = target ? `link:${target.key}` : "";
  const value = edits[key];
  let edit: LinkEdit | undefined;
  try { edit = value ? JSON.parse(value) : undefined; } catch { /* Invalid stored edits remain available for repair. */ }
  const original = target ? originalLink(target.el) : { href: null, target: null };
  const destination = edit?.unlinked ? "" : edit?.href ?? original.href ?? "";
  const blank = edit ? edit.target === "_blank" : original.target === "_blank";
  const [address, setAddress] = useState(destination);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LinkKind>(() => detectLinkKind(destination));
  const [pageSearch, setPageSearch] = useState("");
  const addressRef = useRef<HTMLInputElement>(null);
  const fix = useWalk().fix;
  useEffect(() => { setAddress(destination); setError(""); }, [destination, target?.scope, target?.key]);
  useEffect(() => { setKind(detectLinkKind(destination)); }, [destination]);
  if (!target) return null;
  const allowed = embedded ? validTextLink : validLinkHref;
  const save = (href: string, newTab = blank) => {
    if (!allowed(href)) { setError(embedded ? "Use https://, mailto:, tel: or a site path starting with a single /." : ERROR); return; }
    setError(""); setAddress(href);
    onChange(target.scope, { ...edits, [key]: JSON.stringify({ href, ...(newTab ? { target: "_blank" } : {}) }) });
  };
  const apply = () => {
    if (address === destination && !error) return;
    if (embedded && !address) { setError(""); onChange(target.scope, { ...edits, [key]: JSON.stringify({ unlinked: true }) }); return; }
    save(address);
  };
  const missing = !!fix && !(linkKnown ?? !!selection?.link) && !destination && !edit
    ? <p data-link-fix-hint className="text-xs text-muted-foreground">This text has no link of its own. The link to {fix.address} may be on the card or button around it, which can't be selected here yet.</p> : null;
  const content = <>{missing}
    <div className="relative space-y-1" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><label htmlFor="link-address">Link Address</label><span>{!address ? "None" : kind === "email" ? "Email" : kind === "phone" ? "Phone" : kind === "page" ? `Page: ${pages.find(p => p.path === address)?.name ?? address}` : "Web Address"}</span></div>
      <Input ref={addressRef} id="link-address" aria-label="Link Address" aria-expanded={open} type={kind === "email" ? "email" : kind === "phone" ? "tel" : "text"} value={kind === "email" || kind === "phone" ? address.replace(/^(mailto:|tel:)/i, "") : address} placeholder={embedded && !destination ? "None" : kind === "email" ? "name@example.com" : kind === "phone" ? "Phone number" : "https://"} aria-invalid={!!error}
        onPointerDown={() => setOpen(true)} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={(e) => { setAddress(linkAddress(kind, e.target.value)); setError(""); }} onBlur={apply}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); setOpen(false); } if (e.key === "Escape") setOpen(false); }} />
      {open && <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md" aria-label="Link Address Options">
        <Button type="button" variant={!destination ? "secondary" : "ghost"} aria-pressed={!destination} size="sm" className="w-full justify-start" onMouseDown={e => e.preventDefault()} onClick={e => { e.preventDefault(); e.stopPropagation(); setAddress(""); setError(""); setOpen(false); onChange(target.scope, { ...edits, [key]: JSON.stringify({ unlinked: true }) }); }}>None</Button>
        {([["web", "Web Address"], ["page", "Choose a Page"], ["email", "Email"], ["phone", "Phone"]] as const).map(([value, label]) => <Button key={value} type="button" variant={kind === value ? "secondary" : "ghost"} size="sm" className="w-full justify-start" onMouseDown={e => e.preventDefault()} onClick={e => { e.preventDefault(); e.stopPropagation(); setKind(value); if (value !== "page") { setAddress(value === detectLinkKind(address) ? address : ""); addressRef.current?.focus(); setOpen(false); } }}>{label}</Button>)}
        {kind === "page" && <div className="border-t pt-1"><Input aria-label="Find a Page" placeholder="Find a page" value={pageSearch} onChange={e => setPageSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} />{pages.filter(p => validLinkHref(p.path) && !isInternalPath(p.path) && p.name.toLowerCase().includes(pageSearch.toLowerCase())).map(p => <Button key={p.id} type="button" variant="ghost" size="sm" className="w-full justify-start" onMouseDown={e => e.preventDefault()} onClick={e => { e.preventDefault(); e.stopPropagation(); save(p.path); setOpen(false); }}>{p.name}</Button>)}</div>}
      </div>}
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <label className="flex items-center justify-between gap-2 text-xs">Open in New Tab
      <Switch checked={blank} disabled={!allowed(address) || !!edit?.unlinked} onCheckedChange={(on) => save(address, on)} />
    </label>
    <div className="flex flex-wrap gap-2">
      {value !== undefined && <Button type="button" size="sm" variant="ghost" onClick={() => {
        const next = { ...edits }; delete next[key]; onChange(target.scope, next);
      }}><Undo2 className="mr-1 h-3.5 w-3.5" />Restore Original Link</Button>}
    </div>
  </>;
  return embedded ? <div className="space-y-3">{content}</div> : <ToolGroup title="Link" icon={LinkIcon} defaultOpen>{content}</ToolGroup>;
}