import { useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from "react";
import { Box, ExternalLink, Film, Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import { Sheet, SheetClose, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TopDropContent } from "./TopDropPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { imageMatches, loadLibraryImages } from "../ImagePickerDialog";
import { loadLibraryVideos, videoMatches } from "../VideoPickerDialog";
import { loadLibraryObjects, objectMatches } from "../ObjectPickerDialog";
import { matchesLabelFilter } from "../labelPath";
import { useLabelsForScope } from "../useAllLabels";
import LibraryCard, { type LabelColorOf } from "./LibraryCard";
import { colorFor } from "../labelColors";
import LibraryFilterBar, { type SortKey } from "./LibraryFilterBar";
import type { ChatReference } from "./references";
import { GATED_BUCKET } from "@/lib/assetUrl";
import { useImageThumbnails } from "../useAdminData";
import { tileSrcCandidates } from "../imageTileSrc";
import ObjectThumbnail from "../ObjectThumbnail";
import LibraryImageThumbnail from "../LibraryImageThumbnail";
import { matchesObjectPickerFilter, type LabelMatchMode } from "./objectPickerFilter";

export type LibraryKind = "images" | "videos" | "objects";
const PAGE = 60;
const NOUN = { images: "images", videos: "videos", objects: "objects" } as const;
const FULL = { images: "Images", videos: "Videos", objects: "Objects" } as const;
const TITLE = { images: "Pick an Image", videos: "Pick a Video", objects: "Pick an Object" } as const;

type Row = { ref: ChatReference; search: (term: string) => boolean; labels: string[]; note?: string; createdAt?: string; visibility?: string; webPath?: string; webUrl?: string; fallbackUrl?: string; originalUrl?: string };

const byName = (a: Row, b: Row) => a.ref.name.localeCompare(b.ref.name);
const time = (r: Row) => { const t = r.createdAt ? Date.parse(r.createdAt) : NaN; return Number.isNaN(t) ? null : t; };
/** Order rows for the chosen sort; undated items go last in both date orders. */
export function sortRows(rows: Row[], sort: SortKey): Row[] {
  const out = [...rows];
  if (sort === "name-desc") return out.sort((a, b) => byName(b, a));
  if (sort === "newest" || sort === "oldest") return out.sort((a, b) => {
    const ta = time(a), tb = time(b);
    if (ta === null || tb === null) return ta === tb ? byName(a, b) : ta === null ? 1 : -1;
    return (sort === "newest" ? tb - ta : ta - tb) || byName(a, b);
  });
  if (sort === "label") return out.sort((a, b) => {
    const la = a.labels[0], lb = b.labels[0];
    if (!la || !lb) return la === lb ? byName(a, b) : !la ? 1 : -1;
    return la.localeCompare(lb) || byName(a, b);
  });
  return out.sort(byName);
}

/** Load the library through the same loaders the page editor's pickers use. */
async function loadRows(kind: LibraryKind): Promise<Row[]> {
  if (kind === "images") {
    return (await loadLibraryImages(2000)).map((i, n) => ({
      ref: { kind: "image", id: i.id ?? i.url ?? String(n), name: i.name || i.alt || "Untitled image", url: i.url, labels: i.labels, thumb: i.url },
      search: (t) => imageMatches(i, t), labels: i.labels, createdAt: i.createdAt,
      visibility: i.visibility, webPath: i.webPath, webUrl: i.webUrl, fallbackUrl: i.fallbackUrl, originalUrl: i.originalUrl,
    }));
  }
  if (kind === "videos") {
    return (await loadLibraryVideos(2000)).map((v, n) => ({
      ref: { kind: "video", id: v.id ?? v.url ?? String(n), name: v.name || "Untitled video", url: v.url, altUrl: v.altUrl, poster: v.poster, labels: v.labels, thumb: v.poster },
      search: (t) => videoMatches(v, t), labels: v.labels, createdAt: v.createdAt,
    }));
  }
  return (await loadLibraryObjects()).map((o) => {
    const type = o.component_key ? "built in code" : "built in the Site Manager";
    return {
      ref: { kind: "object", id: o.id, name: o.name, componentKey: o.component_key, type, thumb: o.thumbnail_url ?? undefined },
      search: (t) => objectMatches(o, t), labels: o.labels ?? [], note: type, createdAt: o.createdAt,
    };
  });
}

export default function LibraryPicker({ kind, label, Icon, active, showLabel, className, onPick, onOpenFull, addedRefs = [], onDeselectAll, controlledOpen, onOpenChange, anchorRef }: {
  kind: LibraryKind; label: string; Icon: ComponentType<{ className?: string }>; active: boolean; showLabel: boolean; className: string;
  /** Removes every attached reference of this picker's kind (image / video / object). */
  onDeselectAll?: (refKind: ChatReference["kind"]) => void;
  onPick: (ref: ChatReference) => void; onOpenFull: () => void; addedRefs?: ChatReference[];
  controlledOpen?: boolean; onOpenChange?: (open: boolean) => void; anchorRef?: RefObject<HTMLButtonElement>;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const trigger = useRef<HTMLButtonElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [term, setTerm] = useState("");
  const [labelF, setLabelF] = useState("");
  const [objectLabels, setObjectLabels] = useState<string[]>([]);
  const [labelMode, setLabelMode] = useState<LabelMatchMode>("any");
  const [limit, setLimit] = useState(PAGE);
  const [sort, setSort] = useState<SortKey>("name");
  const picked = useRef(false); // after a pick, the chat box keeps focus instead of the tab button

  const { data: labelRows = [], refetch } = useLabelsForScope(kind);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const colorOf = useMemo<LabelColorOf>(() => {
    const idx = new Map(labelRows.map((r: any) => [r.path as string, (r.color_index ?? null) as number | null]));
    const cache = new Map<string, ReturnType<typeof colorFor>>();
    return (p) => { let c = cache.get(p); if (!c) { c = colorFor(p, idx.get(p) ?? null); cache.set(p, c); } return c; };
  }, [labelRows]);
  const allLabels = useMemo(() => [...new Set([...labelRows.map((r) => r.path), ...(rows ?? []).flatMap((r) => r.labels)])].sort((a, b) => a.localeCompare(b)), [labelRows, rows]);
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows ?? []) {
      const paths = new Set(row.labels.flatMap((path) => path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"))));
      for (const path of paths) counts[path] = (counts[path] ?? 0) + 1;
    }
    return counts;
  }, [rows]);
  const addedIds = useMemo(() => new Set(addedRefs.filter((ref) => ref.kind === (kind === "images" ? "image" : kind === "videos" ? "video" : "object")).map((ref) => ref.id)), [addedRefs, kind]);

  useEffect(() => {
    if (!open) return;
    setTerm(""); setLabelF(""); setSort("name"); setLimit(PAGE);
    setObjectLabels([]); setLabelMode("any");
    void refetchRef.current();
    let live = true;
    setRows(null);
    loadRows(kind).then((r) => { if (live) setRows(r); }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [open, kind]);

  const matches = useMemo(() => sortRows((rows ?? [])
    .filter((r) => kind === "objects"
      ? matchesObjectPickerFilter(r, term, objectLabels, labelMode)
      : r.search(term) && (!labelF || matchesLabelFilter(r.labels, labelF))), sort), [rows, kind, term, labelF, objectLabels, labelMode, sort]);
  const showDates = useMemo(() => (rows ?? []).some((r) => !!r.createdAt), [rows]);
  useEffect(() => setLimit(PAGE), [term, labelF, objectLabels, labelMode]);
  const shown = useMemo(() => matches.slice(0, limit), [matches, limit]);
  const publicPaths = useMemo(() => open && kind === "images"
    ? shown.filter((r) => r.visibility !== "gated").flatMap((r) => r.webPath ? [r.webPath] : []) : [], [open, kind, shown]);
  const gatedPaths = useMemo(() => open && kind === "images"
    ? shown.filter((r) => r.visibility === "gated").flatMap((r) => r.webPath ? [r.webPath] : []) : [], [open, kind, shown]);
  const { data: publicThumbs = {} } = useImageThumbnails("images-web", publicPaths, 320);
  const { data: gatedThumbs = {} } = useImageThumbnails(GATED_BUCKET, gatedPaths, 320);
  const filtering = term.trim() !== "" || (kind === "objects" ? objectLabels.length > 0 : labelF !== "");
  const clear = () => { setTerm(""); setLabelF(""); setObjectLabels([]); setLabelMode("any"); };
  const toggleObjectLabel = (path: string) => setObjectLabels(current => !path ? []
    : current.includes(path) ? current.filter(label => label !== path) : [...current, path]);
  const FallbackIcon = kind === "images" ? ImageIcon : kind === "videos" ? Film : Box;

  const finish = () => {
    picked.current = true;
    setOpen(false);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const countRef = useRef(0);
  countRef.current = addedIds.size;

  /** Enter finishes from anywhere in the popup, except controls that own Enter. */
  const handleEnter = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.isComposing || e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : null;
    // Cards own keyboard activation, including deselection of an attached reference.
    if (t?.closest("[data-picker-card]")) return;
    if (t?.closest("[data-picker-own-enter]")) return;
    if (countRef.current === 0) return; // cards select natively; elsewhere nothing happens
    e.preventDefault();
    finishRef.current();
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (!(e.target instanceof Element && e.target.closest("[role=dialog]"))) handleEnter(e); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!anchorRef && <SheetTrigger asChild>
        <Button ref={trigger} variant="ghost" type="button" title={label} aria-label={label} aria-current={active ? "page" : undefined}
          aria-haspopup="dialog" aria-expanded={open} aria-pressed={open} className={`${className} data-[picker-open=true]:bg-accent data-[picker-open=true]:text-accent-foreground`}>
          <Icon className="w-4 h-4" />
          {showLabel && <span>{label}</span>}
        </Button>
      </SheetTrigger>}
      <TopDropContent hideClose anchorRef={anchorRef ?? trigger}
        onKeyDown={(e) => handleEnter(e.nativeEvent)}
        onCloseAutoFocus={(e) => { if (picked.current) { e.preventDefault(); picked.current = false; } else if (anchorRef) { e.preventDefault(); anchorRef.current?.focus(); } }}>
        <div className="shrink-0 space-y-2 border-b border-border bg-background p-4">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>{TITLE[kind]}</SheetTitle>
            <Button variant="link" size="sm" type="button" onClick={() => { setOpen(false); onOpenFull(); }}
              className="ml-auto h-auto gap-1 p-0 text-xs text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />Manage {FULL[kind]}
            </Button>
            <SheetClose asChild><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" data-picker-own-enter=""><X className="h-4 w-4" /></Button></SheetClose>
          </div>
          <SheetDescription className="sr-only">Search and Pick {NOUN[kind]} to add to the chat.</SheetDescription>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} aria-label={`Search ${FULL[kind]}`}
              placeholder={`Search ${NOUN[kind]} by name or label…`} className="h-11 pl-9 text-base"
 />
          </div>
          <LibraryFilterBar colorOf={colorOf} labels={allLabels} labelCounts={labelCounts} label={labelF} setLabel={setLabelF}
            multiLabels={kind === "objects" ? objectLabels : undefined} onToggleLabel={toggleObjectLabel} labelMode={labelMode} setLabelMode={setLabelMode}
            sort={sort} setSort={setSort} showDates={showDates} shown={Math.min(limit, matches.length)} total={matches.length} filtering={filtering} onClear={clear} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {rows === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading {NOUN[kind]}…</div>
          ) : matches.length === 0 ? (
            <div className="space-y-2 py-10 text-center">
              <p className="text-sm">No {NOUN[kind]} match</p>
              <p className="text-xs text-muted-foreground">Try fewer words or clear the filters</p>
              {filtering && <Button variant="outline" size="sm" onClick={clear}>Clear Filters</Button>}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
                {shown.map((r) => (
                  <LibraryCard key={r.ref.id} item={r.ref} labels={r.labels} note={r.note} selected={addedIds.has(r.ref.id)} FallbackIcon={FallbackIcon} colorOf={colorOf} onPick={() => onPick(r.ref)}
                    thumbnail={kind === "images" ? <LibraryImageThumbnail className="absolute inset-0 h-full w-full object-contain object-center" candidates={tileSrcCandidates({
                      gated: r.visibility === "gated",
                      thumb: r.webPath ? (r.visibility === "gated" ? gatedThumbs : publicThumbs)[r.webPath] : undefined,
                      webUrl: r.webUrl ?? (r.ref.kind === "image" ? r.ref.url : ""),
                      fallbackUrl: r.fallbackUrl, originalUrl: r.originalUrl,
                    })} /> : r.ref.kind === "object" ? <ObjectThumbnail id={r.ref.id} storedThumb={r.ref.thumb} /> : undefined} />
                ))}
              </div>
              {matches.length > limit && (
                <div className="mt-4 flex justify-center">
                  <Button variant="outline" data-picker-own-enter="" onClick={() => setLimit((l) => l + PAGE)}>Show More</Button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm" aria-live="polite">{addedIds.size > 0 ? `${addedIds.size} selected` : "Nothing selected yet"}</span>
            <Button variant="ghost" size="sm" data-picker-own-enter="" disabled={addedIds.size === 0}
              onClick={() => onDeselectAll?.(kind === "images" ? "image" : kind === "videos" ? "video" : "object")}>Deselect All</Button>
          </div>
          <div className="flex items-center gap-2">
            <Button data-picker-own-enter="" onClick={finish}>Done</Button>
          </div>
        </div>
      </TopDropContent>
    </Sheet>
  );
}
