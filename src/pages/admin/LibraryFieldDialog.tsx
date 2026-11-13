import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LibraryFieldDialog({ title, value, multiline, onSave, onClose }: {
  title: string; value: string; multiline?: boolean; onSave: (value: string) => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent aria-describedby={undefined} className="max-w-md"><DialogTitle>{title}</DialogTitle>
    {multiline ? <textarea aria-label="Description" value={draft} onChange={e => setDraft(e.target.value)} className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm" /> : <Input aria-label="Name" value={draft} onChange={e => setDraft(e.target.value)} className="h-11" />}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="outline" className="h-11" disabled={saving} onClick={onClose}>Cancel</Button><Button className="h-11" disabled={saving || (!multiline && !draft.trim())} onClick={async () => { setSaving(true); setError(""); try { await onSave(multiline ? draft : draft.trim()); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save. Try again."); } finally { setSaving(false); } }}>Save</Button></div>
  </DialogContent></Dialog>;
}