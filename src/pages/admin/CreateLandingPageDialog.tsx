import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/prototype/client";
import { toRouteSlug } from "./slug";
import { localDateToIso, landingScheduleCheck } from "@/lib/landingDates";
import { notifyContentEdited } from "./designChat/contentSync";
import { pageChangeNote } from "./contentChangeNotes";


/**
 * Wizard for registering a Landing Page.
 *
 * This tool never builds the page itself — it only registers the row and hands the
 * marketing manager a copy-paste prompt to paste into the Lovable chat on the second
 * monitor. On successful create we swap to a success panel with instructions + prompt.
 */
export default function CreateLandingPageDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [alwaysOn, setAlwaysOn] = useState(true);
  const [takenPaths, setTakenPaths] = useState<Set<string>>(new Set());
  const [takenNames, setTakenNames] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setStartDate(""); setStartTime(""); setEndDate(""); setEndTime("");
      setAlwaysOn(true);
      return;
    }
    (async () => {
      const { data } = await (supabase as any).from("pages").select("path,name");
      setTakenPaths(new Set((data ?? []).map((p: any) => (p.path ?? "").toLowerCase())));
      setTakenNames(new Set((data ?? []).map((p: any) => (p.name ?? "").trim().toLowerCase())));
    })();
  }, [open]);

  const slug = useMemo(() => toRouteSlug(name), [name]);
  const path = slug ? `/landing/${slug}` : "";
  const dupe = !!path && takenPaths.has(path.toLowerCase());
  const dupeName = !!name.trim() && takenNames.has(name.trim().toLowerCase());
  const startAt = localDateToIso(startDate, startTime);
  const endAt = alwaysOn ? null : localDateToIso(endDate, endTime);
  const schedule = landingScheduleCheck(startAt, endAt, alwaysOn);
  const valid = !!slug && !dupe && !dupeName && !schedule.invalidOrder;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const payload: any = {
        name: name.trim(),
        path,
        description: "",
        notes: "",
        tags: [],
        page_type: "landing",
        build_status: "draft",
        start_at: startAt,
        end_at: endAt,
      };
      const { error } = await (supabase as any).from("pages").insert(payload);
      if (error) throw error;
      notifyContentEdited([pageChangeNote("Added", payload)]);
      toast.success(`Landing page "${name}" registered`);
      onCreated?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create landing page");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Landing Page</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer Sale 2026" autoFocus />
          </div>
          <div className="text-xs">
            <div className="text-muted-foreground mb-1">Path (Auto)</div>
            <div className={`font-mono px-2 py-1.5 rounded border ${dupe ? "border-destructive text-destructive" : "bg-muted/40"}`}>
              {path || <span className="opacity-60">—</span>}
            </div>
            {dupe && <p className="text-destructive mt-1">A page already exists at {path}.</p>}
            {dupeName && (
              <p className="text-destructive mt-1">
                A page named "{name.trim()}" already exists. Please choose a different name.
              </p>
            )}
            {!!name && !slug && <p className="text-destructive mt-1">Name must contain at least one letter or number.</p>}
          </div>


          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Start Date (Optional)</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Time</label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="—" />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">End Date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={alwaysOn} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Time</label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={alwaysOn} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">Dates use your local time. Leave time blank for an all-day date.</p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={alwaysOn} onChange={(e) => setAlwaysOn(e.target.checked)} />
            Always on (No End Date)
          </label>
          {schedule.invalidOrder && <p role="alert" className="text-sm text-destructive">The end date has to be after the start date.</p>}
          {schedule.expired && <p role="status" className="text-sm text-muted-foreground">These dates are in the past. This page will be expired as soon as it is created.</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!valid || saving}>
              {saving ? "Creating…" : "Create Landing Page"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

