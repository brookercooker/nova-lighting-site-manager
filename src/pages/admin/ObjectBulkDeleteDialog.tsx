import { useState } from "react";
import { toast } from "sonner";
import ConfirmDialog from "./ConfirmDialog";
import InUseWarning from "./InUseWarning";
import type { ObjectRegistryRow } from "./useObjectRegistry";
import type { ObjectUsage } from "./objectUsages";

/** Reuse the single-object mutation and its usage warning; never skip protected targets. */
export default function ObjectBulkDeleteDialog({ targets, onClose, usagesFor, remove, onDeleted }: {
  targets: ObjectRegistryRow[]; onClose: () => void; usagesFor: (o: ObjectRegistryRow) => ObjectUsage[];
  remove: (id: string) => Promise<unknown>; onDeleted: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const blocked = targets.some(o => o.site_wide);
  const confirm = async () => {
    if (!targets.length || blocked || saving) return;
    setSaving(true);
    try {
      for (const o of targets) { await remove(o.id); onDeleted(o.id); }
      toast.success(`Deleted ${targets.length} object${targets.length === 1 ? "" : "s"}`);
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Delete failed"); }
    finally { setSaving(false); }
  };
  return <ConfirmDialog open={targets.length > 0} onOpenChange={open => { if (!open && !saving) onClose(); }}
    title={`Delete ${targets.length} object${targets.length === 1 ? "" : "s"}?`}
    description={<div className="space-y-2">
      <InUseWarning items={targets.map(o => ({ label: o.name, usages: usagesFor(o) }))} />
      <p>This cannot be undone. No archive fallback, no undo toast.</p>
      <p className="break-words">{targets.map(o => o.name).join(", ")}</p>
      {blocked && <p role="alert">Site-wide objects cannot be deleted. Remove them from the selection.</p>}
      {targets.some(o => o.component_key) && <p>Coded objects may still be imported and rendered on the site.</p>}
    </div>} confirmLabel="Delete" confirmDisabled={blocked} keepOpenOnConfirm busy={saving} onConfirm={() => void confirm()} />;
}