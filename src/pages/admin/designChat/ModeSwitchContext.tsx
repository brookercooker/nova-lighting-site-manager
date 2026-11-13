import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Save, Trash2, Pencil } from "lucide-react";
import ConfirmDialog from "../ConfirmDialog";
import { useDesignChat } from "./DesignChatContext";
import { useEditorSlot } from "./EditorSlot";

type ModeSwitch = {
  requestChat: () => Promise<boolean>;
  requestManual: (open: () => void | Promise<void>) => Promise<boolean>;
};
const Context = createContext<ModeSwitch | null>(null);

/** Only pending confirmation lives here; the mode always comes from editing. */
export function ModeSwitchProvider({ children }: { children: ReactNode }) {
  const { editing, stopEditing, state } = useDesignChat();
  const { hasChanges, saveAll, discardAll } = useEditorSlot();
  const [pending, setPending] = useState<"chat" | "manual" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const openRef = useRef<(() => void | Promise<void>) | null>(null);
  const savingRef = useRef(false);
  const complete = (ok: boolean) => {
    setPending(null); setError("");
    resolveRef.current?.(ok); resolveRef.current = null; openRef.current = null;
  };
  const wait = (next: "chat" | "manual") => {
    if (resolveRef.current) return Promise.resolve(false);
    setPending(next); setError("");
    return new Promise<boolean>((resolve) => { resolveRef.current = resolve; });
  };
  const requestChat = async () => {
    if (!editing) return true;
    if (hasChanges()) return wait("chat");
    stopEditing(); return true;
  };
  const requestManual = async (open: () => void | Promise<void>) => {
    if (state?.busy || state?.publish?.status === "reviewing" || state?.approval) {
      if (resolveRef.current) return false;
      openRef.current = open;
      return wait("manual");
    }
    await open(); return true;
  };
  const saveAndSwitch = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      if (await saveAll()) { stopEditing(); complete(true); }
      else setError("Your edits couldn't be saved. You are still in Manual Edit Mode. Try saving again.");
    } catch {
      setError("Your edits couldn't be saved. You are still in Manual Edit Mode. Try saving again.");
    } finally { savingRef.current = false; setSaving(false); }
  };
  return (
    <Context.Provider value={{ requestChat, requestManual }}>
      {children}
      <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open && !savingRef.current) complete(false); }}
        title={pending === "chat" ? "You have unsaved changes" : state?.busy ? "A Chat Change Is Still in Progress" : "A Review Is Running"}
        description={<>{pending === "chat" ? "Save your edits before leaving Manual Edit Mode, discard them, or keep editing." : state?.busy ? "That change may affect this page. Continue editing by hand, or cancel and stay in Chat Mode." : <><p>{reviewedRequests(state?.draft?.requests, state?.publish?.open ?? 0)}</p><p className="mt-2">You can keep editing. Your edits are saved when you finish, and added to the site after this review is done.</p></>}{error && <p role="alert" className="mt-2 text-destructive">{error}</p>}</>}
        destructive={false} confirmLabel={pending === "chat" ? "Save Changes" : state?.busy ? "Continue Editing" : "Return to Edit"}
        cancelLabel={pending === "chat" ? "Return to Edit" : "Cancel"} busy={saving}
        secondaryLabel={pending === "chat" ? "Discard Changes" : undefined}
        confirmIcon={pending === "chat" ? <Save className="h-4 w-4" aria-hidden /> : undefined}
        secondaryIcon={pending === "chat" ? <Trash2 className="h-4 w-4" aria-hidden /> : undefined}
        primaryFirst={pending === "chat"}
        cancelIcon={pending === "chat" ? <Pencil className="h-4 w-4" aria-hidden /> : undefined}
        onSecondary={() => { void Promise.resolve(discardAll()).then(() => { stopEditing(); complete(true); }).catch(() => setError("Your original page couldn't be restored. You are still in Manual Edit Mode.")); }}
        onConfirm={() => {
          if (pending === "chat") void saveAndSwitch();
          else void Promise.resolve(openRef.current?.()).then(() => complete(true)).catch(() => { toast.error("Couldn't open this page for editing. Try again."); complete(false); });
        }} />
    </Context.Provider>
  );
}

export const useModeSwitch = () => useContext(Context);
function reviewedRequests(requests: { request: string }[] | undefined, count: number): string {
  const texts = (requests ?? []).map(r => r.request?.trim()).filter(Boolean);
  if (!texts.length) return count ? `${count} waiting ${count === 1 ? "change is" : "changes are"} being reviewed.` : "The waiting changes are being reviewed.";
  const more = Math.max(texts.length, count) - Math.min(2, texts.length);
  return `Being reviewed: ${texts.slice(0, 2).join("; ")}${more > 0 ? `; and ${more} more` : ""}.`;
}