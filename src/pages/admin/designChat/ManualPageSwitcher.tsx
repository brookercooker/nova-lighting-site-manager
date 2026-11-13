import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useDesignChat } from "./DesignChatContext";
import { useEditorSlot } from "./EditorSlot";
import { loadManualPages, workingPageFrom } from "./pageSelection";
import { manualPageAtPath, type ManualPage } from "./manualPageNavigation";

/** Both the header and the trusted edit-frame callback use this one guarded switch. */
export function useManualPageNavigation(finishing: boolean, setFinishing: (value: boolean) => void) {
  const chat = useDesignChat();
  const { hasChanges, saveAll, discardAll } = useEditorSlot();
  const [pages, setPages] = useState<ManualPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<ManualPage | null>(null);
  const busy = useRef(false);
  const disabled = !!chat.objectOpen || finishing;
  useEffect(() => {
    if (!chat.editing) return;
    let stale = false;
    setLoading(true); setFailed(false);
    void loadManualPages().then(rows => { if (!stale) setPages(rows); }).catch(() => { if (!stale) setFailed(true); }).finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [chat.editing]);
  const switchTo = useCallback((page: ManualPage) => {
    chat.selectPage(workingPageFrom(page));
    chat.startEditing();
    setPending(null);
  }, [chat.selectPage, chat.startEditing]);
  const requestPage = (page: ManualPage) => {
    if (disabled || busy.current || pending || page.id === chat.workingPage?.id) return;
    if (hasChanges()) setPending(page);
    else switchTo(page);
  };
  const requestPath = (path: string) => {
    if (disabled || busy.current || pending) return;
    const page = manualPageAtPath(pages, path);
    if (!page) { toast("That page isn't in the Site Manager."); return; }
    requestPage(page);
  };
  const resolve = async (save: boolean) => {
    if (!pending || disabled || busy.current) return;
    busy.current = true; setFinishing(true);
    try {
      if (save) { if (!await saveAll()) return; }
      else await discardAll();
      switchTo(pending);
    } catch { /* The editor reports save/restoration errors; keep the current page open. */ }
    finally { busy.current = false; setFinishing(false); }
  };
  return { pages, loading, failed, disabled, pending, setPending, requestPage, requestPath, resolve };
}

type Navigation = ReturnType<typeof useManualPageNavigation>;
export default function ManualPageSwitcher({ navigation }: { navigation: Navigation }) {
  const { workingPage } = useDesignChat();
  const { disabled, pending } = navigation;
  return <>
    <Dialog open={!!pending} onOpenChange={value => { if (!value && !disabled) navigation.setPending(null); }}>
      <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-2xl">
        <DialogHeader><DialogTitle>You have unsaved changes</DialogTitle><DialogDescription>You have unsaved edits on {workingPage?.name}. Save them before going to the next page?</DialogDescription></DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-nowrap sm:justify-start sm:space-x-0">
          <Button className="gap-2" disabled={disabled} onClick={() => void navigation.resolve(true)}><Save className="h-4 w-4" aria-hidden />Save Changes</Button>
          <Button className="gap-2" variant="outline" disabled={disabled} onClick={() => void navigation.resolve(false)}><Trash2 className="h-4 w-4" aria-hidden />Discard Changes</Button>
          <Button className="gap-2" variant="outline" disabled={disabled} onClick={() => navigation.setPending(null)}><Pencil className="h-4 w-4" aria-hidden />Return to Edit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}