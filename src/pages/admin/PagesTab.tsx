import { addLibraryLabelFilter } from "./libraryLabels";
import { SignedThumbImg } from "./signedThumb";
import LibraryFilterToolbar from "./LibraryFilterToolbar";
import LibraryListRow from "./LibraryListRow";
import { type LibraryFilters } from "./libraryFilters";
import "./pageTables.css";
import ArchivedBadge from "./ArchivedBadge";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchesLabelFilter } from "./labelPath";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/prototype/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import ListPager, { usePager } from "./ListPager";
import TagsPanel from "./TagsPanel";
import InlineEdit from "./InlineEdit";
import ConfirmDialog from "./ConfirmDialog";
import { scheduleDeleteWithUndo } from "./deferredDelete";
import { notifyContentEdited } from "./designChat/contentSync";
import { pageChangeNote } from "./contentChangeNotes";
import { Search, Archive, ArchiveRestore, Trash2, ListChecks, FileText, Megaphone, ExternalLink, MoreHorizontal, RefreshCw, MessageSquare } from "lucide-react";
import { useDesignChatOptional } from "./designChat/DesignChatContext";
import { workingPageFrom } from "./designChat/pageSelection";
import { CopyRefButton, buildPageRef } from "./copyReference";
import { reservedPrefixFor } from "./reservedPaths";
import CreatePageDialog from "./CreatePageDialog";
import LinkAuditView from "./LinkAuditView";
import { getPageType, type PageType } from "./routeTable";
import LabelsCell from "./LabelsCell";
import SelectionBar from "./SelectionBar";
import { type TimeRange } from "./FilterBar";
import LandingPagesView from "./LandingPagesView";
import PagePreviewDialog from "./PagePreviewDialog";
import { useAutoCaptureThumbnails, regenerateThumbnail } from "./useThumbnailCapture";
import WorkStatusPopover from "./WorkStatusPopover";
import { syncManifestPages, PAGES_SYNCED } from "./manifestPageSync";
import { MANIFEST_CHANGED } from "./siteManifest";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


type BuildStatus = "draft" | "ready";
interface Page {
  id: string; slug_id: string; name: string; path: string; description: string;
  notes: string; tags: string[]; updated_at: string; archived_at: string | null;
  thumbnail_url: string | null; preview_url: string | null;
  thumbnail_updated_at: string | null; thumbnail_build_version: string | null;
  build_status: BuildStatus;
}

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

const openLive = (path: string) => {
  if (!path) return;
  const url = path.startsWith("/") ? path : `/${path}`;
  window.open(url, "_blank", "noopener,noreferrer");
};

export default function PagesTab() {
  const navigate = useNavigate();
  const designChat = useDesignChatOptional(); // present inside the Site Manager, where the chat is on the right
  const choosePage = (page: Page) => {
    if (!designChat) return;
    designChat.selectPage(workingPageFrom(page));
    navigate("/manage/preview");
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-mode-switch] [data-mode="manual"]')?.focus());
  };
  const [pages, setPages] = useState<Page[]>([]);
  const [listEditing, setListEditing] = useState(false);
  const [q, setQ] = useState("");
  const [searchField, setSearchField] = useState<Field>("all");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [pageTypeFilter, setPageTypeFilter] = useState<PageType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "draft">("all");
  const [showArchived, setShowArchived] = useState(false);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "name_desc">("newest");
  const [preview, setPreview] = useState<Page | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<
    | { kind: "delete-one"; page: Page; linkCount: number }
    | { kind: "delete-bulk"; ids: string[] }
    | null
  >(null);
  const lastIdx = useRef<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const view: "static" | "landing" | "audit" =
    rawTab === "link-audit" ? "audit" :
    rawTab === "landing" ? "landing" :
    "static";
  const setView = (v: "static" | "landing" | "audit") => {
    const next = new URLSearchParams(searchParams);
    if (v === "audit") next.set("tab", "link-audit");
    else if (v === "landing") next.set("tab", "landing");
    else next.set("tab", "static");
    setSearchParams(next, { replace: false });
  };
  const [creating, setCreating] = useState(false);

  const loadGeneration = useRef(0);
  const load = async () => {
    const generation = ++loadGeneration.current;
    const { data, error } = await (supabase as any).from("pages").select("*").order("updated_at", { ascending: false });
    if (generation !== loadGeneration.current) return;
    if (error) { toast.error(error.message); return; }
    setPages((data ?? []).map((p: any) => ({ ...p, tags: p.tags ?? [] })));
  };
  useEffect(() => {
    load();
    void syncManifestPages();
    const refreshList = () => { void load(); };
    window.addEventListener(PAGES_SYNCED, refreshList);
    window.addEventListener(MANIFEST_CHANGED, refreshList);
    return () => { ++loadGeneration.current; window.removeEventListener(PAGES_SYNCED, refreshList); window.removeEventListener(MANIFEST_CHANGED, refreshList); };
  }, []);

  // Keep the list fresh when the tab regains focus or the manager comes back into view.
  useEffect(() => {
    const onFocus = () => load();
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);


  // Auto-capture server-side thumbnails for stale/new pages.
  const captureCandidates = useMemo(() =>
    pages
      .filter((p) => !p.archived_at && p.path && !p.path.startsWith("/admin") && p.path !== "*")
      .map((p) => ({
        kind: "page" as const,
        id: p.id,
        path: p.path.startsWith("/") ? p.path : `/${p.path}`,
        updated_at: p.updated_at,
        thumbnail_url: p.thumbnail_url,
        thumbnail_updated_at: p.thumbnail_updated_at,
        thumbnail_build_version: p.thumbnail_build_version,
      })), [pages]);
  useAutoCaptureThumbnails(captureCandidates, ["admin", "pages"]);

  const regenerateOne = async (p: Page) => {
    try {
      toast.info("Regenerating thumbnail…");
      await regenerateThumbnail({
        kind: "page", id: p.id,
        path: p.path.startsWith("/") ? p.path : `/${p.path}`,
        updated_at: p.updated_at,
        thumbnail_url: p.thumbnail_url,
        thumbnail_updated_at: p.thumbnail_updated_at,
        thumbnail_build_version: p.thumbnail_build_version,
      });
      toast.success("Thumbnail regenerated");
      load();
    } catch (e: any) {
      toast.error(`Failed: ${e?.message ?? "unknown"}`);
    }
  };

  const usageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    pages.forEach((p) => p.tags?.forEach((t) => { c[t] = (c[t] ?? 0) + 1; }));
    return c;
  }, [pages]);

  const countLinks = async (pageIds: string[]): Promise<number> => {
    if (pageIds.length === 0) return 0;
    const { count } = await (supabase as any)
      .from("page_objects").select("*", { count: "exact", head: true }).in("page_id", pageIds);
    return count ?? 0;
  };

  const requestDelete = async (page: Page) => {
    const linkCount = await countLinks([page.id]);
    setConfirmState({ kind: "delete-one", page, linkCount });
  };

  const doDeleteOne = (page: Page) => {
    setConfirmState(null);
    scheduleDeleteWithUndo({
      label: `Deleted page "${page.name}"`,
      hide: () => setHiddenIds((s) => new Set(s).add(page.id)),
      restore: () => setHiddenIds((s) => { const n = new Set(s); n.delete(page.id); return n; }),
      commit: async () => {
        const { error } = await (supabase as any).from("pages").delete().eq("id", page.id);
        if (error) throw error;
        notifyContentEdited([pageChangeNote("Deleted", page)]);
      },
      onCommitted: () => { setHiddenIds((s) => { const n = new Set(s); n.delete(page.id); return n; }); load(); },
    });
  };

  const doDeleteBulk = (ids: string[]) => {
    setConfirmState(null);
    setSelected(new Set());
    scheduleDeleteWithUndo({
      label: `Deleted ${ids.length} page${ids.length === 1 ? "" : "s"}`,
      hide: () => setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.add(i)); return n; }),
      restore: () => setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }),
      commit: async () => {
        const { error } = await (supabase as any).from("pages").delete().in("id", ids);
        if (error) throw error;
        notifyContentEdited(pages.filter((p) => ids.includes(p.id)).map((p) => pageChangeNote("Deleted", p)));
      },
      onCommitted: () => { setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }); load(); },
    });
  };

  const archive = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await (supabase as any).from("pages").update({ archived_at: new Date().toISOString() }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    notifyContentEdited(pages.filter((p) => ids.includes(p.id)).map((p) => pageChangeNote("Archived", p)));
    setSelected(new Set());
    toast(`Archived ${ids.length} page${ids.length === 1 ? "" : "s"}`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => unarchive(ids),
      },
    });
    load();
  };

  const unarchive = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await (supabase as any).from("pages").update({ archived_at: null }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    notifyContentEdited(pages.filter((p) => ids.includes(p.id)).map((p) => pageChangeNote("Restored", p)));
    toast.success(`Restored ${ids.length} page${ids.length === 1 ? "" : "s"}`);
    load();
  };


  const updateDescription = async (id: string, description: string) => {
    const { error } = await (supabase as any).from("pages").update({ description }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Description saved"); load(); }
  };

  const setBuildStatus = async (id: string, status: BuildStatus) => {
    setPages((cur) => cur.map((p) => (p.id === id ? { ...p, build_status: status } : p)));
    const { error } = await (supabase as any).from("pages").update({ build_status: status }).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
    const page = pages.find((p) => p.id === id);
    if (page) notifyContentEdited([pageChangeNote(`Changed Work Status to ${status === "ready" ? "Ready" : "Draft"} for`, page)]);
    toast.success(`Marked as ${status === "ready" ? "Ready" : "Draft"}`);
    load();
  };

  const updateTags = async (id: string, tags: string[]) => {
    // Optimistic local update so the picker stays responsive.
    setPages((cur) => cur.map((p) => (p.id === id ? { ...p, tags } : p)));
    const { error } = await (supabase as any).from("pages").update({ tags }).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
    load();
  };

  const applyTag = async (ids: string[], tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || !ids.length) return;
    const targets = pages.filter((p) => ids.includes(p.id));
    await Promise.all(targets.map(async (p) => {
      if (p.tags.includes(t)) return;
      const nextTags = [...p.tags, t];
      const { error } = await (supabase as any).from("pages").update({ tags: nextTags }).eq("id", p.id);
      if (error) toast.error(error.message);
    }));
    toast.success(`Labeled ${ids.length} page${ids.length === 1 ? "" : "s"} "${t}"`);
    load();
  };

  const matches = (p: Page, needle: string, field: string = searchField) => {
    const n = needle.trim().toLowerCase();
    if (!n) return true;
    const test = (v: string) => (v ?? "").toLowerCase().includes(n);
    switch (field) {
      case "name": return test(p.name);
      case "id": return test(p.slug_id);
      case "path": return test(p.path);
      case "description": return test(p.description);
      case "tags": return (p.tags ?? []).some((t) => t.toLowerCase().includes(n));
      default: return [p.name, p.slug_id, p.path, p.description, ...(p.tags ?? [])].some((v) => test(v ?? ""));
    }
  };

  const filterValue: LibraryFilters = { searchField, labels: tagFilters, timeRange, dateFrom, dateTo, archived: showArchived, extra: statusFilter };
  const applyFilters = (f: LibraryFilters) => {
    setSearchField(f.searchField as Field);
    setTagFilters(f.labels); setTimeRange(f.timeRange as TimeRange); setDateFrom(f.dateFrom); setDateTo(f.dateTo); setShowArchived(f.archived);
    setStatusFilter(f.extra as typeof statusFilter);
  };
  const filterRows = (f: LibraryFilters) => {
    let list = pages.filter((p) => {
      if (hiddenIds.has(p.id)) return false;
      if (reservedPrefixFor(p.path)) return false;
      if (((p as any).page_type ?? "static") === "landing") return false;
      if (getPageType(p.path, p.name) !== "Static page") return false;
      const isArchived = !!p.archived_at;
      if (f.archived) {
        if (!isArchived) return false;
      } else {
        if (isArchived) return false;
        if (f.extra === "ready" && p.build_status !== "ready") return false;
        if (f.extra === "draft" && p.build_status !== "draft") return false;
      }
      if (f.labels.length && !f.labels.every((t) => matchesLabelFilter(p.tags, t))) return false;
      if (pageTypeFilter !== "all" && getPageType(p.path, p.name) !== pageTypeFilter) return false;
      if (f.dateFrom && new Date(p.updated_at) < new Date(f.dateFrom)) return false;
      if (f.dateTo && new Date(p.updated_at) > new Date(f.dateTo + "T23:59:59")) return false;
      const rangeMs =
        f.timeRange === "hour" ? 3600e3 :
        f.timeRange === "day" ? 24 * 3600e3 :
        f.timeRange === "week" ? 7 * 24 * 3600e3 : 0;
      if (rangeMs && (Date.now() - new Date(p.updated_at).getTime()) > rangeMs) return false;
      if (q && !matches(p, q, f.searchField)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "name" || sort === "name_desc") {
        // Draft first, then Ready, each sorted by name
        const sa = a.build_status === "draft" ? 0 : 1;
        const sb = b.build_status === "draft" ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return sort === "name_desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
      }
      const da = new Date(a.updated_at).getTime(), db = new Date(b.updated_at).getTime();
      return sort === "oldest" ? da - db : db - da;
    });
    return list;
  };
  const filtered = useMemo(() => filterRows(filterValue), [pages, q, searchField, tagFilters, pageTypeFilter, statusFilter, dateFrom, dateTo, timeRange, sort, showArchived, hiddenIds]);


  const archivedCount = useMemo(() => pages.filter((p) => p.archived_at).length, [pages]);


  const toggleSelect = (id: string, idx: number, shift: boolean) => {
    const n = new Set(selected);
    if (shift && lastIdx.current !== null) {
      const [a, b] = [lastIdx.current, idx].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) n.add(filtered[i].id);
    } else {
      if (n.has(id)) n.delete(id); else n.add(id);
    }
    lastIdx.current = idx;
    setSelected(n);
  };

  const onRowDragStart = (e: React.DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData("text/plain", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copy";
  };

  const pager = usePager(filtered.length);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Pages View" className="grid grid-cols-3 rounded-md border bg-background">{([['static', 'Static Pages'], ['landing', 'Landing Pages'], ['audit', 'Link Audit']] as const).map(([key, label]) => <Button key={key} role="tab" aria-selected={view === key} variant={view === key ? "default" : "ghost"} className="h-11 min-w-0 rounded-none px-1 text-xs" onClick={() => setView(key)}>{label}</Button>)}</div>

    {view === "audit" ? (
      <LinkAuditView pages={pages as any} />
    ) : view === "landing" ? (
      <LandingPagesView />
    ) : (
    <div className="nova-library-layout flex gap-4 items-start">



      <div className="nova-library-content flex-1 min-w-0 space-y-3">
        <LibraryFilterToolbar labelUsageCounts={usageCounts} scope="static" noun="Pages" search={q} onSearch={setQ} value={filterValue} onApply={applyFilters} fields={FIELDS} sort={sort} onSort={v => setSort(v as typeof sort)} sortOptions={[{ v: "newest", label: "Recently Modified" }, { v: "oldest", label: "Oldest Modified" }, { v: "name", label: "Name (A–Z)" }, { v: "name_desc", label: "Name (Z–A)" }]} count={filtered.length} countResults={f => filterRows(f).length} extraLabel="Status" extraOptions={[{ v: "all", label: "All Statuses" }, { v: "ready", label: "Ready" }, { v: "draft", label: "Draft" }]} onAdd={() => setCreating(true)} editing={listEditing} onEdit={() => setListEditing(v => !v)} editTools={
      <TagsPanel
        scope="static"
        usageCounts={usageCounts}
        activeFilters={tagFilters}
        onToggleFilter={(t) => setTagFilters((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])}
        onClearFilters={() => setTagFilters([])}
        selectedCount={selected.size}
        selectedIds={[...selected]}
        onApplyTag={applyTag}
        itemLabel="pages"
        filteredCount={filtered.length}
        onSelectAllFiltered={() => setSelected(new Set(filtered.map((p) => p.id)))}
      />
      } />
      <SelectionBar
        count={selected.size}
        itemLabel="page"
        onClear={() => setSelected(new Set())}
      >
        {showArchived ? (
          <Button size="sm" variant="outline" onClick={() => unarchive([...selected])}>
            <ArchiveRestore className="w-3.5 h-3.5 mr-1.5" /> Restore
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => archive([...selected])}>
            <Archive className="w-3.5 h-3.5 mr-1.5" /> Archive
          </Button>
        )}
        <Button size="sm" variant="destructive" onClick={() => setConfirmState({ kind: "delete-bulk", ids: [...selected] })}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
        </Button>
      </SelectionBar>



        <div className="min-w-0">{filtered.slice(pager.start, pager.end).map((p, idx) => <LibraryListRow key={p.id} labelScope="static" labels={p.tags} onLabelFilter={path => setTagFilters(cur => addLibraryLabelFilter(cur, path))} name={p.name} date={new Date(p.updated_at).toLocaleDateString()} thumbnail={<SignedThumbImg url={p.thumbnail_url} alt={p.name} className="h-14 w-14 object-cover" fallback={<FileText className="h-5 w-5 text-muted-foreground" />} />} badges={<><span>{p.archived_at ? "Archived" : p.build_status === "ready" ? "Ready" : "Draft"}</span></>} onOpen={() => setPreview(p)} onTitle={() => choosePage(p)} selection={listEditing ? <input type="checkbox" checked={selected.has(p.id)} aria-label={`Select ${p.name}`} onChange={() => toggleSelect(p.id, idx, false)} /> : undefined} menu={<><DropdownMenuItem onSelect={() => choosePage(p)}>Edit</DropdownMenuItem><DropdownMenuItem onSelect={() => window.open(p.path, "_blank", "noopener,noreferrer")}>Open</DropdownMenuItem><DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(buildPageRef({id:p.slug_id,name:p.name,path:p.path})).then(() => toast.success("Reference copied"), () => toast.error("Copy failed")); } }>Copy Reference</DropdownMenuItem><DropdownMenuSeparator /><WorkStatusPopover value={p.build_status} onSave={next => setBuildStatus(p.id,next)} disabled={!!p.archived_at} /><LabelsCell scope="static" value={p.tags} onChange={next => updateTags(p.id,next)} itemName={p.name} />
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Description
                      </DropdownMenuLabel>
                      <div
                        className="px-2 pb-2"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <InlineEdit value={p.description ?? ""} onSave={(v) => updateDescription(p.id, v)} />
                      </div>
                      <DropdownMenuSeparator />
                      {p.archived_at ? (
                        <DropdownMenuItem onSelect={() => unarchive([p.id])}>
                          <ArchiveRestore className="w-4 h-4 mr-2" /> Restore from Archive
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => archive([p.id])}>
                          <Archive className="w-4 h-4 mr-2" /> Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => regenerateOne(p)}>
                        <RefreshCw className="w-4 h-4 mr-2" /> Regenerate Thumbnail
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => requestDelete(p)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </>} />)}</div>
      <PagePreviewDialog
        page={preview ? {
          kind: "page", id: preview.id, name: preview.name, path: preview.path,
          updated_at: preview.updated_at,
          thumbnail_updated_at: preview.thumbnail_updated_at,
          thumbnail_build_version: preview.thumbnail_build_version,
          thumbnail_url: preview.thumbnail_url,
          preview_url: preview.preview_url,
        } : null}
        onClose={() => setPreview(null)}
        onCaptured={load}
      />


      <ConfirmDialog
        open={confirmState?.kind === "delete-one"}
        onOpenChange={(o) => { if (!o) setConfirmState(null); }}
        title={
          confirmState?.kind === "delete-one"
            ? `Delete page "${confirmState.page.name}" (${confirmState.page.path || "no path"})?`
            : ""
        }
        description={
          confirmState?.kind === "delete-one"
            ? `This removes the page${confirmState.linkCount > 0 ? ` and its ${confirmState.linkCount} linked object reference${confirmState.linkCount === 1 ? "" : "s"}` : ""}. This can't be undone after the 5-second undo window.`
            : ""
        }
        confirmLabel="Delete page"
        onConfirm={() => confirmState?.kind === "delete-one" && doDeleteOne(confirmState.page)}
      />
      <ConfirmDialog
        open={confirmState?.kind === "delete-bulk"}
        onOpenChange={(o) => { if (!o) setConfirmState(null); }}
        title={
          confirmState?.kind === "delete-bulk"
            ? `Delete ${confirmState.ids.length} page${confirmState.ids.length === 1 ? "" : "s"}?`
            : ""
        }
        description="This removes the selected pages and their linked object references. This can't be undone after the 5-second undo window."
        confirmLabel="Delete pages"
        onConfirm={() => confirmState?.kind === "delete-bulk" && doDeleteBulk(confirmState.ids)}
      />
      </div>
    </div>
    )}

      <CreatePageDialog open={creating} onOpenChange={setCreating} onCreated={() => load()} />
    </div>
  );
}

export { default as PagePreviewDialog } from "./PagePreviewDialog";

