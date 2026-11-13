import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2, SlidersHorizontal, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDesignChat } from "./DesignChatContext";
import { useManagerLayout } from "./useManagerLayout";
import { loadManualPages } from "./pageSelection";
import type { WorkingPage } from "./DesignChatContext";
import { MANIFEST_CHANGED } from "../siteManifest";
import { CONTENT_SAVED } from "./contentSync";
import { publicPreviewPage } from "./publicPreviewUrl";

/** Presentation-only controls over the retained preview and the existing guarded editor. */
export default function PreviewToolbar({ onManualNavigate, manualDisabled = false }: { onManualNavigate: (path: string) => void; manualDisabled?: boolean }) {
  const chat = useDesignChat();
  const { phone } = useManagerLayout();
  const [pages, setPages] = useState<WorkingPage[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stale = false;
    const load = () => { void loadManualPages().then(rows => { if (!stale) { setPages(rows); setFailed(false); } }).catch(() => { if (!stale) setFailed(true); }); };
    load();
    window.addEventListener(MANIFEST_CHANGED, load); window.addEventListener(CONTENT_SAVED, load);
    return () => { stale = true; window.removeEventListener(MANIFEST_CHANGED, load); window.removeEventListener(CONTENT_SAVED, load); };
  }, []);
  const destination = !chat.editing ? chat.previewDestination : null;
  const path = chat.editing ? chat.workingPage?.path ?? "/" : destination?.split("?")[0] ?? chat.previewLocation?.path ?? chat.workingPage?.path ?? "/";
  const search = destination ? (destination.includes("?") ? destination.slice(destination.indexOf("?")) : "") : chat.previewLocation?.search ?? "";
  const current = pages.find(page => page.path === path || (path === "/home" && page.path === "/"));
  const name = current?.name ?? (chat.workingPage?.path === path ? chat.workingPage.name : path);
  const manualIndex = pages.findIndex(page => page.path === path);
  const backPage = pages[manualIndex - 1];
  const forwardPage = manualIndex >= 0 ? pages[manualIndex + 1] : undefined;
  const choose = (value: string) => {
    if (chat.editing) { onManualNavigate(value); return; }
    const page = pages.find(p => p.path === value);
    if (page) chat.selectPage(page);
  };
  const reload = () => {
    if (chat.editing) window.dispatchEvent(new Event("nova-manager-reload-editor"));
    else chat.preview.retry();
  };
  let href: string | undefined;
  try {
    const base = chat.state?.liveUrl;
    if (base) href = publicPreviewPage(base, path + (!chat.editing ? search : ""));
  } catch { /* No usable public address yet. */ }
  const fullLabel = chat.inFull ? "Exit Full Screen" : "Full Screen";
  const FullIcon = chat.inFull ? Minimize2 : Maximize2;
  return <div role="toolbar" aria-label="Preview Toolbar" className="grid h-10 min-w-0 shrink-0 grid-cols-[4.25rem_minmax(0,1fr)_4.25rem] items-center gap-1 border-b bg-background px-2">
    <div className="flex shrink-0 gap-0.5">
      {chat.editing ? <div data-preview-nav className="flex shrink-0 gap-0.5">
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back" title="Back" disabled={manualDisabled || !backPage} onClick={() => { if (backPage) onManualNavigate(backPage.path); }}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Forward" title="Forward" disabled={manualDisabled || !forwardPage} onClick={() => { if (forwardPage) onManualNavigate(forwardPage.path); }}><ChevronRight className="h-4 w-4" /></Button>
      </div> : chat.previewNav && <div data-preview-nav className="flex shrink-0 gap-0.5">
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back" title="Back" onClick={chat.previewNav.back} disabled={!chat.previewNav.canBack}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Forward" title="Forward" onClick={chat.previewNav.forward} disabled={!chat.previewNav.canForward}><ChevronRight className="h-4 w-4" /></Button>
      </div>}
    </div>
    <div className={phone ? "flex min-w-0 justify-center" : "grid min-w-0 grid-cols-[2rem_minmax(0,16rem)_2rem] justify-center"}>
      {!phone && <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Reload Preview" title="Reload Preview" onClick={reload}><RotateCw className="h-4 w-4" /></Button>}
    <Select value={current?.path ?? path} onValueChange={choose}>
      <SelectTrigger aria-label="Preview Page" disabled={chat.editing && manualDisabled} className="h-8 w-64 min-w-0 max-w-full gap-2 border-0 bg-transparent text-xs shadow-none"><SelectValue>{name}</SelectValue></SelectTrigger>
      <SelectContent>{!current && <SelectItem value={path}>{name}</SelectItem>}{pages.map(page => <SelectItem key={page.path} value={page.path}>{page.name} <span className="text-muted-foreground">{page.path}</span></SelectItem>)}{failed && <p role="alert" className="px-2 py-1 text-xs text-destructive">Couldn't load pages. Reopen the preview to try again.</p>}</SelectContent>
    </Select>
    </div>
    <div className="flex shrink-0 items-center justify-end gap-0.5">
    {phone ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Preview Options" title="Preview Options"><SlidersHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={reload}><RotateCw className="mr-2 h-4 w-4" />Reload Preview</DropdownMenuItem>
      <DropdownMenuItem onSelect={chat.toggleFull}><FullIcon className="mr-2 h-4 w-4" />{fullLabel}</DropdownMenuItem>
      {href && <DropdownMenuItem asChild><a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open Page in New Tab</a></DropdownMenuItem>}
    </DropdownMenuContent></DropdownMenu> : <>
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={fullLabel} title={fullLabel} onClick={chat.toggleFull}><FullIcon className="h-4 w-4" /></Button>
      {href && <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0"><a href={href} target="_blank" rel="noopener noreferrer" aria-label="Open Page in New Tab" title="Open Page in New Tab"><ExternalLink className="h-4 w-4" /></a></Button>}
    </>}
    </div>
  </div>;
}