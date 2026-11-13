import { addLibraryLabelFilter } from "./libraryLabels";
import LibraryFilterToolbar from "./LibraryFilterToolbar";
import LibraryListRow from "./LibraryListRow";
import { type LibraryFilters } from "./libraryFilters";
import { Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { matchesLabelFilter } from "./labelPath";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import InlineEdit from "./InlineEdit";
import {
  Search, AlertCircle, Archive, RotateCcw,
  Pencil, AlertTriangle, RefreshCw, ExternalLink, MoreHorizontal, Copy, Type,
  } from "lucide-react";
import { RenameDialog } from "./RenameDialog";
import { renameObject } from "./renameHelpers";
import { toast } from "sonner";
import { CopyRefButton, buildObjectRef } from "./copyReference";
import SelectionBar from "./SelectionBar";
import { type TimeRange } from "./FilterBar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useObjectRegistry,
  useArchivedObjects,
  useArchiveObject,
  useRestoreObject,

  useDeleteObjectPermanent,
  type ObjectRegistryRow,
} from "./useObjectRegistry";
import { objectRegistry } from "@/components/objects/registry";
import CreateObjectDialog from "./CreateObjectDialog";
import ConfirmDialog from "./ConfirmDialog";
import TagsPanel from "./TagsPanel";
import ObjectThumbnail from "./ObjectThumbnail";
import { requestObjectThumbnail } from "./objectThumbnailCapture";
import LabelsCell from "./LabelsCell";
import { supabase } from "@/prototype/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAutoCaptureThumbnails, regenerateThumbnail, isStale } from "./useThumbnailCapture";
import { type ObjectUsage } from "./objectUsages";
import { useObjectPageUsages } from "./useObjectPageUsages";
import InUseWarning from "./InUseWarning";

type SortKey = "newest" | "oldest" | "name" | "name_desc";
type Field = "all" | "name" | "id" | "path" | "description" | "tags";
const FIELDS: { v: Field; label: string }[] = [
  { v: "all", label: "All Fields" },
  { v: "name", label: "Name" },
  { v: "path", label: "Path" },
  { v: "description", label: "Description" },
  { v: "tags", label: "Labels" },
];

function fmtDateTime(iso: string) {
  if (!iso) return null;
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <>
      <div>{date}</div>
      <div>{time}</div>
    </>
  );
}
function fmtDateTimeFull(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  });
}




/**
 * Compact list-style tab for Objects.
 *
 * Performance model:
 *   - Never mount live Object components in the list. Each row shows a static
 *     thumbnail (cached via the shared serial iframe snapshot queue in
 *     routeSnapshot.ts, keyed off `/preview/object/{component_key}`).
 *   - Live rendering only happens on demand — one at a time — inside the
 *     preview dialog when the user clicks a row's thumbnail.
 *   - Search input is debounced via `useDeferredValue` so typing never blocks.
 */
export default function ObjectsTab() {
  const navigate = useNavigate();
  const { data: objects = [], isLoading } = useObjectRegistry();
  const { data: archived = [] } = useArchivedObjects();
  const archive = useArchiveObject();

  const deletePermanent = useDeleteObjectPermanent();
  const restore = useRestoreObject();
  const [usedFilter, setUsedFilter] = useState("all");
  const [listEditing, setListEditing] = useState(false);
  const [q, setQ] = useState("");
  const deferredQ = useDeferredValue(q);
  const [searchField, setSearchField] = useState<Field>("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<ObjectRegistryRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ObjectRegistryRow | null>(null);
  const [editReady, setEditReady] = useState<ObjectRegistryRow | null>(null);
  const [copyFrom, setCopyFrom] = useState<ObjectRegistryRow | null>(null);
  const [renameTarget, setRenameTarget] = useState<ObjectRegistryRow | null>(null);
  const [preview, setPreview] = useState<ObjectRegistryRow | null>(null);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();

  // Live "Used On" data comes from the object_page_usages table (updates
  // immediately as data changes) rather than the build-time code scan.
  // The hook also fires a background reconcile against the scan so the DB
  // catches up without a rebuild.
  const usageObjects = useMemo(
    () => objects.map((o) => ({ id: o.id, component_key: o.component_key })),
    [objects],
  );
  const { data: usageMap } = useObjectPageUsages(usageObjects);
  const usagesForObject = (o: ObjectRegistryRow): ObjectUsage[] =>
    (o.component_key && usageMap?.get(o.component_key)) || [];

  const isArchivedView = showArchived;

  const toggleSelected = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const bulkArchive = async (ids: string[]) => {
    setSelected(new Set());
    try {
      await Promise.all(ids.map((id) => archive.mutateAsync(id)));
      toast.success(`Archived ${ids.length} object${ids.length === 1 ? "" : "s"}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk archive failed");
    }
  };

  const usageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of objects) for (const t of o.labels ?? []) counts[t] = (counts[t] ?? 0) + 1;
    return counts;
  }, [objects]);

  const applyTagToObjects = async (ids: string[], tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || !ids.length) return;
    const targets = [...objects, ...archived].filter((o) => ids.includes(o.id));
    await Promise.all(targets.map((o) => {
      const next = Array.from(new Set([...(o.labels ?? []), t]));
      return (supabase as any).from("object_registry").update({ labels: next }).eq("id", o.id);
    }));
    qc.invalidateQueries({ queryKey: ["admin", "object_registry"] });
  };

  const updateObjectLabels = async (id: string, labels: string[]) => {
    const { error } = await (supabase as any)
      .from("object_registry").update({ labels }).eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["admin", "object_registry"] });
  };

  const updateObjectDescription = async (id: string, description: string) => {
    const { error } = await (supabase as any)
      .from("object_registry").update({ description }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Description saved");
    qc.invalidateQueries({ queryKey: ["admin", "object_registry"] });
  };

  // Auto-capture server-side thumbnails for objects. Capture uses the
  // DB-free preview route so headless screenshots never hit object_registry RLS
  // and accidentally store the public "No object" fallback.
  const captureCandidates = useMemo(() =>
    objects
      .filter((o) => o.thumbnail_url && o.component_key && !!objectRegistry[o.component_key])
      .map((o) => ({
        kind: "object" as const,
        id: o.id,
        path: `/preview/object/${encodeURIComponent(o.component_key!)}`,
        updated_at: o.updated_at,
        thumbnail_url: o.thumbnail_url,
        thumbnail_updated_at: o.thumbnail_updated_at,
        thumbnail_build_version: o.thumbnail_build_version,
      })), [objects]);
  useAutoCaptureThumbnails(captureCandidates, ["admin", "object_registry"]);

  const regenerateObj = async (o: ObjectRegistryRow) => {
    try {
      toast.info("Regenerating thumbnail…");
      const url = await requestObjectThumbnail(o.id, true);
      if (!url) { toast("Couldn't create this preview. The previous picture has been kept."); return; }
      toast.success("Thumbnail regenerated");
      qc.invalidateQueries({ queryKey: ["admin", "object_registry"] });
    } catch (e: any) {
      toast.error(`Failed: ${e?.message ?? "unknown"}`);
    }
  };

  const byName = (a: ObjectRegistryRow, b: ObjectRegistryRow) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

  const matches = (o: ObjectRegistryRow, needle: string, field: string = searchField) => {
    const n = needle.toLowerCase();
    const test = (v: string | null | undefined) => (v ?? "").toLowerCase().includes(n);
    const path = `/objects/${o.slug_id ?? ""}`;
    switch (field) {
      case "name": return test(o.name);
      case "id": return test(o.slug_id);
      case "path": return test(path);
      case "description": return test(o.description);
      case "tags": return (o.labels ?? []).some((t) => t.toLowerCase().includes(n));
      default:
        return [o.name, o.slug_id, path, o.description, ...(o.labels ?? [])]
          .some((v) => test(v as string));
    }
  };

  const filterValue: LibraryFilters = { searchField, labels: filterTags, timeRange, dateFrom, dateTo, archived: showArchived, extra: usedFilter };
  const applyFilters = (f: LibraryFilters) => {
    setSearchField(f.searchField as Field);
    setFilterTags(f.labels); setTimeRange(f.timeRange as TimeRange); setDateFrom(f.dateFrom); setDateTo(f.dateTo); setShowArchived(f.archived);
    setUsedFilter(f.extra);
  };
  const filterRows = (f: LibraryFilters) => {
    const term = deferredQ.trim().toLowerCase();
    const source = f.archived ? archived : objects;
    let list = source.filter((o) => {

      if (term && !matches(o, term, f.searchField)) return false;
      if (f.labels.length && !f.labels.every((f) => matchesLabelFilter(o.labels, f))) return false;
      if (f.dateFrom && new Date(o.updated_at) < new Date(f.dateFrom)) return false;
      if (f.dateTo && new Date(o.updated_at) > new Date(f.dateTo + "T23:59:59")) return false;
      const rangeMs =
        f.timeRange === "hour" ? 3600e3 :
        f.timeRange === "day" ? 24 * 3600e3 :
        f.timeRange === "week" ? 7 * 24 * 3600e3 : 0;
      if (rangeMs && (Date.now() - new Date(o.updated_at).getTime()) > rangeMs) return false;
      if (f.extra === "used" && !usagesForObject(o).length) return false;
      if (f.extra === "none" && usagesForObject(o).length) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return byName(a, b);
      if (sort === "name_desc") return byName(b, a);
      const da = new Date(a.updated_at).getTime();
      const db = new Date(b.updated_at).getTime();
      return sort === "oldest" ? da - db : db - da;
    });
    return list;
  };
  const visible = useMemo(() => filterRows(filterValue), [objects, archived, deferredQ, searchField, filterTags, isArchivedView, sort, timeRange, dateFrom, dateTo, usedFilter, usageMap]);


  const doArchive = async (o: ObjectRegistryRow) => {
    setConfirmArchive(null);
    try {
      await archive.mutateAsync(o.id);
      toast.success(`Moved "${o.name}" to archive`);
    } catch (e: any) {
      toast.error(e?.message ?? "Archive failed");
    }
  };

  const doRestore = async (o: ObjectRegistryRow) => {
    try {
      await restore.mutateAsync(o.id);
      toast.success(`Restored "${o.name}"`);
    } catch (e: any) {
      toast.error(e?.message ?? "Restore failed");
    }
  };

  // Simple navigation to the object's edit route (no status change).
  const gotoObject = (o: ObjectRegistryRow) => navigate(`/objects/${o.slug_id}`);

  const doDeletePermanent = async (o: ObjectRegistryRow) => {
    setConfirmDelete(null);
    try {
      await deletePermanent.mutateAsync(o.id);
      toast.success(`Permanently deleted "${o.name}"`);
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  };

  return (
    <div className="nova-library-layout flex gap-4 items-start">

      <div className="nova-library-content flex-1 min-w-0 space-y-3">
        <LibraryFilterToolbar labelUsageCounts={usageCounts} scope="objects" noun="Objects" search={q} onSearch={setQ} value={filterValue} onApply={applyFilters} fields={FIELDS} sort={sort} onSort={v => setSort(v as typeof sort)} sortOptions={[{ v: "newest", label: "Recently Modified" }, { v: "oldest", label: "Oldest Modified" }, { v: "name", label: "Name (A–Z)" }, { v: "name_desc", label: "Name (Z–A)" }]} count={visible.length} countResults={f => filterRows(f).length} extraLabel="Used On" extraOptions={[{ v: "all", label: "Any" }, { v: "used", label: "In Use" }, { v: "none", label: "Not Used" }]} onAdd={() => setCreating(true)} editing={listEditing} onEdit={() => setListEditing(v => !v)} editTools={      <TagsPanel
        scope="objects"
        usageCounts={usageCounts}
        activeFilters={filterTags}
        onToggleFilter={(t) => setFilterTags((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])}
        onClearFilters={() => setFilterTags([])}
        selectedCount={selected.size}
        selectedIds={[...selected]}
        onApplyTag={applyTagToObjects}
        itemLabel="objects"
      />} />
        <SelectionBar
          count={selected.size}
          itemLabel="object"
          onClear={() => setSelected(new Set())}
        >
          <Button size="sm" variant="outline" onClick={() => bulkArchive([...selected].filter((id) => !objects.find((o) => o.id === id)?.site_wide))}>
            <Archive className="w-3.5 h-3.5 mr-1.5" /> Archive
          </Button>
        </SelectionBar>


        {isLoading && <div className="h-24 animate-pulse bg-muted" />}
        {!isLoading && visible.length === 0 && <p className="py-8 text-sm text-muted-foreground">No objects match the current filters.</p>}
        <div className="min-w-0">{visible.map((obj, idx) => <LibraryListRow key={obj.id} labelScope="objects" labels={obj.labels ?? []} onLabelFilter={path => setFilterTags(cur => addLibraryLabelFilter(cur, path))} name={obj.name} date={new Date(obj.updated_at).toLocaleDateString()} thumbnail={<ObjectThumbnail id={obj.id} storedThumb={obj.thumbnail_url} />} badges={<><span>{obj.archived_at ? "Archived" : obj.site_wide ? "Site-Wide" : usagesForObject(obj).length ? "In Use" : "Not Used"}</span></>} onOpen={() => setPreview(obj)} onTitle={() => gotoObject(obj)} selection={listEditing ? <input type="checkbox" checked={selected.has(obj.id)} aria-label={`Select ${obj.name}`} onChange={() => toggleSelected(obj.id)} /> : undefined} menu={<><DropdownMenuItem onSelect={() => navigate(`/manage/preview?editObject=${encodeURIComponent(obj.id)}`)}>Edit</DropdownMenuItem><DropdownMenuItem onSelect={() => window.open(`/objects/${obj.slug_id}`, "_blank", "noopener,noreferrer")}>Open</DropdownMenuItem><DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(buildObjectRef({id:obj.slug_id,name:obj.name})).then(() => toast.success("Reference copied"), () => toast.error("Copy failed")); } }>Copy Reference</DropdownMenuItem><UsedOnChip usages={usagesForObject(obj)} hasKey={!!obj.component_key} /><LabelsCell scope="objects" value={obj.labels ?? []} onChange={next => updateObjectLabels(obj.id,next)} itemName={obj.name} />
                          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Description
                          </DropdownMenuLabel>
                          <div
                            className="px-2 pb-2"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <InlineEdit
                              value={obj.description ?? ""}
                              onSave={(v) => updateObjectDescription(obj.id, v)}
                            />
                          </div>
                          <DropdownMenuSeparator />
                          {!!obj.archived_at && (
                            <>
                              <DropdownMenuItem onSelect={() => doRestore(obj)} disabled={restore.isPending}>
                                <RotateCcw className="w-4 h-4 mr-2" /> Restore from Archive
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem onSelect={() => setCopyFrom(obj)}>
                            <Copy className="w-4 h-4 mr-2" /> Make a Copy…
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setRenameTarget(obj)}>
                            <Type className="w-4 h-4 mr-2" /> Rename…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {!!obj.component_key && (
                            <>
                              <DropdownMenuItem onSelect={() => regenerateObj(obj)}>
                                <RefreshCw className="w-4 h-4 mr-2" /> Regenerate Thumbnail
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          {!obj.site_wide && <DropdownMenuItem onSelect={() => setConfirmArchive(obj)}>
                            <Archive className="w-4 h-4 mr-2" /> Archive (Reversible)
                          </DropdownMenuItem>}
                          {!obj.site_wide && <DropdownMenuSeparator />}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            disabled={!!obj.site_wide}
                            onSelect={() => setConfirmDelete(obj)}
                          >
                            <AlertTriangle className="w-4 h-4 mr-2" /> Delete Permanently…
                          </DropdownMenuItem>
                        </>} />)}</div>
        <ObjectPreviewDialog obj={preview} onClose={() => setPreview(null)} />

        <CreateObjectDialog open={creating} onOpenChange={setCreating} navigateOnCreate />

        <CreateObjectDialog
          open={!!copyFrom}
          onOpenChange={(o) => { if (!o) setCopyFrom(null); }}
          initialName={copyFrom ? `${copyFrom.name} Copy` : ""}
          title={copyFrom ? `Make a copy of "${copyFrom.name}"` : "Make a Copy"}
          submitLabel="Create copy"
          navigateOnCreate
        />

        <RenameDialog
          open={!!renameTarget}
          onOpenChange={(o) => { if (!o) setRenameTarget(null); }}
          title={renameTarget ? `Rename "${renameTarget.name}"` : "Rename Object"}
          description="Renaming updates the object's display name and its /objects URL. All internal references (Copy Reference output, page usage links) resolve by id and stay intact."
          pathPrefix="/objects/"
          currentName={renameTarget?.name ?? ""}
          currentSlug={renameTarget?.slug_id ?? ""}
          onSubmit={async (name, slug) => {
            if (!renameTarget) return;
            await renameObject({ id: renameTarget.id, newName: name, newSlug: slug });
            toast.success("Object renamed");
            qc.invalidateQueries({ queryKey: ["admin", "object_registry"] });
          }}
        />

        <EditReadyDialog
          obj={editReady}
          usages={editReady ? usagesForObject(editReady) : []}
          onClose={() => setEditReady(null)}
          onUpdateAll={(o) => { setEditReady(null); gotoObject(o); }}
          onMakeCopy={(o) => { setEditReady(null); setCopyFrom(o); }}
        />


        <ConfirmDialog
          open={!!confirmArchive}
          onOpenChange={(o) => { if (!o) setConfirmArchive(null); }}
          title={`Archive "${confirmArchive?.name ?? ""}"?`}
          description={
            <>
              This moves the object to the archive. You can restore it later from
              the <strong>Archive</strong> panel on the Objects tab.
            </>
          }
          confirmLabel="Move to archive"
          destructive
          onConfirm={() => confirmArchive && doArchive(confirmArchive)}
        />

        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
          title={`Permanently delete "${confirmDelete?.name ?? ""}"?`}
          description={
            confirmDelete && (
              <div className="space-y-2">
                <InUseWarning items={[{ label: confirmDelete.name, usages: usagesForObject(confirmDelete) }]} />
                <p className="flex items-start gap-2 text-destructive font-medium">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>This cannot be undone. No archive fallback, no undo toast.</span>
                </p>
                <div>
                  <p className="mb-1">The following will be removed from the database:</p>
                  <ul className="list-disc pl-5 space-y-0.5 text-xs">
                    <li>
                      <strong>object_registry</strong> row for &ldquo;{confirmDelete.name}&rdquo;
                      (id <code className="font-mono">{confirmDelete.slug_id}</code>) — including its
                      inline <em>labels</em> and <em>intended_pages</em> fields.
                    </li>
                  </ul>
                </div>
                {confirmDelete.component_key && (
                  <p className="flex items-start gap-2 text-brass border-l-2 border-brass/60 pl-2 text-xs">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      <strong>Heads up:</strong> this object’s
                      component <code className="font-mono">{confirmDelete.component_key}</code> may
                      still be imported and rendered somewhere in the app code.
                    </span>
                  </p>
                )}
              </div>
            )
          }
          confirmLabel="Delete permanently"
          destructive
          onConfirm={() => confirmDelete && doDeletePermanent(confirmDelete)}
        />
      </div>
    </div>
  );
}


/**
 * On-demand live preview modal. Mounts the actual object component ONLY while
 * the dialog is open — closing unmounts it, so only one live instance ever
 * exists at a time in the Site Manager.
 */
function ObjectPreviewDialog({ obj, onClose }: { obj: ObjectRegistryRow | null; onClose: () => void }) {
  const entry = obj?.component_key ? objectRegistry[obj.component_key] : undefined;
  const [regenerating, setRegenerating] = useState(false);
  const qc = useQueryClient();
  const autoTriedRef = useRef<string | null>(null);
  const onRegenerate = async () => {
    if (!obj?.component_key) return;
    setRegenerating(true);
    try {
      await regenerateThumbnail({
        kind: "object",
        id: obj.id,
        path: `/preview/object/${encodeURIComponent(obj.component_key)}`,
        updated_at: obj.updated_at,
        thumbnail_url: obj.thumbnail_url,
        thumbnail_updated_at: obj.thumbnail_updated_at,
        thumbnail_build_version: obj.thumbnail_build_version,
      });

      toast.success("Preview refreshed");
      qc.invalidateQueries({ queryKey: ["admin", "object_registry"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Refresh failed");
    } finally { setRegenerating(false); }
  };

  // Safeguard for future additions: when an object has a wired component
  // but its stored thumbnail is missing / from an older build / captured
  // before the component was registered, silently regenerate on first open
  // so the row thumbnail stops showing a stale "No preview" snapshot.
  useEffect(() => {
    if (!obj || !entry || regenerating) return;
    if (autoTriedRef.current === obj.id) return;
    const stale = isStale({
      kind: "object",
      id: obj.id,
      path: `/preview/object/${encodeURIComponent(obj.component_key!)}`,
      updated_at: obj.updated_at,
      thumbnail_url: obj.thumbnail_url,
      thumbnail_updated_at: obj.thumbnail_updated_at,
      thumbnail_build_version: obj.thumbnail_build_version,
    });
    if (!stale) return;
    autoTriedRef.current = obj.id;
    void onRegenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj?.id, entry]);

  return (
    <Dialog open={!!obj} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl w-[95vw] p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 pr-14 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="truncate">{obj?.name}</DialogTitle>
              <p className="text-xs font-mono text-muted-foreground mt-1 truncate">id: {obj?.slug_id}</p>
            </div>
            {entry && (
              <Button variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating} className="gap-1.5 shrink-0">
                <RefreshCw className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`} />
                Refresh Thumbnail and Preview Images
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="bg-muted/30 p-4 max-h-[80vh] overflow-auto">
          {!entry ? (
            <div className="border-2 border-dashed border-brass/40 bg-brass/5 rounded-md p-8 space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-brass">
                <span className="w-2 h-2 rounded-full bg-brass" />
                No component yet
              </div>
              {obj?.description && <p className="text-sm text-foreground/80">{obj.description}</p>}
              <p className="text-xs text-muted-foreground">
                Copy this object's reference into a Lovable chat to have the component built.
              </p>
            </div>
          ) : (
            <div className="rounded border bg-background overflow-hidden">
              <div className="px-3 py-2 text-[11px] text-muted-foreground border-b bg-muted/50">
                Live Component Preview
              </div>
              <Suspense fallback={<div className="h-64 bg-muted animate-pulse" />}>
                {(() => {
                  const C = entry.component as React.ComponentType;
                  return <C />;
                })()}
              </Suspense>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Prompt shown when the user clicks Edit on a shared object.
 * Two paths: Update All (opens the object to edit — publishing updates every
 * location automatically) or Make a Copy (creates a new object).
 */
function EditReadyDialog({
  obj, usages, onClose, onUpdateAll, onMakeCopy,
}: {
  obj: ObjectRegistryRow | null;
  usages: ObjectUsage[];
  onClose: () => void;
  onUpdateAll: (o: ObjectRegistryRow) => void;
  onMakeCopy: (o: ObjectRegistryRow) => void;
}) {
  return (
    <Dialog open={!!obj} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit "{obj?.name}"</DialogTitle>
        </DialogHeader>
        {obj && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Currently used on
                {usages.length > 0 ? ` ${usages.length} page${usages.length === 1 ? "" : "s"}:` : ":"}
              </p>
              {usages.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  Not on any page yet.
                </p>
              ) : (
                <ul className="text-sm max-h-40 overflow-auto rounded border bg-muted/20 divide-y">
                  {usages.map((u) => (
                    <li key={u.path} className="px-3 py-1.5 flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {u.type}
                      </Badge>
                      <span className="truncate">{u.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground truncate">
                        {u.path}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="text-left rounded border p-3 hover:border-primary hover:bg-primary/5 transition"
                onClick={() => onUpdateAll(obj)}
              >
                <div className="text-sm font-medium mb-1">Update All Locations</div>
                <p className="text-xs text-muted-foreground">
                  Edit this shared object. Publishing updates every page that uses it.
                </p>
              </button>
              <button
                type="button"
                className="text-left rounded border p-3 hover:border-primary hover:bg-primary/5 transition"
                onClick={() => onMakeCopy(obj)}
              >
                <div className="text-sm font-medium mb-1">Make a Copy</div>
                <p className="text-xs text-muted-foreground">
                  Create a new object and edit it independently. Existing pages keep the original.
                </p>
              </button>
            </div>

            <div className="flex justify-end pt-1">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UsedOnChip({ usages, hasKey }: { usages: ObjectUsage[]; hasKey: boolean }) {
  if (!hasKey) {
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-muted text-muted-foreground border-border"
        title="No component key set — usage cannot be determined"
      >
        Unknown
      </span>
    );
  }
  const count = usages.length;
  const label = count === 0 ? "Not used" : count === 1 ? "On 1 page" : `On ${count} pages`;
  const tone = count === 0
    ? "bg-muted text-muted-foreground border-border hover:bg-muted"
    : "bg-brass/10 text-foreground border-brass/40 hover:bg-brass/20";
  if (count === 0) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${tone}`}
        title="This object isn't rendered on any page"
      >
        {label}
      </span>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex min-h-9 sm:min-h-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border transition-colors ${tone} cursor-pointer`}
          title="Show pages that render this object"
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="px-3 py-2 border-b text-[11px] uppercase tracking-wider text-muted-foreground">
          Used On {count} page{count === 1 ? "" : "s"}
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {usages.map((u) => (
            <li key={`${u.type}:${u.path}`}>
              <a
                href={u.path}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-primary/10 hover:text-primary transition-colors group cursor-pointer"
              >
                <span className="flex flex-col min-w-0">
                  <span className="truncate group-hover:underline">{u.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground truncate group-hover:text-primary/70">{u.path}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}


