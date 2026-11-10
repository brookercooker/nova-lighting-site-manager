import LibraryWindow from "./LibraryWindow";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { matchesLabelFilter } from "./labelPath";
import { supabase } from "@/prototype/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatBytes } from "@/lib/imageOptimize";
import { uploadImageFile } from "./captureUpload";
import { tileSrcCandidates } from "./imageTileSrc";
import { libraryImageCandidates } from "./imageTileSrc";
import LibraryImageThumbnail from "./LibraryImageThumbnail";
import TagsPanel from "./TagsPanel";
import LibraryLabels from "./LibraryLabels";
import { Trash2, Search, Archive, ArchiveRestore, AlertTriangle, RefreshCw, Download, Globe, Lock } from "lucide-react";
import { GATED_BUCKET, clearAssetUrlCache } from "@/lib/assetUrl";
import { downloadOriginalImage, downloadImagesAsZip } from "./downloadAssets";
import { useImages, useImageThumbnails, usePages } from "./useAdminData";
import { CopyRefButton, buildImageRef } from "./copyReference";
import ConfirmDialog from "./ConfirmDialog";
import { scheduleDeleteWithUndo } from "./deferredDelete";
import { deleteImageFilesAndRows } from "./deleteImages";
import { loadImageDeleteUsageNames } from "./imageDeleteUsages";
import { repairImageMetadata } from "./repairImageMetadata";
import { extractAndPersistExif } from "./imageExif";
import { assetKind, isImageAsset } from "./assetType";
import LabelPicker from "./LabelPicker";
import SelectionBar from "./SelectionBar";
import FilterBar, { type TimeRange as UITimeRange } from "./FilterBar";
import { useImagePageUsages } from "./useAssetPageUsages";
import InUseWarning from "./InUseWarning";
import UsedOnChip, { UsedOnList } from "./UsedOnChip";
import type { AssetUsage } from "./assetUsages";
import { toAbsoluteUrl } from "@/lib/absoluteUrl";

function formatDims(w?: number | null, h?: number | null) {
  return w && h ? `${w} × ${h}` : "—";
}
function fmtSize(n?: number | null) {
  return n && n > 0 ? formatBytes(n) : "—";
}
function formatSavings(orig?: number | null, web?: number | null) {
  const o = fmtSize(orig);
  const w = fmtSize(web);
  if (orig && web && orig > 0 && web > 0 && web < orig) {
    const pct = Math.round((1 - web / orig) * 100);
    return `${o} → ${w} (${pct}% smaller)`;
  }
  return `${o} → ${w}`;
}


interface Img {
  id: string; slug_id: string; filename: string; web_url: string; original_url: string;
  web_path?: string; original_path?: string;
  fallback_url?: string | null; fallback_path?: string | null; fallback_bytes?: number | null;
  alt_text: string; description: string; width: number | null; height: number | null;
  original_bytes: number | null; web_bytes: number | null;
  tags: string[];
  created_at: string; updated_at: string; archived_at?: string | null;
  taken_at?: string | null;
  camera?: string | null;
  lens?: string | null;
  gps_lat?: number | null;
  gps_lng?: number | null;
  place_name?: string | null;
  exif_extracted_at?: string | null;
}


type Field = "all" | "filename" | "id" | "description" | "alt" | "tags" | "used_on" | "location" | "date_taken";
const FIELDS: { v: Field; label: string }[] = [
  { v: "all", label: "All Fields" },
  { v: "filename", label: "Filename" },
  { v: "description", label: "Description" },
  { v: "alt", label: "Alt Text" },
  { v: "tags", label: "Labels" },
  { v: "used_on", label: "Used On (page)" },
  { v: "location", label: "Location" },
  { v: "date_taken", label: "Date Taken" },
];

const SIGN_EXPIRY = 60 * 60 * 24 * 365 * 10;

async function signedUrl(bucket: string, path: string) {
  const { data } = await (supabase as any).storage.from(bucket).createSignedUrl(path, SIGN_EXPIRY);
  return data?.signedUrl ?? "";
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

type TimeRange = UITimeRange;

export default function ImagesTab() {
  const qc = useQueryClient();
  const { data: rawImages = [], isLoading: imagesLoading } = useImages();
  // Safety net: videos live in the Video tool now; hide any stray video rows.
  const images = useMemo(
    () => (rawImages as Img[]).filter((i) => isImageAsset(i.filename || i.web_url)),
    [rawImages],
  );
  const [q, setQ] = useState("");
  const [searchField, setSearchField] = useState<Field>("all");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Images filter by date added (created_at).
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "name_desc">("newest");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [usedOnPage, setUsedOnPage] = useState<string>("all"); // page id or "all"/"none"
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Img | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dragCount, setDragCount] = useState(0);
  const dragDepthRef = useRef(0);
  const [justAddedIds, setJustAddedIds] = useState<string[]>([]);
  const [justAddedAt, setJustAddedAt] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ imgs: Img[]; names: string[] } | null>(null);
  const [checkingDelete, setCheckingDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [brokenIds, setBrokenIds] = useState<Set<string>>(new Set());
  const [failedTileSources, setFailedTileSources] = useState<Record<string, string[]>>({});
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const localPreviewsRef = useRef<Record<string, string>>({});
  const [uploadPreviews, setUploadPreviews] = useState<{ url: string; name: string }[]>([]);
  const objectUrlsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const arrivedThumbsRef = useRef<Record<string, string>>({});
  const revokePreview = (url: string) => {
    if (objectUrlsRef.current.delete(url)) URL.revokeObjectURL(url);
  };
  const removeLocalPreviews = (ids: string[]) => {
    const next = { ...localPreviewsRef.current };
    let changed = false;
    for (const id of ids) {
      if (!next[id]) continue;
      revokePreview(next[id]);
      delete next[id];
      changed = true;
    }
    if (changed) {
      localPreviewsRef.current = next;
      if (mountedRef.current) setLocalPreviews(next);
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);
  const backfilledRef = useRef(false);
  // Tick every 30s so relative timestamps stay fresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const markBroken = (id: string) => setBrokenIds((s) => {
    if (s.has(id)) return s;
    const n = new Set(s); n.add(id); return n;
  });


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "images"] });
  };

  // Silent self-healing: when the list loads, quietly backfill missing
  // width/height/bytes for image assets. Videos are excluded (they don't
  // have decodable image dimensions). No UI, no toasts.
  useEffect(() => {
    if (backfilledRef.current) return;
    if (imagesLoading) return;
    const targets = (images as Img[]).filter(
      (i) => isImageAsset(i.filename ?? i.web_url) && (!i.width || !i.height || !i.web_bytes),
    );
    if (!targets.length) return;
    backfilledRef.current = true;
    (async () => {
      try {
        const res = await repairImageMetadata(
          targets.map((i) => ({
            id: i.id, web_url: i.web_url, filename: i.filename,
            width: i.width, height: i.height,
            web_bytes: i.web_bytes, original_bytes: i.original_bytes,
          })),
        );
        res.brokenIds.forEach(markBroken);
        if (res.updated > 0) invalidate();
      } catch {
        /* silent — background best-effort */
      }
    })();
  }, [images, imagesLoading]);

  // Background EXIF backfill for existing images that were uploaded before
  // capture metadata was tracked. Fetches the original from a signed URL,
  // parses EXIF, reverse-geocodes if GPS is present, and persists. Marks
  // exif_extracted_at either way so we never re-try the same image.
  const exifBackfillRef = useRef(false);
  useEffect(() => {
    if (exifBackfillRef.current) return;
    if (imagesLoading) return;
    const targets = (images as Img[]).filter(
      (i) => isImageAsset(i.filename ?? i.web_url) && !i.exif_extracted_at && !i.archived_at,
    );
    if (!targets.length) return;
    exifBackfillRef.current = true;
    (async () => {
      // Cap at 8 per session and do them serially to avoid hammering the
      // storage bucket / geocoding API.
      const slice = targets.slice(0, 8);
      let touched = 0;
      for (const img of slice) {
        try {
          const path = (img as any).original_path || (img as any).web_path;
          const bucket = (img as any).original_path ? "images-original" : "images-web";
          if (!path) continue;
          const url = await signedUrl(bucket, path);
          if (!url) continue;
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          await extractAndPersistExif(img.id, blob);
          touched++;
        } catch {
          /* silent — per-image */
        }
      }
      if (touched > 0) invalidate();
    })();
  }, [images, imagesLoading]);


  const usageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    (images as Img[]).forEach((img) => (img.tags ?? []).forEach((t) => { c[t] = (c[t] ?? 0) + 1; }));
    return c;
  }, [images]);

  // Live "Used On" data — per-image page usage, reconciled from the code scan.
  const usageAssets = useMemo(
    () => (images as Img[]).map((i) => ({
      id: i.id, slug_id: i.slug_id, filename: i.filename,
      web_path: (i as any).web_path, original_path: (i as any).original_path,
    })),
    [images],
  );
  const { data: usageMap } = useImagePageUsages(usageAssets);
  const usagesFor = (id: string): AssetUsage[] => usageMap?.get(id) ?? [];

  // All pages for "Used on page" dropdown.
  const { data: allPages = [] } = usePages();
  const pageOptions = useMemo(() => {
    const rows = (allPages as any[]).filter((p) => !p.archived_at);
    return [...rows].sort((a, b) => (a.name ?? a.path).localeCompare(b.name ?? b.path));
  }, [allPages]);


  const matches = (img: Img, tags: string[], needle: string) => {
    const n = needle.toLowerCase();
    const test = (v: string) => (v ?? "").toLowerCase().includes(n);
    switch (searchField) {
      case "filename": return test(img.filename);
      case "id": return test(img.slug_id);
      case "description": return test(img.description);
      case "alt": return test(img.alt_text);
      case "tags": return tags.some((t) => t.toLowerCase().includes(n));
      case "used_on": return usagesFor(img.id).some((u) => test(u.name) || test(u.path));
      case "location": return test(img.place_name ?? "");
      case "date_taken": return true; // date_taken uses the date range, not text
      default: {
        const usageNames = usagesFor(img.id).flatMap((u) => [u.name, u.path]);
        return [img.filename, img.slug_id, img.description, img.alt_text, img.place_name ?? "", img.camera ?? "", ...tags, ...usageNames].some((v) => test(v ?? ""));
      }
    }
  };

  const filtered = useMemo(() => {
    const now = Date.now();
    const rangeMs =
      timeRange === "hour" ? 60 * 60 * 1000 :
      timeRange === "day" ? 24 * 60 * 60 * 1000 :
      timeRange === "week" ? 7 * 24 * 60 * 60 * 1000 : 0;
    let list = (images as Img[]).filter((img) => {
      if (hiddenIds.has(img.id)) return false;
      const isArchived = !!img.archived_at;
      if (showArchived ? !isArchived : isArchived) return false;
      const t = img.tags ?? [];
      if (filterTags.length && !filterTags.every((f) => matchesLabelFilter(t, f))) return false;
      // When "Date taken" is the search scope, the date range filters by
      // the EXIF capture date (taken_at). Otherwise it filters by upload date.
      const useTaken = searchField === "date_taken";
      const basisIso = useTaken ? img.taken_at : img.created_at;
      if (useTaken && !basisIso) return false;
      if (basisIso && dateFrom && new Date(basisIso) < new Date(dateFrom)) return false;
      if (basisIso && dateTo && new Date(basisIso) > new Date(dateTo + "T23:59:59")) return false;
      if (rangeMs && (now - new Date(img.created_at).getTime()) > rangeMs) return false;
      if (usedOnPage !== "all") {
        const list = usagesFor(img.id);
        if (usedOnPage === "none") { if (list.length > 0) return false; }
        else if (!list.some((u) => u.pageId === usedOnPage)) return false;
      }
      if (q && !matches(img, t, q)) return false;
      return true;
    });
    const justAdded = new Set(justAddedIds);
    list = [...list].sort((a, b) => {
      // Pin "Just added" batch on top, newest first within it.
      const aJ = justAdded.has(a.id), bJ = justAdded.has(b.id);
      if (aJ !== bJ) return aJ ? -1 : 1;
      if (aJ && bJ) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "name") return a.filename.localeCompare(b.filename);
      if (sort === "name_desc") return b.filename.localeCompare(a.filename);
      const da = new Date(a.created_at).getTime(), db = new Date(b.created_at).getTime();
      return sort === "oldest" ? da - db : db - da;
    });
    return list;
  }, [images, q, searchField, filterTags, dateFrom, dateTo, sort, timeRange, showArchived, hiddenIds, justAddedIds, usedOnPage, usageMap]);


  const archivedCount = useMemo(() => (images as Img[]).filter((i) => i.archived_at).length, [images]);

  // ---- Incremental rendering ------------------------------------------------
  // Only a window of tiles is mounted (and only those get signed/transformed
  // thumbnail URLs). Scrolling near the end grows the window.
  const PAGE_SIZE = 48;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const filterKey = filtered.map((i) => i.id).join(",");
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [filterKey]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisibleCount((c) => (c >= filtered.length ? c : c + PAGE_SIZE));
      }
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);
  const shown = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Batched thumbnail URLs (Supabase image transform, ~320px, WebP-negotiated)
  const publicThumbPaths = useMemo(
    () => shown.filter((i) => (i as any).visibility !== "gated")
      .map((i) => i.web_path).filter(Boolean) as string[],
    [shown],
  );
  const gatedThumbPaths = useMemo(
    () => shown.filter((i) => (i as any).visibility === "gated")
      .map((i) => i.web_path).filter(Boolean) as string[],
    [shown],
  );
  const { data: publicThumbs = {} } = useImageThumbnails("images-web", publicThumbPaths, 400);
  const { data: gatedThumbs = {} } = useImageThumbnails(GATED_BUCKET, gatedThumbPaths, 400);
  const thumbUrls = useMemo(
    () => ({ ...(publicThumbs as Record<string, string>), ...(gatedThumbs as Record<string, string>) }),
    [publicThumbs, gatedThumbs],
  );
  useEffect(() => {
    const newlyReady: string[] = [];
    const ready: string[] = [];
    for (const img of images) {
      const thumb = img.web_path ? thumbUrls[img.web_path] : undefined;
      if (!thumb) continue;
      ready.push(img.id);
      if (arrivedThumbsRef.current[img.id] !== thumb) newlyReady.push(img.id);
      arrivedThumbsRef.current[img.id] = thumb;
    }
    removeLocalPreviews(ready);
    if (newlyReady.length) setFailedTileSources((current) => {
      const next = { ...current };
      newlyReady.forEach((id) => delete next[id]);
      return next;
    });
    if (newlyReady.length) setBrokenIds((current) => {
      const next = new Set(current);
      newlyReady.forEach((id) => next.delete(id));
      return next.size === current.size ? current : next;
    });
  }, [images, thumbUrls, localPreviews]);

  /** Move selected images between the private staging bucket and the public one. */
  const setVisibility = async (ids: string[], action: "publish" | "gate") => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("publish-assets", {
        body: { ids, action },
      });
      if (error) throw error;
      const failed = (data?.results ?? []).filter((r: any) => !r.ok);
      clearAssetUrlCache();
      if (failed.length) toast.error(`${failed.length} image(s) could not be updated`);
      else toast.success(action === "publish"
        ? `Published ${ids.length} image${ids.length === 1 ? "" : "s"} — now publicly reachable`
        : `Gated ${ids.length} image${ids.length === 1 ? "" : "s"} — no longer publicly reachable`);
      setSelected(new Set());
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change visibility");
    } finally {
      setBusy(false);
    }
  };

  const uniqueFilename = (name: string, taken: Set<string>): string => {
    if (!taken.has(name)) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let i = 1; i < 10000; i++) {
      const cand = `${base}-${i}${ext}`;
      if (!taken.has(cand)) return cand;
    }
    return `${base}-${Date.now()}${ext}`;
  };

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const imgs = arr.filter((f) => f.type.startsWith("image/"));
    const videos = arr.filter((f) => f.type.startsWith("video/"));
    const others = arr.filter((f) => !f.type.startsWith("image/") && !f.type.startsWith("video/"));
    if (videos.length) {
      const names = videos.map((f) => f.name).join(", ");
      toast.error("Videos belong in the Video tool", {
        description: `The Images tool only accepts image files. Open the Video tool to upload ${videos.length === 1 ? "this file" : "these files"}: ${names}`,
        duration: 10000,
      });
    }
    if (others.length) {
      const names = others.map((f) => f.name).join(", ");
      toast.error(`${others.length} unsupported file${others.length === 1 ? "" : "s"} skipped`, {
        description: `Only image files (JPG, PNG, WebP, GIF, SVG) can be uploaded here. Skipped: ${names}`,
        duration: 10000,
      });
    }
    if (!imgs.length) return;


    setBusy(true);
    setUploadProgress({ done: 0, total: imgs.length });
    const previews = imgs.map((file) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.add(url);
      return { url, name: file.name };
    });
    setUploadPreviews(previews);
    const created: Img[] = [];
    const taken = new Set<string>((images as Img[]).map((i) => i.filename));

    for (let idx = 0; idx < imgs.length; idx++) {
      const file = imgs[idx];
      const finalName = uniqueFilename(file.name, taken);
      taken.add(finalName);
      try {
        const data = await uploadImageFile(file, { filename: finalName });
        created.push(data);
        if (mountedRef.current) {
          const url = URL.createObjectURL(file);
          objectUrlsRef.current.add(url);
          localPreviewsRef.current = { ...localPreviewsRef.current, [data.id]: url };
          setLocalPreviews(localPreviewsRef.current);
          qc.setQueryData<Img[]>(["admin", "images"], (current = []) => [data, ...current.filter((img) => img.id !== data.id)]);
        }
      } catch (e: unknown) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      } finally {
        revokePreview(previews[idx].url);
        if (mountedRef.current) setUploadPreviews((current) => current.filter((preview) => preview.url !== previews[idx].url));
      }
      setUploadProgress({ done: idx + 1, total: imgs.length });
    }
    setBusy(false);
    setUploadProgress(null);
    invalidate();
    if (created.length) {
      const ids = created.map((c) => c.id);
      setJustAddedIds(ids);
      setJustAddedAt(new Date().toISOString());
      // Pre-select the just-added batch so bulk actions apply immediately.
      setSelected(new Set(ids));
      toast.success(`Uploaded ${created.length} image${created.length === 1 ? "" : "s"} — select labels to tag them.`);
    }
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragDepthRef.current += 1;
    const items = e.dataTransfer?.items;
    const n = items ? Array.from(items).filter((it) => it.kind === "file").length : 0;
    setDragCount(n);
    setDragActive(true);
  };
  const onDragOver = (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) { setDragActive(false); setDragCount(0); }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    setDragCount(0);
    if (e.dataTransfer.files) upload(e.dataTransfer.files);
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) upload(e.target.files); e.target.value = ""; };

  const setImageTags = async (imageId: string, next: string[]) => {
    const clean = Array.from(new Set(next.map((t) => t.trim().toLowerCase()).filter(Boolean)));
    const { error } = await (supabase as any).from("images").update({ tags: clean }).eq("id", imageId);
    if (error) toast.error(error.message);
    invalidate();
  };
  const addTag = async (imageId: string, raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (!tag) return;
    const img = (images as Img[]).find((i) => i.id === imageId);
    const next = Array.from(new Set([...(img?.tags ?? []), tag]));
    await setImageTags(imageId, next);
  };
  const removeTag = async (imageId: string, tag: string) => {
    const img = (images as Img[]).find((i) => i.id === imageId);
    const next = (img?.tags ?? []).filter((t) => t !== tag);
    await setImageTags(imageId, next);
  };


  const requestDelete = async (imgs: Img[]) => {
    if (imgs.length === 0 || checkingDelete) return;
    setCheckingDelete(true);
    try {
      const names = await loadImageDeleteUsageNames(imgs);
      setConfirmDelete({ imgs, names: [...new Set([...names, ...imgs.flatMap(image => usagesFor(image.id).map(usage => usage.name || usage.path))])] });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't check where this image is used. Try again."); }
    finally { setCheckingDelete(false); }
  };

  const doDeleteImages = (imgs: Img[]) => {
    setConfirmDelete(null);
    setDetail(null);
    setSelected(new Set());
    const ids = imgs.map((i) => i.id);
    scheduleDeleteWithUndo({
      label: imgs.length === 1
        ? `Deleted image "${imgs[0].filename}"`
        : `Deleted ${imgs.length} images`,
      hide: () => setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.add(i)); return n; }),
      restore: () => setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }),
      commit: () => deleteImageFilesAndRows(imgs),
      onCommitted: () => { removeLocalPreviews(ids); setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }); invalidate(); },
    });
  };

  const remove = (img: Img) => requestDelete([img]);
  const bulkDelete = () => requestDelete((images as Img[]).filter((i) => selected.has(i.id)));

  const archiveImages = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await (supabase as any).from("images").update({ archived_at: new Date().toISOString() }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    setSelected(new Set());
    setDetail(null);
    toast(`Archived ${ids.length} image${ids.length === 1 ? "" : "s"}`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          await (supabase as any).from("images").update({ archived_at: null }).in("id", ids);
          invalidate();
        },
      },
    });
    invalidate();
  };

  const unarchiveImages = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await (supabase as any).from("images").update({ archived_at: null }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`Restored ${ids.length} image${ids.length === 1 ? "" : "s"}`);
    invalidate();
  };





  const saveField = async (id: string, field: "description" | "alt_text" | "place_name", value: string) => {
    await (supabase as any).from("images").update({ [field]: value }).eq("id", id);
    invalidate();
  };

  const applyTag = async (ids: string[], tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || !ids.length) return;
    const byId = new Map((images as Img[]).map((i) => [i.id, i.tags ?? []]));
    const updates = ids.map((id) => {
      const next = Array.from(new Set([...(byId.get(id) ?? []), t]));
      return (supabase as any).from("images").update({ tags: next }).eq("id", id);
    });
    const results = await Promise.all(updates);
    const err = results.find((r) => r.error)?.error;
    if (err) toast.error(err.message);
    else toast.success(`Labeled ${ids.length} image${ids.length === 1 ? "" : "s"} "${t}"`);
    invalidate();
  };


  const onTileDragStart = (e: DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData("text/plain", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copy";
  };


  return (
    <div className="nova-library-layout flex gap-4 items-start">
      <LibraryLabels><TagsPanel
        scope="images"
        usageCounts={usageCounts}
        activeFilters={filterTags}
        onToggleFilter={(t) => setFilterTags((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])}
        onClearFilters={() => setFilterTags([])}
        selectedCount={selected.size}
        selectedIds={[...selected]}
        onApplyTag={applyTag}
        itemLabel="images"
        filteredCount={filtered.length}
        onSelectAllFiltered={() => setSelected(new Set(filtered.map((i) => i.id)))}
      /></LibraryLabels>

      <div className="nova-library-content flex-1 min-w-0 space-y-3">
      <div
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`border-2 border-dashed rounded-lg py-12 px-6 text-center text-base cursor-pointer transition-colors ${
          dragActive
            ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/40"
            : "text-muted-foreground hover:border-primary hover:bg-primary/5"
        }`}
        onClick={() => fileRef.current?.click()}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
        {uploadPreviews.map((preview) => (
          <img key={preview.url} src={preview.url} alt={preview.name} width={48} height={48}
            className="h-12 w-12 shrink-0 rounded-lg object-cover bg-muted" />
        ))}
        <span>{dragActive
          ? `Drop ${dragCount || ""} file${dragCount === 1 ? "" : "s"} to upload`
          : uploadProgress
            ? `Uploading ${uploadProgress.done} of ${uploadProgress.total}…`
            : busy
              ? "Uploading…"
              : "Drop images here or click to select files from your computer"}</span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-label="Upload Images" onChange={onPick} />
      </div>

      {justAddedIds.length > 0 && justAddedAt && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <div>
            <span className="font-medium text-primary">Just Added</span>{" "}
            <span className="text-muted-foreground">
              {justAddedIds.length} image{justAddedIds.length === 1 ? "" : "s"} · {formatRelative(justAddedAt)} · pre-selected below — apply labels from the sidebar
            </span>
          </div>
          <button
            onClick={() => { setJustAddedIds([]); setJustAddedAt(null); }}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="nova-library-search flex items-stretch gap-0 rounded-lg border-2 border-border focus-within:border-primary bg-background shadow-sm overflow-hidden">
        <div className="flex items-center pl-4 pr-2 text-muted-foreground">
          <Search className="w-5 h-5" />
        </div>
        {searchField === "date_taken" ? (
          <div className="flex-1 flex items-center gap-2 px-2 h-14">
            <label className="text-xs text-muted-foreground shrink-0" htmlFor="images-taken-from">
              Taken on/after
            </label>
            <Input
              id="images-taken-from"
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setTimeRange("custom"); }}
              max={dateTo || undefined}
              className="h-9 w-44"
              aria-label="Date taken — from"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <label className="sr-only" htmlFor="images-taken-to">Taken on/before</label>
            <Input
              id="images-taken-to"
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setTimeRange("custom"); }}
              min={dateFrom || undefined}
              className="h-9 w-44"
              aria-label="Date taken — to"
            />
            {(dateFrom || dateTo) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 text-xs"
                onClick={() => { setDateFrom(""); setDateTo(""); setTimeRange("all"); }}
              >
                Clear
              </Button>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground pr-2">
              Filters by EXIF capture date. Leave a bound blank for on/after or on/before.
            </span>
          </div>
        ) : (
          <Input
            placeholder="Search images…"
            aria-label="Search Images"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 border-0 rounded-none h-14 text-lg focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-2"
          />
        )}
        <select
          value={searchField}
          onChange={(e) => {
            const next = e.target.value as Field;
            setSearchField(next);
            if (next === "date_taken") { setQ(""); setTimeRange("custom"); }
          }}
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
          { v: "newest", label: "Newest" },
          { v: "oldest", label: "Oldest" },
          { v: "name", label: "Name (A–Z)" },
          { v: "name_desc", label: "Name (Z–A)" },
        ]}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        dateFieldLabel={searchField === "date_taken" ? "Taken" : "Added"}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
        archivedCount={archivedCount}
        action={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => { setBrokenIds(new Set()); setFailedTileSources({}); invalidate(); toast.success("Images refreshed"); }}
            title="Refetch from the database and clear cached thumbnails"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="font-medium text-muted-foreground" htmlFor="images-used-on-page">
          Used on Page
        </label>
        <select
          id="images-used-on-page"
          value={usedOnPage}
          onChange={(e) => setUsedOnPage(e.target.value)}
          className="border rounded px-2 py-1 h-9 sm:h-8 text-xs bg-background max-w-full sm:max-w-[260px]"
        >
          <option value="all">Any Page</option>
          <option value="none">Not used on any page</option>
          {pageOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.path} · {p.path}
            </option>
          ))}
        </select>
        {usedOnPage !== "all" && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground underline"
            onClick={() => setUsedOnPage("all")}
          >
            Clear
          </button>
        )}
      </div>


      <SelectionBar
        count={selected.size}
        itemLabel="image"
        onClear={() => setSelected(new Set())}
      >
        {showArchived ? (
          <Button size="sm" variant="outline" onClick={() => unarchiveImages([...selected])}>
            <ArchiveRestore className="w-3.5 h-3.5 mr-1.5" /> Restore
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => archiveImages([...selected])}>
            <Archive className="w-3.5 h-3.5 mr-1.5" /> Archive
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => setVisibility([...selected], "publish")}>
          <Globe className="w-3.5 h-3.5 mr-1.5" /> Publish
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => setVisibility([...selected], "gate")}>
          <Lock className="w-3.5 h-3.5 mr-1.5" /> Gate
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadImagesAsZip((images as Img[]).filter((i) => selected.has(i.id)))}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Download .zip
        </Button>
        <Button size="sm" variant="destructive" onClick={bulkDelete}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Images
        </Button>
      </SelectionBar>



      <div className="nova-library-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
        {imagesLoading && Array.from({ length: 12 }).map((_, i) => (
          <div key={`sk-${i}`} className="aspect-square bg-muted animate-pulse rounded border" />
        ))}
        {!imagesLoading && shown.map((img) => {
          const sel = selected.has(img.id);
          const gated = (img as any).visibility === "gated";
          const signedThumb = img.web_path ? thumbUrls[img.web_path] : undefined;
          const local = localPreviews[img.id];
          const candidates = tileSrcCandidates({ gated, thumb: signedThumb, local, webUrl: img.web_url, fallbackUrl: img.fallback_url, originalUrl: img.original_url });
          const thumb = candidates.find((src) => !(failedTileSources[img.id] ?? []).includes(src)) ?? null;
          const broken = brokenIds.has(img.id);
          const isJustAdded = justAddedIds.includes(img.id);
          return (
            <LibraryWindow key={img.id} kind="image">{() => <div
              draggable
              onDragStart={(e) => onTileDragStart(e, img.id)}
              className={`relative group border rounded overflow-hidden hover:shadow-lg cursor-grab active:cursor-grabbing ${sel ? "ring-2 ring-primary" : ""} ${isJustAdded ? "ring-2 ring-primary/70" : ""} ${broken ? "border-destructive/60" : ""}`}
            >
              {(img as any).visibility === "gated" && (
                <div
                  className="absolute bottom-1 left-1 z-10 flex items-center gap-1 rounded-full bg-background/90 border px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
                  title="Gated — only reachable while signed in. Publish to make it public."
                >
                  <Lock className="w-2.5 h-2.5" /> Gated
                </div>
              )}
              {isJustAdded && (
                <div className="absolute top-1 left-1/2 -translate-x-1/2 z-10 text-[9px] uppercase tracking-wide font-medium bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                  Just Added
                </div>
              )}
              <input type="checkbox" checked={sel}
                aria-label={`Select ${img.alt_text || img.filename || "image"}`}
                onChange={(e) => {
                const n = new Set(selected);
                if (e.target.checked) n.add(img.id); else n.delete(img.id);
                setSelected(n);
              }} className="absolute top-1 left-1 z-10" />
              <div className="nova-library-actions absolute top-1 right-1 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {img.archived_at ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); unarchiveImages([img.id]); }}
                    className="bg-background/90 hover:bg-muted border rounded p-1"
                    title="Restore from Archive"
                  >
                    <ArchiveRestore className="w-3 h-3" />
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); archiveImages([img.id]); }}
                    className="bg-background/90 hover:bg-muted border rounded p-1"
                    title="Archive"
                  >
                    <Archive className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); downloadOriginalImage(img); }}
                  className="bg-background/90 hover:bg-muted border rounded p-1"
                  title="Download Original"
                >
                  <Download className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(img); }}
                  className="bg-background/90 hover:bg-destructive hover:text-destructive-foreground border rounded p-1"
                  title="Delete Image"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              {(() => {
                const kind = assetKind(img.filename || img.web_url);
                if (kind === "video") {
                  return (
                    <video
                      src={img.web_url}
                      onClick={() => setDetail(img)}
                      muted playsInline preload="none"
                      className="w-full aspect-square object-contain cursor-pointer bg-muted"
                    />
                  );
                }
                if (thumb === null) return <div onClick={() => setDetail(img)} className="w-full aspect-square cursor-pointer"><LibraryImageThumbnail candidates={[]} className="h-full w-full" /></div>;
                return (
                  <img key={thumb} src={thumb} alt=""
                    onClick={() => setDetail(img)}
                    onLoad={() => { if (broken) setBrokenIds(previous => { const next = new Set(previous); next.delete(img.id); return next; }); }}
                    onError={() => {
                      const failed = [...(failedTileSources[img.id] ?? []), thumb];
                      setFailedTileSources((current) => ({ ...current, [img.id]: failed }));
                      if (candidates.every((src) => failed.includes(src))) markBroken(img.id);
                    }}
                    width={400} height={400}
                    className="w-full aspect-square object-contain cursor-pointer bg-muted"
                    loading="lazy" decoding="async" fetchPriority="low" />

                );


              })()}
              {img.slug_id && (
                <div
                  className="absolute inset-x-0 top-0 w-full aspect-square z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="pointer-events-auto">
                    <CopyRefButton
                      reference={buildImageRef({ id: img.slug_id, filename: img.filename, url: img.web_url, fallbackUrl: (img as any).fallback_url })}
                      id={img.slug_id}
                      label="Copy Reference"
                    />
                  </div>
                </div>
              )}
              <div className="nova-library-caption p-1 text-[10px] truncate" title={`Uploaded ${new Date(img.created_at).toLocaleString()}`}>
                <div className="flex items-center gap-1 truncate">
                  {broken && <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />}
                  <span className="nova-library-name truncate">{img.filename}</span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-muted-foreground truncate">{formatRelative(img.created_at)}</span>
                  <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <UsedOnChip usages={usagesFor(img.id)} />
                  </span>
                </div>
              </div>
            </div>}</LibraryWindow>
          );
        })}
      </div>

      {!imagesLoading && visibleCount < filtered.length && (
        <div ref={sentinelRef} className="py-6 flex flex-col items-center gap-2">
          <div className="text-xs text-muted-foreground">
            Showing {shown.length} of {filtered.length}
          </div>
          <Button size="sm" variant="outline" onClick={() => setVisibleCount((c) => c + 48)}>
            Load More
          </Button>
        </div>
      )}






      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0"><DialogTitle className="text-sm truncate pr-8">{detail?.filename}</DialogTitle></DialogHeader>
          {detail && <ImageDetail img={detail} tags={((images as Img[]).find((i) => i.id === detail.id)?.tags) ?? detail.tags ?? []} allTags={Object.keys(usageCounts)}
            broken={brokenIds.has(detail.id)}
            onBroken={() => markBroken(detail.id)}
            usages={usagesFor(detail.id)}
            onAddTag={(t) => addTag(detail.id, t)} onRemoveTag={(t) => removeTag(detail.id, t)}
            onSaveAlt={(alt) => saveField(detail.id, "alt_text", alt)}
            onSaveDescription={(d) => saveField(detail.id, "description", d)}
            onSaveLocation={(loc) => saveField(detail.id, "place_name", loc)}
            onDelete={() => remove(detail)}
            onArchive={() => archiveImages([detail.id])}
            onUnarchive={() => unarchiveImages([detail.id])} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
        title={
          confirmDelete
            ? confirmDelete.imgs.length === 1
              ? `Delete ${confirmDelete.imgs[0].filename}?`
              : `Delete ${confirmDelete.imgs.length} images?`
            : ""
        }
        description={
          <>
            {!!confirmDelete?.names.length && <p className="mb-2">Used on: {confirmDelete.names.join(", ")}</p>}
            <p>This can't be undone after the 5-second undo window. Pages that use this image will show their missing-picture fallback.</p>
          </>
        }
        confirmLabel={confirmDelete?.names.length ? "Delete Anyway" : confirmDelete?.imgs.length === 1 ? "Delete Image" : "Delete Images"}
        confirmIcon={<Trash2 className="mr-2 h-4 w-4" aria-hidden />}
        onConfirm={() => confirmDelete && doDeleteImages(confirmDelete.imgs)}
      />
      </div>
    </div>
  );

}

function ImageDetail({ img, tags, allTags, broken, onBroken, usages, onAddTag, onRemoveTag, onSaveAlt, onSaveDescription, onSaveLocation, onDelete, onArchive, onUnarchive }: {
  img: Img; tags: string[]; allTags: string[];
  broken: boolean; onBroken: () => void;
  usages: AssetUsage[];
  onAddTag: (t: string) => void; onRemoveTag: (t: string) => void;
  onSaveAlt: (alt: string) => void; onSaveDescription: (d: string) => void;
  onSaveLocation: (loc: string) => void;
  onDelete: () => void; onArchive: () => void; onUnarchive: () => void;
}) {
  const [alt, setAlt] = useState(img.alt_text ?? "");
  const [description, setDescription] = useState(img.description ?? "");
  const [location, setLocation] = useState(img.place_name ?? "");
  useEffect(() => { setAlt(img.alt_text ?? ""); setDescription(img.description ?? ""); setLocation(img.place_name ?? ""); }, [img.id]);

  const kind = assetKind(img.filename || img.web_url);
  return (
    <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6 overflow-y-auto px-6 py-5">
      <div className="space-y-3 min-w-0">
      {kind === "video" ? (
        <video src={img.web_url} controls className="w-full max-h-[70vh] rounded" preload="metadata" />
      ) : (
        <LibraryImageThumbnail candidates={libraryImageCandidates(img)} className="w-full min-h-32 max-h-[70vh] object-contain rounded-lg bg-muted/30" />
      )}
      <div className="text-xs text-muted-foreground break-all">
        ID: <span className="font-mono">{img.slug_id}</span> · {formatDims(img.width, img.height)} · {formatSavings(img.original_bytes, img.web_bytes)}
        {broken && kind === "image" && <span className="ml-2 text-destructive font-medium">· ⚠ Broken asset</span>}
      </div>
      </div>
      <div className="space-y-3 min-w-0">
      <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
        <div className="uppercase tracking-wide text-[10px] text-muted-foreground font-medium">Capture Metadata</div>
        {img.taken_at && (
          <div>
            <span className="text-muted-foreground">Taken:</span>{" "}
            <span className="font-medium">{new Date(img.taken_at).toLocaleString()}</span>
          </div>
        )}
        {img.camera && (
          <div>
            <span className="text-muted-foreground">Camera:</span>{" "}
            <span className="font-medium">{img.camera}</span>
            {img.lens ? <span className="text-muted-foreground"> · {img.lens}</span> : null}
          </div>
        )}
        <div className="flex items-start gap-2 pt-0.5">
          <span className="text-muted-foreground shrink-0 pt-1.5">Location:</span>
          <div className="flex-1 min-w-0 space-y-1">
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onBlur={() => { if ((location ?? "") !== (img.place_name ?? "")) onSaveLocation(location); }}
              placeholder={img.exif_extracted_at ? "No location info available — add one" : "Add a location…"}
              className="h-7 text-xs"
            />
            {img.gps_lat != null && img.gps_lng != null ? (
              <a
                className="text-[10px] underline text-muted-foreground hover:text-foreground"
                href={`https://www.google.com/maps/search/?api=1&query=${img.gps_lat},${img.gps_lng}`}
                target="_blank"
                rel="noreferrer"
              >
                GPS {img.gps_lat.toFixed(5)}, {img.gps_lng.toFixed(5)}
              </a>
            ) : (
              <div className="text-[10px] text-muted-foreground">
                {img.exif_extracted_at ? "No GPS in file (typical for DSLRs / edited exports)" : "GPS not yet checked"}
              </div>
            )}
          </div>
        </div>
        {!img.taken_at && !img.camera && img.exif_extracted_at && (
          <div className="text-[10px] text-muted-foreground pt-0.5">No EXIF found in this file.</div>
        )}
      </div>


      <div>
        <div className="text-xs mb-1">Description</div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => onSaveDescription(description)}
          className="w-full border rounded p-2 text-sm min-h-[60px]" placeholder="Add a description…" />
      </div>
      <UsedOnList usages={usages} />
      <div>
        <div className="text-xs mb-1">Labels</div>
        <LabelPicker scope="images"
          value={tags}
          onChange={(next) => {
            const added = next.filter((t) => !tags.includes(t));
            const removed = tags.filter((t) => !next.includes(t));
            added.forEach((t) => onAddTag(t));
            removed.forEach((t) => onRemoveTag(t));
          }}
        />
      </div>
      <div>
        <div className="text-xs mb-1">Alt Text</div>
        <Input value={alt} onChange={(e) => setAlt(e.target.value)} onBlur={() => onSaveAlt(alt)} />
      </div>
      <div className="flex gap-2 flex-wrap">
        <CopyRefButton
          reference={buildImageRef({ id: img.slug_id, filename: img.filename, url: img.web_url, fallbackUrl: (img as any).fallback_url })}
          id={img.slug_id}
        />
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(toAbsoluteUrl(img.web_url)); toast.success("URL copied"); }}>
          Copy URL
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadOriginalImage(img)}>
          <Download className="w-4 h-4 mr-1" /> Download Original
        </Button>
        {img.archived_at ? (
          <Button size="sm" variant="outline" onClick={onUnarchive}>
            <ArchiveRestore className="w-4 h-4 mr-1" /> Unarchive
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onArchive}>
            <Archive className="w-4 h-4 mr-1" /> Archive
          </Button>
        )}
        <Button size="sm" variant="destructive" onClick={onDelete}>
          <Trash2 className="w-4 h-4 mr-1" /> Delete Image
        </Button>
      </div>
      </div>
    </div>
  );
}
