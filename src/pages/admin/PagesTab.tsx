import "./pageTables.css";
import ArchivedBadge from "./ArchivedBadge";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchesLabelFilter } from "./labelPath";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/prototype/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import PageMiniPreview from "./PageMiniPreview";
import ListPager, { usePager } from "./ListPager";
import TagsPanel from "./TagsPanel";
import LibraryLabels from "./LibraryLabels";
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
import FilterBar, { type TimeRange } from "./FilterBar";
import AddButtonRow from "./AddButtonRow";
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

  const matches = (p: Page, needle: string) => {
    const n = needle.toLowerCase();
    const test = (v: string) => (v ?? "").toLowerCase().includes(n);
    switch (searchField) {
      case "name": return test(p.name);
      case "id": return test(p.slug_id);
      case "path": return test(p.path);
      case "description": return test(p.description);
      case "tags": return (p.tags ?? []).some((t) => t.toLowerCase().includes(n));
      default: return [p.name, p.slug_id, p.path, p.description, ...(p.tags ?? [])].some((v) => test(v ?? ""));
    }
  };

  const filtered = useMemo(() => {
    let list = pages.filter((p) => {
      if (hiddenIds.has(p.id)) return false;
      if (reservedPrefixFor(p.path)) return false;
      if (((p as any).page_type ?? "static") === "landing") return false;
      if (getPageType(p.path, p.name) !== "Static page") return false;
      const isArchived = !!p.archived_at;
      if (showArchived) {
        if (!isArchived) return false;
      } else {
        if (isArchived) return false;
        if (statusFilter === "ready" && p.build_status !== "ready") return false;
        if (statusFilter === "draft" && p.build_status !== "draft") return false;
      }
      if (tagFilters.length && !tagFilters.every((t) => matchesLabelFilter(p.tags, t))) return false;
      if (pageTypeFilter !== "all" && getPageType(p.path, p.name) !== pageTypeFilter) return false;
      if (dateFrom && new Date(p.updated_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(p.updated_at) > new Date(dateTo + "T23:59:59")) return false;
      const rangeMs =
        timeRange === "hour" ? 3600e3 :
        timeRange === "day" ? 24 * 3600e3 :
        timeRange === "week" ? 7 * 24 * 3600e3 : 0;
      if (rangeMs && (Date.now() - new Date(p.updated_at).getTime()) > rangeMs) return false;
      if (q && !matches(p, q)) return false;
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
  }, [pages, q, searchField, tagFilters, pageTypeFilter, statusFilter, dateFrom, dateTo, timeRange, sort, showArchived, hiddenIds]);


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
      <div className="nova-library-tabs inline-flex rounded-lg border p-1 bg-muted/30">
        <button onClick={() => setView("static")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view==="static"?"bg-background shadow-sm":"text-muted-foreground"}`}>
          <FileText className="w-3.5 h-3.5" /> Static Pages
        </button>
        <button onClick={() => setView("landing")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view==="landing"?"bg-background shadow-sm":"text-muted-foreground"}`}>
          <Megaphone className="w-3.5 h-3.5" /> Landing Pages
        </button>
        <button onClick={() => setView("audit")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view==="audit"?"bg-background shadow-sm":"text-muted-foreground"}`}>
          <ListChecks className="w-3.5 h-3.5" /> Link Audit
        </button>
      </div>

    {view === "audit" ? (
      <LinkAuditView pages={pages as any} />
    ) : view === "landing" ? (
      <LandingPagesView />
    ) : (
    <div className="nova-library-layout flex gap-4 items-start">
      <LibraryLabels>
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
      </LibraryLabels>


      <div className="nova-library-content flex-1 min-w-0 space-y-3">
      <div className="nova-library-search flex items-stretch gap-0 rounded-lg border-2 border-border focus-within:border-primary bg-background shadow-sm overflow-hidden">
        <div className="flex items-center pl-4 pr-2 text-muted-foreground">
          <Search className="w-5 h-5" />
        </div>
        <Input
          placeholder="Search pages…"
          aria-label="Search Pages"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 border-0 rounded-none h-14 text-lg focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-2"
        />
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value as Field)}
          className="text-sm px-3 border-l bg-muted/40 h-14"
          title="Search Field"
          aria-label="Search Field"
        >
          {FIELDS.map((f) => <option key={f.v} value={f.v}>in {f.label}</option>)}
        </select>
      </div>

      <FilterBar
        sort={sort}
        onSortChange={(v) => setSort(v as any)}
        sortOptions={[
          { v: "newest", label: "Recently Modified" },
          { v: "oldest", label: "Oldest Modified" },
          { v: "name", label: "Name (A–Z)" },
          { v: "name_desc", label: "Name (Z–A)" },
        ]}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        dateFieldLabel="Modified"
        status={statusFilter}
        onStatusChange={(v) => setStatusFilter(v as any)}
        statusOptions={[
          { v: "all", label: "All Statuses" },
          { v: "ready", label: "Ready" },
          { v: "draft", label: "Draft" },
        ]}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
        archivedCount={archivedCount}
      />

      <div className="flex items-center gap-3 py-2">
        <AddButtonRow subtle text="Add new page" label="Page" onClick={() => setCreating(true)} />
      </div>



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

      

      <div className="manager-page-table-area w-full min-w-0">
      <table className="manager-page-table manager-static-table text-sm">

        <thead>
          <tr className="border-b bg-muted/30">
            <th className="px-3 py-3 text-left"></th>
            <th className="px-3 py-3 text-left truncate">Preview</th>
            <th className="px-3 py-3 text-left truncate">Name &amp; Path</th>
            <th className="px-3 py-3 text-center truncate">Status</th>
            <th className="px-3 py-3 text-center truncate">Copy</th>
            <th className="px-3 py-3 text-left truncate">Labels</th>
            <th className="px-3 py-3 text-left truncate">Last Mod</th>
            <th className="px-2 py-3 text-center truncate"><span className="sr-only">Chat</span></th>
            <th className="px-2 py-3 text-center truncate"><span className="sr-only">Open</span></th>
            <th className="px-2 py-3 text-center truncate"><span className="sr-only">More</span></th>
          </tr>
        </thead>

        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground text-sm">
                {timeRange === "hour" ? "No pages modified in the last hour."
                : timeRange === "day" ? "No pages modified in the last 24 hours."
                : timeRange === "week" ? "No pages modified in the last 7 days."
                : timeRange === "custom" && (dateFrom || dateTo) ? "No pages match the selected date range."
                : "No pages match the current filters."}
              </td>
            </tr>
          )}
          {filtered.slice(pager.start, pager.end).map((p, i) => { const idx = pager.start + i;
            const on = selected.has(p.id);
            const pageType = getPageType(p.path, p.name);
            return (
              <tr
                key={p.id}
                onClick={(event) => { if (!(event.target instanceof Element) || event.target.closest('button,a,input,select,textarea,[role="button"]')) return; choosePage(p); }}
                draggable
                onDragStart={(e) => onRowDragStart(e, p.id)}
                className={`border-b align-top ${on ? "bg-primary/10" : "hover:bg-muted/40"}`}
              >
                <td className="px-1 py-3">
                  <input type="checkbox" checked={on}
                    aria-label={`Select ${p.name}`}
                    onChange={(e) =>
                    toggleSelect(p.id, idx, (e.nativeEvent as MouseEvent).shiftKey)
                  } />
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => setPreview(p)}
                    className="block rounded hover:ring-2 hover:ring-primary/40 focus:outline-none focus:ring-2 focus:ring-primary"
                    title="Open Larger Preview"
                  >
                    <PageMiniPreview name={p.name} path={p.path} content={(p as any).content} />
                  </button>
                </td>
                <td className="px-3 py-3 min-w-0" title={p.name}>
                  <div className="flex flex-col gap-0.5 min-w-0 items-start">
                    <Button variant="link" onClick={() => choosePage(p)}
                      className="h-auto p-0 text-sm truncate max-w-full block text-left"
                      title={p.name}
                    >
                      {p.name}
                    </Button>
                    <span className="font-mono text-[10px] text-muted-foreground truncate max-w-full" title={p.path}>
                      {p.path}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                        p.build_status === "ready"
                          ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/40"
                          : "bg-amber-400/20 text-amber-800 border-amber-500/40"
                      }`}
                      title={p.build_status === "ready" ? "Ready" : "Draft"}
                    >
                      {p.build_status === "ready" ? "Ready" : "Draft"}
                    </span>
                    <ArchivedBadge archived={!!p.archived_at} />
                    <WorkStatusPopover
                      value={p.build_status === "ready" ? "ready" : "draft"}
                      onSave={(next) => setBuildStatus(p.id, next)}
                      disabled={!!p.archived_at}
                    />
                  </div>
                </td>
                <td className="px-2 py-3">
                  <div className="flex justify-center">
                    <CopyRefButton
                      reference={buildPageRef({ id: p.slug_id, name: p.name, path: p.path })}
                      id={p.slug_id}
                      label="Copy Reference"
                    />
                  </div>
                </td>
                <td className="px-2 py-3 min-w-0 overflow-hidden">
                  <LabelsCell scope="static"
                    value={p.tags ?? []}
                    onChange={(next) => updateTags(p.id, next)}
                    itemName={p.name}
                  />
                </td>
                <td className="px-2 py-3 text-xs text-muted-foreground whitespace-nowrap leading-tight" title={fmtDateTimeFull(p.updated_at)}>
                  {fmtDateTime(p.updated_at) || "—"}
                </td>
                <td className="px-1 py-3 text-center">
                  {designChat && (() => {
                    const pagePath = p.path.startsWith("/") ? p.path : `/${p.path}`;
                    const chosen = designChat.workingPage?.path === pagePath;
                    return (
                      <button
                        onClick={() => choosePage(p)}
                        aria-label={`Change It in Chat: ${p.name}`}
                        aria-pressed={chosen}
                        title="Change It in Chat"
                        className={`p-1.5 rounded border inline-flex ${chosen ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    );
                  })()}
                </td>
                <td className="px-1 py-3 text-center">
                  <button
                    onClick={() => openLive(p.path)}
                    aria-label="Open in New Tab"
                    title="Open in New Tab"
                    className="p-1.5 rounded border hover:bg-muted inline-flex"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </td>
                <td className="px-1 py-3 text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="More Actions"
                        title="More Actions"
                        className="p-1.5 rounded border hover:bg-muted inline-flex"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80" onClick={(event) => event.stopPropagation()}>
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ListPager {...pager} total={filtered.length} />
      </div>



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

