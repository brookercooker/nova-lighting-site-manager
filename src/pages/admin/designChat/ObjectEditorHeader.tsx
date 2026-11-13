import { useState } from "react";
import { ArrowLeft, Pencil, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useEditorSlot } from "./EditorSlot";
import { objectEditorNote, type ObjectEditTarget } from "../framedPageProtocol";

export type ObjectInfo = ObjectEditTarget & { usedOn: string[] };

/** The page this object is a page-only copy for ("<name> (<page>)" used on exactly that page), else null. */
export function copyPageOf(info: ObjectInfo): string | null {
  return info.usedOn.length === 1 && info.name.endsWith(` (${info.usedOn[0]})`) ? info.usedOn[0] : null;
}

/** Left-panel header while one object is open: Back to <page>, Editing <name>, and what kind of object it is. */
export default function ObjectEditorHeader({ info, backLabel, disabled, onLeave }: {
  info: ObjectInfo | null; backLabel: string; disabled: boolean; onLeave: () => void;
}) {
  const { hasChanges, saveAll, discardAll } = useEditorSlot();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const leave = () => { if (hasChanges()) setAsking(true); else onLeave(); };
  const resolve = async (save: boolean) => {
    setBusy(true);
    try {
      if (save) { if (!await saveAll()) return; } else await discardAll();
      setAsking(false); onLeave();
    } finally { setBusy(false); }
  };
  const name = info?.siteWide ? (info.component_key === "Footer" ? "Site Footer" : "Site Header") : info?.name ?? "Object";
  return <>
    <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={leave} className="h-7 w-fit gap-1.5 px-1 text-xs text-muted-foreground">
      <ArrowLeft className="h-3 w-3" aria-hidden />{backLabel}
    </Button>
    <h2 tabIndex={-1} className="truncate px-1 text-lg font-semibold">Editing {name}</h2>
    {info && <p className="px-1 text-xs text-muted-foreground">{objectEditorNote(info, info.usedOn, copyPageOf(info))}</p>}
    <Dialog open={asking} onOpenChange={(v) => { if (!v && !busy) setAsking(false); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save Your Changes?</DialogTitle><DialogDescription>You have unsaved edits on {name}. Save them before you go back?</DialogDescription></DialogHeader>
        <DialogFooter className="flex-row flex-wrap justify-start gap-2 sm:justify-start sm:space-x-0">
          <Button className="gap-2" disabled={busy} onClick={() => void resolve(true)}><Save className="h-4 w-4" aria-hidden />Save Changes</Button>
          <Button className="gap-2" variant="outline" disabled={busy} onClick={() => void resolve(false)}><Trash2 className="h-4 w-4" aria-hidden />Discard Changes</Button>
          <Button className="gap-2" variant="outline" disabled={busy} onClick={() => setAsking(false)}><Pencil className="h-4 w-4" aria-hidden />Return to Edit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
