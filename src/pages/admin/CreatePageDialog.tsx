import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/prototype/client";
import { toRouteSlug } from "./slug";
import { reservedPrefixFor } from "./reservedPaths";
import { notifyContentEdited } from "./designChat/contentSync";
import { pageChangeNote } from "./contentChangeNotes";

/**
 * Guided add-page flow.
 * - Live-normalizes the name to a Lovable-friendly slug and shows the resulting route.
 * - Checks the pages table for duplicate slugs before submit.
 * - On save, inserts a Draft; public availability requires Ready and publishing.
 */
export default function CreatePageDialog({
  open, onOpenChange, initialName, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialName?: string;
  onCreated?: (page: { id: string; slug_id: string; path: string; name: string }) => void;
}) {
  const [name, setName] = useState("");
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [takenNames, setTakenNames] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName ?? "");
    (async () => {
      const { data } = await (supabase as any).from("pages").select("path,name");
      setTaken(new Set((data ?? []).map((p: any) => (p.path ?? "").toLowerCase())));
      setTakenNames(new Set((data ?? []).map((p: any) => (p.name ?? "").trim().toLowerCase())));
    })();
  }, [open, initialName]);

  const slug = useMemo(() => toRouteSlug(name), [name]);
  const route = slug ? `/${slug}` : "";
  const dupe = route && taken.has(route.toLowerCase());
  const dupeName = !!name.trim() && takenNames.has(name.trim().toLowerCase());
  const reserved = route ? reservedPrefixFor(route) : null;
  const valid = !!slug && !dupe && !dupeName && !reserved;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).from("pages").insert({
        name: name.trim(), path: route, description: "", notes: "", tags: [], build_status: "draft",
      }).select("id,slug_id,path,name").single();
      if (error) throw error;
      notifyContentEdited([pageChangeNote("Added", data)]);
      toast.success(`Created "${data.name}" as a Draft at ${data.path}. It goes live once it's marked Ready and published.`);
      onCreated?.(data);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create page");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add a Static Page</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Give your page a name and we'll create it for you — you can add its
            content next. It starts as a Draft and goes live once it's marked Ready and published.
          </p>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Page Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New Arrivals" autoFocus />
          </div>
          <div className="text-xs">
            <div className="text-muted-foreground mb-1">Page Address</div>
            <div className={`font-mono px-2 py-1.5 rounded border ${(dupe || reserved) ? "border-destructive text-destructive" : "bg-muted/40"}`}>
              {route ? `yoursite.com${route}` : <span className="opacity-60">—</span>}
            </div>
            {dupe && !dupeName && <p className="text-xs text-destructive mt-1">A page with this address already exists.</p>}
            {dupeName && (
              <p className="text-xs text-destructive mt-1">
                A page named "{name.trim()}" already exists. Please choose a different name.
              </p>
            )}
            {reserved && (
              <p className="text-xs text-destructive mt-1">
                That name isn't available — please choose a different one.
              </p>
            )}
            {!!name && !slug && <p className="text-xs text-destructive mt-1">Please use at least one letter or number.</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!valid || saving}>
              {saving ? "Creating…" : "Create Page"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
