import { useEffect, useMemo, useState } from "react";
import { matchesLabelFilter } from "./labelPath";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Play, Loader2, Trash2, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/prototype/client";
import { buildAuditRows, pageProblems, statusLabel, unscannedDestinations, FOOTER_LOCATION, HEADER_LOCATION, type LinkStatus, type PageProblem, type PageScan } from "./publicLinkAudit";
import { scanPublicPages } from "./publicLinkScan";
import { draftEmbedUrl, loadSiteManifest } from "./siteManifest";
import { publicPreviewBase } from "./designChat/publicPreviewUrl";
import { isInternalPath, pageKey } from "./designChat/registerPage";
import CreatePageDialog from "./CreatePageDialog";
import TagsPanel from "./TagsPanel";
import LabelPicker from "./LabelPicker";
import SelectionBar from "./SelectionBar";

interface DbPage { id: string; slug_id: string; name: string; path: string; archived_at?: string | null; }

/** Older scans stored the header as "Header mega-menu"; it still sorts first. */
const LEGACY_HEADER = "Header mega-menu";
/** Destinations found on pages that the scan also loads to check, at most this many per scan. */
const MAX_EXTRA_DESTINATIONS = 150;

interface Row {
  id: string;
  identity_key: string;
  location: string;
  link_text: string;
  destination: string;
  status: LinkStatus | string;
  type: string;
  is_chrome: boolean;
  is_deleted: boolean;
  dismissed: boolean;
  tags: string[];
  source_pages: string[];
  first_seen_at: string;
  last_seen_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  Registered: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  Pending: "bg-brass/20 text-brass border-brass/40",
  Broken: "bg-destructive/15 text-destructive border-destructive/40",
  External: "bg-sky-500/15 text-sky-700 border-sky-500/30",
  "Self-Referencing": "bg-amber-500/15 text-amber-700 border-amber-500/30",
  Unchecked: "bg-muted text-muted-foreground border-border",
};
const STATUS_ORDER: LinkStatus[] = ["Registered", "Pending", "Broken", "External", "Self-Referencing", "Unchecked"];
const PROBLEM_TEXT: Record<PageProblem["problem"], string> = {
  "not-found": "Page not found on the public site",
  "coming-soon": "Shows the Coming Soon placeholder",
  unreachable: "Didn't load in time, so its links weren't checked",
};

export default function LinkAuditView({ pages }: { pages: DbPage[] }) {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [problems, setProblems] = useState<PageProblem[]>([]);


  const livePages = useMemo(() => pages.filter((p) => !p.archived_at), [pages]);

  // ---- Load persisted results on mount ----
  const loadPersisted = async () => {
    const [{ data: rowData }, { data: metaData }] = await Promise.all([
      (supabase as any).from("link_audit_rows").select("*").order("location").order("link_text"),
      (supabase as any).from("link_audit_meta").select("*").eq("id", 1).maybeSingle(),
    ]);
    setRows((rowData ?? []) as Row[]);
    if (metaData?.last_ran_at) setLastRun(new Date(metaData.last_ran_at));
    if (metaData?.scanned_pages) setScannedPages(metaData.scanned_pages);
    const saved = (metaData?.summary as { problems?: unknown } | null)?.problems;
    setProblems(Array.isArray(saved) ? saved.filter((p): p is PageProblem => !!p && typeof p.path === "string" && typeof p.problem === "string") : []);
  };
  useEffect(() => { loadPersisted(); }, []);

  const runScan = async () => {
    setScanning(true);
    setProgress(0);
    try {
      // The public site itself, at the same address the preview uses (never the Site Manager's own page copies).
      let base: string;
      try { base = draftEmbedUrl() ?? publicPreviewBase(null); }
      catch { toast.error("Couldn't reach the public site. Open the Preview once, then try again."); return; }
      const siteOrigin = new URL(base).origin;

      // Every page the public site has (its manifest) plus every page kept in the database.
      let manifestPaths: string[] = [];
      try { manifestPaths = (await loadSiteManifest()).pages.map((p) => p.path); }
      catch { toast.warning("Couldn't read the public site's page list. Scanning the pages saved here only."); }
      const routes = [...new Set([...manifestPaths, ...livePages.map((p) => p.path)].filter(Boolean).map(pageKey))]
        .filter((path) => !isInternalPath(path)).sort();

      // Pass 1: every page. Pass 2: destinations those pages link to that weren't in the list (to tell missing from Coming Soon).
      const pages = await scanPublicPages(base, routes, (done) => setProgress(Math.round((done / routes.length) * 80)));
      const extra = unscannedDestinations(pages, siteOrigin).slice(0, MAX_EXTRA_DESTINATIONS);
      const extraScans = extra.length ? await scanPublicPages(base, extra, (done) => setProgress(80 + Math.round((done / extra.length) * 20))) : [];
      setProgress(100);
      const results = new Map<string, PageScan>([...pages, ...extraScans].map((p) => [pageKey(p.path), p]));
      const reached = pages.filter((p) => p.status !== "unreachable").length;
      if (reached === 0) {
        toast.error("None of the public site's pages answered. Check the Preview loads, then try again. Saved results were kept.");
        return;
      }
      const classified = buildAuditRows(pages, results, siteOrigin).map((r) => ({ ...r, key: r.identity_key }));
      const foundProblems = pageProblems(pages);

      // ---- DIFF against persisted rows ----
      const { data: existing } = await (supabase as any)
        .from("link_audit_rows").select("*");
      // Rows saved by the old scanner (which read the Site Manager's own page copies) used "location::text" keys.
      // Their labels carry over to the matching new row; the old rows themselves are then removed.
      const isLegacy = (r: Row) => r.identity_key.split("::").length === 2;
      const legacy = ((existing ?? []) as Row[]).filter(isLegacy);
      const legacyByKey = new Map(legacy.map((r) => [r.identity_key, r]));
      const legacyFor = (c: { location: string; link_text: string }) =>
        legacyByKey.get(`${c.location === HEADER_LOCATION ? LEGACY_HEADER : c.location}::${c.link_text.toLowerCase().trim()}`);
      const existingByKey = new Map<string, Row>(((existing ?? []) as Row[]).filter((r) => !isLegacy(r)).map((r) => [r.identity_key, r]));
      const nowIso = new Date().toISOString();
      const seenKeys = new Set<string>();

      const upserts: any[] = [];
      for (const c of classified) {
        seenKeys.add(c.key);
        const prev = existingByKey.get(c.key) ?? legacyFor(c);
        upserts.push({
          identity_key: c.key,
          location: c.location,
          link_text: c.link_text,
          destination: c.destination,
          status: c.status,
          type: c.type,
          is_chrome: c.is_chrome,
          is_deleted: false,
          dismissed: prev?.dismissed ?? false,
          tags: prev?.tags ?? [],
          source_pages: c.source_pages,
          first_seen_at: prev?.first_seen_at ?? nowIso,
          last_seen_at: nowIso,
        });
      }

      // Chunk upserts.
      const chunk = 200;
      for (let i = 0; i < upserts.length; i += chunk) {
        const { error } = await (supabase as any)
          .from("link_audit_rows")
          .upsert(upserts.slice(i, i + chunk), { onConflict: "identity_key" });
        if (error) { toast.error(error.message); throw error; }
      }

      // Mark rows not in this scan as deleted. A page that didn't load this time keeps its rows as they were.
      const notLoaded = new Set(pages.filter((p) => p.status === "unreachable").map((p) => pageKey(p.path)));
      const deletedKeys = [...existingByKey.values()]
        .filter((r) => !seenKeys.has(r.identity_key) && !(!r.is_chrome && notLoaded.has(r.location)))
        .map((r) => r.identity_key);
      if (deletedKeys.length > 0) {
        const { error } = await (supabase as any)
          .from("link_audit_rows")
          .update({ is_deleted: true })
          .in("identity_key", deletedKeys);
        if (error) toast.error(error.message);
      }
      if (legacy.length > 0) {
        const { error } = await (supabase as any).from("link_audit_rows").delete().in("id", legacy.map((r) => r.id));
        if (error) toast.error(error.message);
      }

      // Save meta.
      const summary = {
        Registered: classified.filter((r) => r.status === "Registered").length,
        Pending: classified.filter((r) => r.status === "Pending").length,
        Broken: classified.filter((r) => r.status === "Broken").length,
        External: classified.filter((r) => r.status === "External").length,
        SelfRef: classified.filter((r) => r.status === "Self-Referencing").length,
        Unchecked: classified.filter((r) => r.status === "Unchecked").length,
        problems: foundProblems,
        source: siteOrigin,
      };
      await (supabase as any).from("link_audit_meta").upsert({
        id: 1, last_ran_at: nowIso, summary, scanned_pages: routes,
      }, { onConflict: "id" });

      await loadPersisted();
      const skipped = routes.length - reached;
      toast.success(`Scanned ${reached} public page${reached === 1 ? "" : "s"}: ${upserts.length} link${upserts.length === 1 ? "" : "s"} tracked${skipped ? `. ${skipped} page${skipped === 1 ? "" : "s"} didn't load` : ""}.`);
    } finally {
      setScanning(false);
    }
  };

  // ---- Actions ----
  const updateTags = async (row: Row, tags: string[]) => {
    setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, tags } : r)));
    const { error } = await (supabase as any)
      .from("link_audit_rows").update({ tags }).eq("id", row.id);
    if (error) { toast.error(error.message); await loadPersisted(); }
  };

  const dismissRow = async (row: Row) => {
    setRows((cur) => cur.filter((r) => r.id !== row.id));
    setSelectedIds((cur) => cur.filter((id) => id !== row.id));
    const { error } = await (supabase as any).from("link_audit_rows").delete().eq("id", row.id);
    if (error) { toast.error(error.message); await loadPersisted(); }
  };

  const applyTagBulk = async (ids: string[], tag: string) => {
    const targets = rows.filter((r) => ids.includes(r.id));
    const updates = targets
      .filter((r) => !r.tags.includes(tag))
      .map((r) => ({ id: r.id, tags: [...r.tags, tag] }));
    if (updates.length === 0) {
      toast.info(`All selected already have "${tag}"`);
      return;
    }
    setRows((cur) => cur.map((r) => {
      const u = updates.find((x) => x.id === r.id);
      return u ? { ...r, tags: u.tags } : r;
    }));
    const results = await Promise.all(updates.map((u) =>
      (supabase as any).from("link_audit_rows").update({ tags: u.tags }).eq("id", u.id)
    ));
    const failed = results.filter((r) => r.error).length;
    if (failed > 0) { toast.error(`${failed} update(s) failed`); await loadPersisted(); }
    else toast.success(`Applied "${tag}" to ${updates.length} link(s)`);
  };


  // ---- Derived ----
  const activeRows = useMemo(() => rows.filter((r) => !r.is_deleted), [rows]);
  const deletedRows = useMemo(() => rows.filter((r) => r.is_deleted), [rows]);

  const locations = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => s.add(r.location));
    return [...s].sort((a, b) => {
      if (a === HEADER_LOCATION || a === LEGACY_HEADER) return -1;
      if (b === HEADER_LOCATION || b === LEGACY_HEADER) return 1;
      if (a === FOOTER_LOCATION) return -1;
      if (b === FOOTER_LOCATION) return 1;
      return a.localeCompare(b);
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (locationFilter !== "all" && r.location !== locationFilter) return false;
      if (tagFilters.length && !tagFilters.every((t) => matchesLabelFilter(r.tags, t))) return false;
      if (term && ![r.destination, r.link_text, r.location, ...(r.source_pages || [])].some((v) => (v || "").toLowerCase().includes(term))) return false;
      return true;
    });
  }, [rows, q, statusFilter, typeFilter, locationFilter, tagFilters]);

  const tagUsageCounts = useMemo(() => {
    const map: Record<string, number> = {};
    activeRows.forEach((r) => r.tags.forEach((t) => { map[t] = (map[t] ?? 0) + 1; }));
    return map;
  }, [activeRows]);

  const counts = useMemo(() => {
    const c = { Registered: 0, Pending: 0, Broken: 0, External: 0, SelfRef: 0, Unchecked: 0 };
    activeRows.forEach((r) => {
      if (r.status === "Registered") c.Registered++;
      else if (r.status === "Pending") c.Pending++;
      else if (r.status === "Broken") c.Broken++;
      else if (r.status === "External") c.External++;
      else if (r.status === "Self-Referencing") c.SelfRef++;
      else if (r.status === "Unchecked") c.Unchecked++;
    });
    return c;
  }, [activeRows]);
  /** Types actually present, so the filter never lists empty choices. */
  const types = useMemo(() => [...new Set(rows.map((r) => r.type).filter(Boolean))].sort(), [rows]);

  const orphans = useMemo(() => {
    if (activeRows.length === 0) return [];
    const incoming = new Set<string>();
    activeRows.forEach((r) => {
      if (!r.destination || !r.destination.startsWith("/")) return;
      incoming.add(pageKey(r.destination));
    });
    return livePages.filter((p) => !!p.path && !incoming.has(pageKey(p.path)));
  }, [activeRows, livePages]);

  const brokenDestinations = useMemo(() => {
    const set = new Map<string, Row>();
    activeRows.filter((r) => r.status === "Broken").forEach((r) => set.set(r.destination, r));
    return [...set.values()];
  }, [activeRows]);

  const toggleTagFilter = (t: string) =>
    setTagFilters((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      {/* Phones: labels stack above the results in a bounded, scrollable panel; desktop keeps the sidebar unchanged. */}
      <div className="w-full sm:contents max-sm:[&>aside]:static max-sm:[&>aside]:w-full max-sm:[&>aside]:max-h-56 max-sm:[&>aside]:overflow-y-auto max-sm:[&_button]:min-h-9 max-sm:[&_input]:h-9">
      <TagsPanel
        scope="links"
        usageCounts={tagUsageCounts}
        activeFilters={tagFilters}
        onToggleFilter={toggleTagFilter}
        onClearFilters={() => setTagFilters([])}
        selectedCount={selectedIds.length}
        selectedIds={selectedIds}
        onApplyTag={applyTagBulk}
        itemLabel="links"
        filteredCount={filtered.filter((r) => !r.is_deleted).length}
        onSelectAllFiltered={() => setSelectedIds(filtered.filter((r) => !r.is_deleted).map((r) => r.id))}
      />
      </div>


      <div className="flex-1 min-w-0 space-y-4">
      <div className="flex items-center gap-3 flex-wrap p-4 border rounded-lg bg-muted/20">
        <Button onClick={runScan} disabled={scanning} className="gap-2 max-sm:w-full max-sm:whitespace-normal max-sm:h-auto max-sm:min-h-10">
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {scanning ? `Scanning… ${progress}%` : "Scan the Public Site"}
        </Button>
        <div className="text-xs text-muted-foreground">
          {lastRun ? `Last scan: ${lastRun.toLocaleString()} · ${scannedPages.length} page${scannedPages.length === 1 ? "" : "s"}` : "No scans yet. Click Scan the Public Site to begin."}
          <span className="block">Checks the links visitors actually see, by loading each page of the public site. Links to other sites aren't checked.</span>
        </div>
      </div>

      {problems.length > 0 && (
        <section className="space-y-2" aria-labelledby="audit-problems">
          <h3 id="audit-problems" className="flex items-center gap-1.5 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />Pages That Didn't Load ({problems.length})</h3>
          <div className="border rounded-lg divide-y">
            {problems.map((p) => (
              <div key={p.path} className="p-3 flex items-center gap-3 flex-wrap text-sm">
                <span className="font-mono text-xs">{p.path}</span>
                <span className="text-muted-foreground text-xs">{PROBLEM_TEXT[p.problem] ?? p.problem}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <>
          <div className={`grid grid-cols-2 gap-3 ${counts.Unchecked ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
            <SummaryCard label="Working" value={counts.Registered} />
            <SummaryCard label="Broken" value={counts.Broken} tone={counts.Broken ? "bad" : undefined} />
            <SummaryCard label="Coming Soon" value={counts.Pending} />
            <SummaryCard label="Other Sites" value={counts.External} />
            <SummaryCard label="Same Page" value={counts.SelfRef} />
            {counts.Unchecked > 0 && <SummaryCard label="Couldn't Check" value={counts.Unchecked} tone="warn" />}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter results…" className="pl-9" />
            </div>
            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}
              className="text-sm border rounded px-2 h-9 bg-background max-w-full sm:max-w-[200px]">
              <option value="all">All Locations</option>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status"
              className="text-sm border rounded px-2 h-9 bg-background">
              <option value="all">All Statuses</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type"
              className="text-sm border rounded px-2 h-9 bg-background">
              <option value="all">All Types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">{filtered.length} results</span>
          </div>

          <SelectionBar
            count={selectedIds.length}
            itemLabel="link"
            onClear={() => setSelectedIds([])}
            hint={<>Click <Plus className="inline w-3 h-3" /> on a label in the sidebar to apply in bulk</>}
          />


          <ul className="space-y-2 sm:hidden" aria-label="Link Results">
            {filtered.map((r) => {
              const checked = selectedIds.includes(r.id);
              return (
                <li key={r.id} data-testid="link-card" className={`min-w-0 rounded-lg border p-3 text-xs ${r.is_deleted ? "bg-destructive/5" : checked ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start gap-2">
                    <label className="-m-2 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center">
                      <Checkbox checked={checked} aria-label="Select Row"
                        onCheckedChange={(v) => setSelectedIds((cur) => v ? [...cur, r.id] : cur.filter((id) => id !== r.id))} />
                    </label>
                    <div className="min-w-0 flex-1 font-medium break-words">{r.link_text || <span className="italic opacity-60">No wording</span>}</div>
                    <span className={`shrink-0 px-2 py-0.5 rounded border text-[10px] font-medium ${STATUS_COLORS[r.status] ?? STATUS_COLORS.Unchecked}`}>{statusLabel(r.status)}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                    <dt className="text-muted-foreground">Found On</dt>
                    <dd className="min-w-0 break-all">{r.is_chrome ? <>{r.location === LEGACY_HEADER ? HEADER_LOCATION : r.location} <span className="text-muted-foreground">(every page)</span></> : r.location ? <span className="font-mono text-[11px]">{r.location}</span> : "—"}</dd>
                    <dt className="text-muted-foreground">Destination</dt>
                    <dd className="min-w-0 break-all font-mono text-[11px]">{r.destination || "—"}</dd>
                    <dt className="text-muted-foreground">Type</dt>
                    <dd>{r.type}</dd>
                  </dl>
                  <div className="mt-2 flex items-center justify-between gap-2 [&_button]:min-h-9">
                    <LabelPicker scope="links" value={r.tags} onChange={(next) => updateTags(r, next)} triggerLabel="Add" compact />
                    {r.is_deleted && <Button type="button" variant="outline" size="sm" className="h-9 gap-1" onClick={() => dismissRow(r)}><Trash2 className="w-3.5 h-3.5" />Dismiss</Button>}
                    {r.is_deleted && <span className="text-[10px] text-destructive">Deleted</span>}
                  </div>
                </li>
              );
            })}
            {filtered.length === 0 && <li className="py-8 text-center text-muted-foreground">No matching links.</li>}
          </ul>

          <div className="hidden sm:block border rounded-lg overflow-hidden">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: "36px" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "110px" }} />
                <col />
                <col style={{ width: "48px" }} />
              </colgroup>
              <thead className="bg-muted/40 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-2 py-2">
                    <Checkbox
                      checked={
                        filtered.length > 0 &&
                        filtered.every((r) => selectedIds.includes(r.id))
                      }
                      onCheckedChange={(v) => {
                        if (v) setSelectedIds(Array.from(new Set([...selectedIds, ...filtered.map((r) => r.id)])));
                        else {
                          const fIds = new Set(filtered.map((r) => r.id));
                          setSelectedIds(selectedIds.filter((id) => !fIds.has(id)));
                        }
                      }}
                      aria-label="Select All"
                    />
                  </th>
                  <th className="text-left px-3 py-2">Link Text</th>
                  <th className="text-left px-3 py-2">Found On</th>
                  <th className="text-left px-3 py-2">Destination</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Labels</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const checked = selectedIds.includes(r.id);
                  return (
                  <tr key={r.id} className={`border-t align-top ${r.is_deleted ? "bg-destructive/5" : checked ? "bg-primary/5" : ""}`}>
                    <td className="px-2 py-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => {
                          setSelectedIds((cur) => v ? [...cur, r.id] : cur.filter((id) => id !== r.id));
                        }}
                        aria-label="Select Row"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="truncate" title={r.link_text}>{r.link_text || <span className="italic opacity-60">No wording</span>}</div>
                      {r.is_deleted && (
                        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded border border-destructive/40 text-destructive bg-destructive/10">
                          Deleted
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.is_chrome ? (
                        <span className="font-medium" title="Shown on every page">{r.location === LEGACY_HEADER ? HEADER_LOCATION : r.location} <span className="font-normal text-muted-foreground">(every page)</span></span>
                      ) : r.location ? (
                        <span className="block truncate font-mono text-[11px]" title={r.location}>{r.location}</span>
                      ) : (
                        <span className="opacity-60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs break-all">{r.destination || <span className="opacity-60">—</span>}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-medium ${STATUS_COLORS[r.status] ?? STATUS_COLORS.Unchecked}`}>
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.type}</td>
                    <td className="px-3 py-2">
                      <LabelPicker scope="links"
                        value={r.tags}
                        onChange={(next) => updateTags(r, next)}
                        triggerLabel="Add"
                        compact
                      />
                    </td>
                    <td className="px-2 py-2">
                      {r.is_deleted && (
                        <button
                          onClick={() => dismissRow(r)}
                          className="p-1 rounded hover:bg-destructive hover:text-destructive-foreground"
                          title="Dismiss Deleted Row"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-muted-foreground py-8">No matching links.</td></tr>
                )}
              </tbody>
            </table>
          </div>


          {deletedRows.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {deletedRows.length} link{deletedRows.length === 1 ? "" : "s"} marked <strong>Deleted</strong>: found by an earlier scan but no longer on the site (not counted above).
            </div>
          )}

          {brokenDestinations.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Links to Missing Pages ({brokenDestinations.length})</h3>
              <div className="border rounded-lg divide-y">
                {brokenDestinations.map((r) => (
                  <div key={r.destination} className="p-3 flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-xs flex-1 min-w-0 truncate">{r.destination}</span>
                    <Button size="sm" variant="outline" onClick={() =>
                      setPrefill((r.destination.replace(/^\/+/, "") || r.link_text) || "New Page")
                    }>Create This Page</Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {orphans.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Pages Nothing Links To ({orphans.length})</h3>
              <div className="border rounded-lg divide-y">
                {orphans.map((p) => (
                  <div key={p.id} className="p-3 text-sm flex items-center gap-3">
                    <span className="font-medium">{p.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{p.path}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <CreatePageDialog
        open={!!prefill}
        onOpenChange={(o) => !o && setPrefill(null)}
        initialName={prefill ?? ""}
      />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" }) {
  const cls = tone === "bad" ? "border-destructive/40 text-destructive"
    : tone === "warn" ? "border-amber-500/40 text-amber-700" : "";
  return (
    <div className={`border rounded-lg p-3 ${cls}`}>
      <div className="text-2xl font-medium">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
