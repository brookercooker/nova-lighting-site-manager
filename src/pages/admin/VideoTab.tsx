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
import TagsPanel from "./TagsPanel";
import LibraryLabels from "./LibraryLabels";
import {
  Copy, Trash2, Search, Archive, ArchiveRestore, RefreshCw, Link as LinkIcon,
  Play, Youtube, Video as VideoIcon, Download, Lock, Globe,
} from "lucide-react";
import { downloadOriginalVideo, downloadVideosAsZip } from "./downloadAssets";
import { useVideos } from "./useAdminData";
import { usePages } from "./useAdminData";
import { CopyRefButton, buildVideoRef } from "./copyReference";
import ConfirmDialog from "./ConfirmDialog";
import { scheduleDeleteWithUndo } from "./deferredDelete";
import LabelPicker from "./LabelPicker";
import SelectionBar from "./SelectionBar";
import {
  formatDuration, parseExternalVideoUrl, probeVideoFile, capturePosterFromUrl, VideoSource,
} from "./videoHelpers";
import { SignedThumbImg, usePageThumbSrc } from "./signedThumb";
import { useResolvedAssetUrl } from "@/hooks/useResolvedAssetUrl";
import { useVideoPageUsages } from "./useAssetPageUsages";
import InUseWarning from "./InUseWarning";
import UsedOnChip, { UsedOnList } from "./UsedOnChip";
import type { AssetUsage } from "./assetUsages";
import { toAbsoluteUrl } from "@/lib/absoluteUrl";
import { POSTER_BUCKET, videoBucketFor } from "./captureUpload";
import { VIDEO_GATED_BUCKET, clearAssetUrlCache, resolveAssetUrl } from "@/lib/assetUrl";

interface Vid {
  id: string;
  slug_id: string;
  name: string;
  source_type: VideoSource;
  storage_path: string | null;
  storage_url: string | null;
  external_url: string | null;
  external_video_id: string | null;
  poster_url: string | null;
  poster_path: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  file_bytes: number | null;
  alt_path?: string | null;
  alt_url?: string | null;
  alt_mime?: string | null;
  alt_bytes?: number | null;
  visibility?: string | null;
  alt_text: string;
  description: string;
  tags: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

type Field = "all" | "name" | "id" | "description" | "alt" | "tags" | "used_on";
const FIELDS: { v: Field; label: string }[] = [
  { v: "all", label: "All Fields" },
  { v: "name", label: "Name" },
  { v: "description", label: "Description" },
  { v: "alt", label: "Alt Text" },
  { v: "tags", label: "Labels" },
  { v: "used_on", label: "Used On (page)" },
];
type TimeRange = "all" | "hour" | "day" | "week";

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

function fmtDims(w?: number | null, h?: number | null) {
  return w && h ? `${w} × ${h}` : "—";
}
function fmtSize(n?: number | null) {
  return n && n > 0 ? formatBytes(n) : "—";
}
function sourceLabel(v: Vid) {
  if (v.source_type === "upload") return "Uploaded";
  if (v.source_type === "youtube") return "YouTube";
  if (v.source_type === "vimeo") return "Vimeo";
  return v.source_type;
}
function SourceBadge({ v }: { v: Vid }) {
  const Icon = v.source_type === "youtube" ? Youtube : v.source_type === "vimeo" ? VideoIcon : Play;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-background/90 border">
      <Icon className="w-3 h-3" /> {sourceLabel(v)}
    </span>
  );
}

export default function VideoTab() {
  const qc = useQueryClient();
  const { data: videos = [], isLoading } = useVideos();

  const [q, setQ] = useState("");
  const [searchField, setSearchField] = useState<Field>("all");
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "name_desc">("newest");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Vid | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragCount, setDragCount] = useState(0);
  const dragDepthRef = useRef(0);
  const [justAddedIds, setJustAddedIds] = useState<string[]>([]);
  const [justAddedAt, setJustAddedAt] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ vids: Vid[] } | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "videos"] });

  // Backfill posters for videos missing one. Runs once per set of missing IDs.
  const backfillingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const missing = (videos as Vid[]).filter(
      (v) => !v.poster_url && !v.archived_at && !backfillingRef.current.has(v.id),
    );
    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      for (const v of missing) {
        if (cancelled) return;
        backfillingRef.current.add(v.id);
        try {
          // External sources: derive poster from platform.
          if (v.source_type !== "upload") {
            if (v.external_url) {
              const parsed = parseExternalVideoUrl(v.external_url);
              if (parsed?.posterUrl) {
                await (supabase as any).from("videos")
                  .update({ poster_url: parsed.posterUrl })
                  .eq("id", v.id);
              }
            }
            continue;
          }
          // Uploaded: pick best available source URL.
          let url = "";
          if (v.storage_path) url = await signedUrl(videoBucketFor(v), v.storage_path);
          if (!url && v.storage_url) url = await resolveAssetUrl(v.storage_url);
          if (!url) continue;
          const cap = await capturePosterFromUrl(url);
          if (!cap.blob) continue;
          const safe = v.name.replace(/[^\w.\-]+/g, "_").replace(/\.[^.]+$/, "");
          const pPath = `video-posters/${v.id}_${Date.now()}_${safe}.webp`;
          const pBucket = videoBucketFor(v);
          const pu = await (supabase as any).storage.from(pBucket).upload(
            pPath, cap.blob, { contentType: "image/webp", upsert: true },
          );
          if (pu.error) continue;
          const pub = (supabase as any).storage.from(pBucket).getPublicUrl(pPath);
          const posterUrl = pub?.data?.publicUrl ?? null;
          if (!posterUrl) continue;
          const patch: Record<string, unknown> = { poster_url: posterUrl, poster_path: pPath };
          if (!v.width && cap.width) patch.width = cap.width;
          if (!v.height && cap.height) patch.height = cap.height;
          if (!v.duration_seconds && cap.duration) patch.duration_seconds = cap.duration;
          await (supabase as any).from("videos").update(patch).eq("id", v.id);
        } catch {
          /* graceful fallback: keep placeholder */
        }
      }
      if (!cancelled) invalidate();
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos]);

  const usageCounts = useMemo(() => {
    const c: Record<string, number> = {};
    (videos as Vid[]).forEach((v) => (v.tags ?? []).forEach((t) => { c[t] = (c[t] ?? 0) + 1; }));
    return c;
  }, [videos]);

  // Live "Used On" data for videos.
  const usageAssets = useMemo(
    () => (videos as Vid[]).map((v) => ({
      id: v.id, slug_id: v.slug_id, name: v.name,
      storage_path: v.storage_path,
      external_url: v.external_url,
      external_video_id: v.external_video_id,
    })),
    [videos],
  );
  const { data: usageMap } = useVideoPageUsages(usageAssets);
  const usagesFor = (id: string): AssetUsage[] => usageMap?.get(id) ?? [];

  const { data: allPages = [] } = usePages();
  const pageOptions = useMemo(() => {
    const rows = (allPages as any[]).filter((p) => !p.archived_at);
    return [...rows].sort((a, b) => (a.name ?? a.path).localeCompare(b.name ?? b.path));
  }, [allPages]);
  const [usedOnPage, setUsedOnPage] = useState<string>("all");

  const matches = (v: Vid, tags: string[], needle: string) => {
    const n = needle.toLowerCase();
    const test = (s: string) => (s ?? "").toLowerCase().includes(n);
    switch (searchField) {
      case "name": return test(v.name);
      case "id": return test(v.slug_id);
      case "description": return test(v.description);
      case "alt": return test(v.alt_text);
      case "tags": return tags.some((t) => t.toLowerCase().includes(n));
      case "used_on": return usagesFor(v.id).some((u) => test(u.name) || test(u.path));
      default: {
        const usageNames = usagesFor(v.id).flatMap((u) => [u.name, u.path]);
        return [v.name, v.slug_id, v.description, v.alt_text, ...tags, ...usageNames].some((s) => test(s ?? ""));
      }
    }
  };

  const filtered = useMemo(() => {
    const now = Date.now();
    const rangeMs =
      timeRange === "hour" ? 60 * 60 * 1000 :
      timeRange === "day" ? 24 * 60 * 60 * 1000 :
      timeRange === "week" ? 7 * 24 * 60 * 60 * 1000 : 0;
    let list = (videos as Vid[]).filter((v) => {
      if (hiddenIds.has(v.id)) return false;
      const isArchived = !!v.archived_at;
      if (showArchived ? !isArchived : isArchived) return false;
      const t = v.tags ?? [];
      if (filterTags.length && !filterTags.every((f) => matchesLabelFilter(t, f))) return false;
      if (rangeMs && (now - new Date(v.created_at).getTime()) > rangeMs) return false;
      if (usedOnPage !== "all") {
        const list = usagesFor(v.id);
        if (usedOnPage === "none") { if (list.length > 0) return false; }
        else if (!list.some((u) => u.pageId === usedOnPage)) return false;
      }
      if (q && !matches(v, t, q)) return false;
      return true;
    });
    const justAdded = new Set(justAddedIds);
    list = [...list].sort((a, b) => {
      const aJ = justAdded.has(a.id), bJ = justAdded.has(b.id);
      if (aJ !== bJ) return aJ ? -1 : 1;
      if (aJ && bJ) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "name_desc") return b.name.localeCompare(a.name);
      const da = new Date(a.created_at).getTime(), db = new Date(b.created_at).getTime();
      return sort === "oldest" ? da - db : db - da;
    });
    return list;
  }, [videos, q, searchField, filterTags, timeRange, showArchived, sort, hiddenIds, justAddedIds, usedOnPage, usageMap]);

  const archivedCount = useMemo(
    () => (videos as Vid[]).filter((v) => v.archived_at).length,
    [videos],
  );

  // Incremental rendering: mount a window of tiles, grow it as you scroll.
  const PAGE_SIZE = 36;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const filterKey = filtered.map((v) => v.id).join(",");
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


  const uniqueName = (name: string, taken: Set<string>): string => {
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

  const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const vids = arr.filter((f) => f.type.startsWith("video/"));
    const images = arr.filter((f) => f.type.startsWith("image/"));
    const others = arr.filter((f) => !f.type.startsWith("video/") && !f.type.startsWith("image/"));
    if (images.length) {
      const names = images.map((f) => f.name).join(", ");
      toast.error("Images belong in the Images tool", {
        description: `The Video tool only accepts video files. Open the Images tool to upload ${images.length === 1 ? "this file" : "these files"}: ${names}`,
        duration: 10000,
      });
    }
    if (others.length) {
      const names = others.map((f) => f.name).join(", ");
      toast.error(`${others.length} unsupported file${others.length === 1 ? "" : "s"} skipped`, {
        description: `Only video files (MP4, MOV, WebM) can be uploaded here. Skipped: ${names}`,
        duration: 10000,
      });
    }
    const tooBig = vids.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const ok = vids.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    for (const f of tooBig) {
      toast.error(`${f.name} is too large`, {
        description: "This video exceeds the 150 MB upload cap. Upload it to YouTube instead, then paste the YouTube link into this tool.",
        duration: 12000,
      });
    }
    if (!ok.length) return;



    setBusy(true);
    setUploadProgress({ done: 0, total: ok.length });
    const created: Vid[] = [];
    const taken = new Set<string>((videos as Vid[]).map((v) => v.name));

    for (let idx = 0; idx < ok.length; idx++) {
      const file = ok[idx];
      const finalName = uniqueName(file.name, taken);
      taken.add(finalName);
      try {
        const stamp = Date.now();
        const safe = finalName.replace(/[^\w.\-]+/g, "_");
        const storagePath = `${stamp}_${idx}_${safe}`;

        // Probe metadata + poster frame client-side (no transcoding).
        const probe = await probeVideoFile(file).catch(() => ({
          duration: 0, width: 0, height: 0, posterBlob: null as Blob | null,
        }));

        const up = await (supabase as any).storage.from(VIDEO_GATED_BUCKET).upload(
          storagePath, file, { contentType: file.type },
        );
        if (up.error) throw up.error;
        // Public-shaped URL inside the PRIVATE staging bucket: publishing only
        // swaps the bucket segment.
        const url = (supabase as any).storage
          .from(VIDEO_GATED_BUCKET).getPublicUrl(storagePath)?.data?.publicUrl ?? "";

        let posterUrl: string | null = null;
        let posterPath: string | null = null;
        if (probe.posterBlob) {
          const pPath = `video-posters/${stamp}_${idx}_${safe.replace(/\.[^.]+$/, "")}.webp`;
          const pu = await (supabase as any).storage.from(VIDEO_GATED_BUCKET).upload(
            pPath, probe.posterBlob, { contentType: "image/webp", upsert: true },
          );
          if (!pu.error) {
            posterPath = pPath;
            const pub = (supabase as any).storage.from(VIDEO_GATED_BUCKET).getPublicUrl(pPath);
            posterUrl = pub?.data?.publicUrl ?? null;
          }
        }

        const { data, error } = await (supabase as any).from("videos").insert({
          name: finalName,
          source_type: "upload",
          storage_path: storagePath,
          storage_url: url,
          duration_seconds: probe.duration || null,
          width: probe.width || null,
          height: probe.height || null,
          file_bytes: file.size,
          poster_url: posterUrl,
          poster_path: posterPath,
          visibility: "gated",
        }).select("*").single();
        if (error) throw error;
        created.push(data);
      } catch (e: unknown) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
      setUploadProgress({ done: idx + 1, total: ok.length });
    }


    setBusy(false);
    setUploadProgress(null);
    invalidate();
    if (created.length) {
      const ids = created.map((c) => c.id);
      setJustAddedIds(ids);
      setJustAddedAt(new Date().toISOString());
      setSelected(new Set(ids));
      toast.success(`Uploaded ${created.length} video${created.length === 1 ? "" : "s"} — raw file stored (not optimized). Add labels from the sidebar.`);
    }
  };

  const addExternalLink = async () => {
    const parsed = parseExternalVideoUrl(linkUrl);
    if (!parsed) {
      toast.error("Paste a YouTube or Vimeo URL (e.g. https://youtu.be/… or https://vimeo.com/…).");
      return;
    }
    // Duplicate guard: same external_video_id on same source.
    const dup = (videos as Vid[]).find(
      (v) => v.source_type === parsed.source && v.external_video_id === parsed.videoId,
    );
    if (dup) {
      toast.warning(`Already in the list as "${dup.name}".`);
      return;
    }
    setLinkBusy(true);
    try {
      const taken = new Set<string>((videos as Vid[]).map((v) => v.name));
      const name = uniqueName(parsed.suggestedName, taken);
      const { data, error } = await (supabase as any).from("videos").insert({
        name,
        source_type: parsed.source,
        external_url: parsed.canonicalUrl,
        external_video_id: parsed.videoId,
        poster_url: parsed.posterUrl,
      }).select("*").single();
      if (error) throw error;
      setLinkUrl("");
      invalidate();
      setJustAddedIds([data.id]);
      setJustAddedAt(new Date().toISOString());
      setSelected(new Set([data.id]));
      toast.success(`Added ${sourceLabel(data)} video`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add link");
    } finally {
      setLinkBusy(false);
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
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) upload(e.target.files);
    e.target.value = "";
  };

  const setVideoTags = async (id: string, next: string[]) => {
    const clean = Array.from(new Set(next.map((t) => t.trim().toLowerCase()).filter(Boolean)));
    const { error } = await (supabase as any).from("videos").update({ tags: clean }).eq("id", id);
    if (error) toast.error(error.message);
    invalidate();
  };
  const addTag = async (id: string, raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (!tag) return;
    const v = (videos as Vid[]).find((x) => x.id === id);
    await setVideoTags(id, Array.from(new Set([...(v?.tags ?? []), tag])));
  };
  const removeTag = async (id: string, tag: string) => {
    const v = (videos as Vid[]).find((x) => x.id === id);
    await setVideoTags(id, (v?.tags ?? []).filter((t) => t !== tag));
  };

  const applyTag = async (ids: string[], tag: string) => {
    const t = tag.trim().toLowerCase();
    if (!t || !ids.length) return;
    const byId = new Map((videos as Vid[]).map((v) => [v.id, v.tags ?? []]));
    const results = await Promise.all(ids.map((id) => {
      const next = Array.from(new Set([...(byId.get(id) ?? []), t]));
      return (supabase as any).from("videos").update({ tags: next }).eq("id", id);
    }));
    const err = results.find((r) => r.error)?.error;
    if (err) toast.error(err.message);
    else toast.success(`Labeled ${ids.length} video${ids.length === 1 ? "" : "s"} "${t}"`);
    invalidate();
  };

  const saveField = async (id: string, field: "description" | "alt_text" | "name", value: string) => {
    await (supabase as any).from("videos").update({ [field]: value }).eq("id", id);
    invalidate();
  };

  const uploadThumbnail = async (v: Vid, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file for the thumbnail.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Thumbnail image must be under 10 MB.");
      return;
    }
    try {
      const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? ".jpg").toLowerCase();
      const safe = v.name.replace(/[^\w.\-]+/g, "_").replace(/\.[^.]+$/, "");
      const pPath = `video-posters/manual_${v.id}_${Date.now()}_${safe}${ext}`;
      const pBucket = videoBucketFor(v);
      const pu = await (supabase as any).storage.from(pBucket).upload(
        pPath, file, { contentType: file.type, upsert: true },
      );
      if (pu.error) throw pu.error;
      // Best-effort cleanup of any previous poster we stored.
      if (v.poster_path && v.poster_path !== pPath) {
        await (supabase as any).storage.from(pBucket).remove([v.poster_path]);
      }
      const pub = (supabase as any).storage.from(pBucket).getPublicUrl(pPath);
      const posterUrl = pub?.data?.publicUrl ?? null;
      const { error } = await (supabase as any).from("videos")
        .update({ poster_url: posterUrl, poster_path: pPath })
        .eq("id", v.id);
      if (error) throw error;
      toast.success("Thumbnail updated");
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload thumbnail");
    }
  };

  const requestDelete = (vids: Vid[]) => {
    if (!vids.length) return;
    setConfirmDelete({ vids });
  };
  const doDelete = (vids: Vid[]) => {
    setConfirmDelete(null);
    setDetail(null);
    setSelected(new Set());
    const ids = vids.map((v) => v.id);
    scheduleDeleteWithUndo({
      label: vids.length === 1
        ? `Deleted video "${vids[0].name}"`
        : `Deleted ${vids.length} videos`,
      hide: () => setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.add(i)); return n; }),
      restore: () => setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }),
      commit: async () => {
        // Files may live in the private staging bucket, the public bucket, or
        // (legacy rows) the old originals bucket — group by row.
        for (const v of vids) {
          const bucket = videoBucketFor(v);
          const keys = [v.storage_path, v.alt_path, v.poster_path].filter(Boolean) as string[];
          if (keys.length) await (supabase as any).storage.from(bucket).remove(keys);
        }
        const posters = vids.map((v) => v.poster_path).filter(Boolean) as string[];
        if (posters.length) {
          await (supabase as any).storage.from(POSTER_BUCKET).remove(posters);
          await (supabase as any).storage.from("page-thumbnails").remove(posters);
        }
        const { error } = await (supabase as any).from("videos").delete().in("id", ids);
        if (error) throw error;
      },
      onCommitted: () => {
        setHiddenIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
        invalidate();
      },
    });
  };
  const bulkDelete = () => requestDelete((videos as Vid[]).filter((v) => selected.has(v.id)));

  /** Move selected videos between the private staging bucket and the public one. */
  const setVisibility = async (ids: string[], action: "publish" | "gate") => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke("publish-assets", {
        body: { ids, action, kind: "video" },
      });
      if (error) throw error;
      const failed = (data?.results ?? []).filter((r: any) => !r.ok);
      clearAssetUrlCache();
      if (failed.length) toast.error(`${failed.length} video(s) could not be updated`);
      else toast.success(action === "publish"
        ? `Published ${ids.length} video${ids.length === 1 ? "" : "s"} — now publicly reachable`
        : `Gated ${ids.length} video${ids.length === 1 ? "" : "s"} — no longer publicly reachable`);
      setSelected(new Set());
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change visibility");
    } finally {
      setBusy(false);
    }
  };

  const archive = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await (supabase as any).from("videos").update({ archived_at: new Date().toISOString() }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    setSelected(new Set());
    setDetail(null);
    toast(`Archived ${ids.length} video${ids.length === 1 ? "" : "s"}`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          await (supabase as any).from("videos").update({ archived_at: null }).in("id", ids);
          invalidate();
        },
      },
    });
    invalidate();
  };
  const unarchive = async (ids: string[]) => {
    if (!ids.length) return;
    const { error } = await (supabase as any).from("videos").update({ archived_at: null }).in("id", ids);
    if (error) { toast.error(error.message); return; }
    toast.success(`Restored ${ids.length} video${ids.length === 1 ? "" : "s"}`);
    invalidate();
  };

  const onTileDragStart = (e: DragEvent, id: string) => {
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData("text/plain", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copy";
  };

  const playbackUrl = (v: Vid) =>
    v.source_type === "upload" ? (v.storage_url ?? "") : (v.external_url ?? "");

  return (
    <div className="nova-library-layout flex gap-4 items-start">
      <LibraryLabels><TagsPanel
        scope="videos"
        usageCounts={usageCounts}
        activeFilters={filterTags}
        onToggleFilter={(t) => setFilterTags((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])}
        onClearFilters={() => setFilterTags([])}
        selectedCount={selected.size}
        selectedIds={[...selected]}
        onApplyTag={applyTag}
        itemLabel="videos"
        filteredCount={filtered.length}
        onSelectAllFiltered={() => setSelected(new Set(filtered.map((v) => v.id)))}
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
          {dragActive
            ? `Drop ${dragCount || ""} file${dragCount === 1 ? "" : "s"} to upload`
            : uploadProgress
              ? `Uploading ${uploadProgress.done} of ${uploadProgress.total}…`
              : busy
                ? "Uploading…"
                : "Drop video files here or click to select"}
          <div className="mt-1 text-xs text-muted-foreground">
            Uploads are capped at 150 MB per file. For anything larger, upload to YouTube and paste the link below.
          </div>

          <input ref={fileRef} type="file" accept="video/*" multiple hidden aria-label="Upload Videos" onChange={onPick} />
        </div>

        {/* External link add row */}
        <div className="nova-library-url flex items-stretch gap-2">
          <div className="flex items-stretch flex-1 min-w-0 rounded-lg border-2 border-border focus-within:border-primary bg-background overflow-hidden">
            <div className="flex items-center pl-3 pr-2 text-muted-foreground">
              <LinkIcon className="w-4 h-4" />
            </div>
            <Input
              placeholder="Paste a YouTube or Vimeo link"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addExternalLink(); }}
              className="flex-1 border-0 rounded-none h-11 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-2"
            />
          </div>
          <Button onClick={addExternalLink} disabled={linkBusy || !linkUrl.trim()} className="h-11">
            Add Link
          </Button>
        </div>

        {justAddedIds.length > 0 && justAddedAt && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <div>
              <span className="font-medium text-primary">Just Added</span>{" "}
              <span className="text-muted-foreground">
                {justAddedIds.length} video{justAddedIds.length === 1 ? "" : "s"} · {formatRelative(justAddedAt)} · pre-selected below — apply labels from the sidebar
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
          <Input
            placeholder="Search videos…"
            aria-label="Search Videos"
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

        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="videos-sort">
              Sort By
            </label>
            <select
              id="videos-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as any)}
              className="text-sm border rounded px-2 py-1 h-9"
            >
              <option value="newest">Newest Added</option>
              <option value="oldest">Oldest Added</option>
              <option value="name">Name (A–Z)</option>
              <option value="name_desc">Name (Z–A)</option>
            </select>
          </div>

          <div className="h-6 w-px bg-border mx-1" aria-hidden="true" />

          <div className="flex items-center gap-1.5" role="group" aria-label="Time Range">
            <span className="text-xs font-medium text-muted-foreground">Show</span>
            {([
              { v: "all", label: "All" },
              { v: "hour", label: "Last Hour" },
              { v: "day", label: "Last 24h" },
              { v: "week", label: "Last 7 days" },
            ] as { v: TimeRange; label: string }[]).map((c) => (
              <button
                key={c.v}
                onClick={() => setTimeRange(c.v)}
                className={`inline-flex min-h-9 items-center text-xs px-2 py-1 rounded-full border transition-colors sm:min-h-0 ${
                  timeRange === c.v
                    ? "bg-tag-selected text-tag-selected-foreground border-tag-selected"
                    : "bg-background hover:bg-muted border-border text-muted-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-border mx-1" aria-hidden="true" />

          <label className="text-xs flex items-center gap-1.5 font-medium text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Archived Only {archivedCount > 0 && <span className="text-muted-foreground">({archivedCount})</span>}
          </label>
          <Button
            size="sm" variant="outline" className="gap-1.5 ml-auto"
            onClick={() => { invalidate(); toast.success("Videos refreshed"); }}
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="font-medium text-muted-foreground" htmlFor="videos-used-on-page">
            Used on Page
          </label>
          <select
            id="videos-used-on-page"
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
          itemLabel="video"
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
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setVisibility([...selected], "publish")}>
            <Globe className="w-3.5 h-3.5 mr-1.5" /> Publish
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setVisibility([...selected], "gate")}>
            <Lock className="w-3.5 h-3.5 mr-1.5" /> Gate
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadVideosAsZip((videos as Vid[]).filter((v) => selected.has(v.id)))}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Download .zip
          </Button>
          <Button size="sm" variant="destructive" onClick={bulkDelete}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
          </Button>
        </SelectionBar>

        <div className="nova-library-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {isLoading && Array.from({ length: 10 }).map((_, i) => (
            <div key={`sk-${i}`} className="aspect-video bg-muted animate-pulse rounded border" />
          ))}
          {!isLoading && shown.map((v) => {
            const sel = selected.has(v.id);
            const isJustAdded = justAddedIds.includes(v.id);
            return (
              <LibraryWindow key={v.id} kind="video">{() => <div
                draggable
                onDragStart={(e) => onTileDragStart(e, v.id)}
                className={`relative group border rounded overflow-hidden hover:shadow-lg cursor-grab active:cursor-grabbing ${sel ? "ring-2 ring-primary" : ""} ${isJustAdded ? "ring-2 ring-primary/70" : ""}`}
              >
                {isJustAdded && (
                  <div className="absolute top-1 left-1/2 -translate-x-1/2 z-10 text-[9px] uppercase tracking-wide font-medium bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                    Just Added
                  </div>
                )}
                <input
                  type="checkbox" checked={sel}
                  aria-label={`Select ${v.name || "video"}`}
                  onChange={(e) => {
                    const n = new Set(selected);
                    if (e.target.checked) n.add(v.id); else n.delete(v.id);
                    setSelected(n);
                  }}
                  className="absolute top-1 left-1 z-10"
                />
                <div className="nova-library-actions absolute top-1 right-1 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {v.archived_at ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); unarchive([v.id]); }}
                      className="bg-background/90 hover:bg-muted border rounded p-1"
                      title="Restore from Archive"
                    >
                      <ArchiveRestore className="w-3 h-3" />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); archive([v.id]); }}
                      className="bg-background/90 hover:bg-muted border rounded p-1"
                      title="Archive"
                    >
                      <Archive className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadOriginalVideo(v); }}
                    className="bg-background/90 hover:bg-muted border rounded p-1"
                    title={v.source_type === "upload" ? "Download Original" : "Open Source (External Video)"}
                  >
                    <Download className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); requestDelete([v]); }}
                    className="bg-background/90 hover:bg-destructive hover:text-destructive-foreground border rounded p-1"
                    title="Delete Video"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div
                  onClick={() => setDetail(v)}
                  className="relative w-full aspect-video bg-muted cursor-pointer overflow-hidden"
                >
                  <SignedThumbImg
                    url={v.poster_url}
                    alt={v.alt_text || v.name}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                    width={400} height={225}
                    decoding="async"
                    fallback={
                      <div className="absolute inset-0 w-full h-full flex items-center justify-center text-muted-foreground">
                        <Play className="w-8 h-8 opacity-40" />
                      </div>
                    }
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="rounded-full bg-black/55 text-white p-2 backdrop-blur-sm">
                      <Play className="w-5 h-5 fill-white" />
                    </div>
                  </div>
                  <div className="absolute bottom-1 left-1 flex items-center gap-1">
                    <SourceBadge v={v} />
                    {v.visibility === "gated" && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-background/90 border px-1.5 py-0.5 text-[9px] uppercase tracking-wide"
                        title="Gated — only reachable while signed in. Publish to make it public."
                      >
                        <Lock className="w-2.5 h-2.5" /> Gated
                      </span>
                    )}
                  </div>
                  {v.duration_seconds ? (
                    <div className="absolute bottom-1 right-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/70 text-white">
                      {formatDuration(v.duration_seconds)}
                    </div>
                  ) : null}
                </div>

                {v.slug_id && (
                  <div
                    className="absolute inset-x-1 bottom-14 z-10 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CopyRefButton
                      reference={buildVideoRef({
                        id: v.slug_id, name: v.name, source: v.source_type,
                        url: playbackUrl(v), altUrl: v.alt_url, posterUrl: v.poster_url,
                      })}
                      id={v.slug_id}
                      label="Copy Reference"
                    />
                  </div>
                )}

                <div className="nova-library-caption p-1 text-[10px] truncate">
                  <div className="nova-library-name truncate font-medium">{v.name}</div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-muted-foreground truncate">
                      {v.source_type === "upload" && (
                        <span title="Uploaded raw — not optimized">Not optimized · </span>
                      )}
                      {formatRelative(v.created_at)}
                    </span>
                    <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                      <UsedOnChip usages={usagesFor(v.id)} />
                    </span>
                  </div>
                </div>
              </div>}</LibraryWindow>
            );
          })}
        </div>

        {!isLoading && visibleCount < filtered.length && (
          <div ref={sentinelRef} className="py-6 flex flex-col items-center gap-2">
            <div className="text-xs text-muted-foreground">
              Showing {shown.length} of {filtered.length}
            </div>
            <Button size="sm" variant="outline" onClick={() => setVisibleCount((c) => c + 36)}>
              Load More
            </Button>
          </div>
        )}

        <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
          <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-sm pr-8">{detail?.name}</DialogTitle>
            </DialogHeader>
            {detail && (
              <VideoDetail
                v={(videos as Vid[]).find((x) => x.id === detail.id) ?? detail}
                usages={usagesFor(detail.id)}
                onAddTag={(t) => addTag(detail.id, t)}
                onRemoveTag={(t) => removeTag(detail.id, t)}
                onSaveField={(f, v) => saveField(detail.id, f, v)}
                onDelete={() => requestDelete([detail])}
                onArchive={() => archive([detail.id])}
                onUnarchive={() => unarchive([detail.id])}
                onUploadThumbnail={(file) => uploadThumbnail(
                  (videos as Vid[]).find((x) => x.id === detail.id) ?? detail, file,
                )}
                playbackUrl={playbackUrl(detail)}
              />
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={!!confirmDelete}
          onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
          title={
            confirmDelete
              ? confirmDelete.vids.length === 1
                ? `Delete video "${confirmDelete.vids[0].name}"?`
                : `Delete ${confirmDelete.vids.length} videos?`
              : ""
          }
          description={
            <>
              {confirmDelete && <InUseWarning items={confirmDelete.vids.map((v) => ({ label: v.name, usages: usagesFor(v.id) }))} />}
              <p>Uploaded files will be removed from storage. External links only remove the registry entry. You have 5 seconds to undo.</p>
            </>
          }
          confirmLabel="Delete"
          onConfirm={() => confirmDelete && doDelete(confirmDelete.vids)}
        />
      </div>
    </div>
  );
}

function VideoDetail({
  v, usages, onAddTag, onRemoveTag, onSaveField, onDelete, onArchive, onUnarchive, onUploadThumbnail, playbackUrl,
}: {
  v: Vid;
  usages: AssetUsage[];
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
  onSaveField: (field: "description" | "alt_text" | "name", value: string) => void;
  onDelete: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onUploadThumbnail: (file: File) => void;
  playbackUrl: string;
}) {
  const [name, setName] = useState(v.name);
  const [alt, setAlt] = useState(v.alt_text ?? "");
  const [description, setDescription] = useState(v.description ?? "");
  useEffect(() => {
    setName(v.name);
    setAlt(v.alt_text ?? "");
    setDescription(v.description ?? "");
  }, [v.id]);

  const signedPoster = usePageThumbSrc(v.poster_url);
  // Gated playback URLs need a signed URL for in-app preview.
  const resolvedPlayback = useResolvedAssetUrl(playbackUrl);
  const tags = v.tags ?? [];

  return (
    <div className="space-y-3">
      <div className="bg-black rounded overflow-hidden max-h-[50vh] aspect-video mx-auto w-full">
        {v.source_type === "upload" ? (
          <video src={resolvedPlayback || undefined} controls poster={signedPoster ?? undefined} className="w-full h-full object-contain" />
        ) : v.source_type === "youtube" ? (
          <iframe
            src={`https://www.youtube.com/embed/${v.external_video_id}`}
            title={v.name}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <iframe
            src={`https://player.vimeo.com/video/${v.external_video_id}`}
            title={v.name}
            className="w-full h-full"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        )}
      </div>

      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
        <span>ID: <span className="font-mono">{v.slug_id}</span></span>
        <span>·</span>
        <span>Source: {sourceLabel(v)}</span>
        <span>·</span>
        <span>{fmtDims(v.width, v.height)}</span>
        <span>·</span>
        <span>{formatDuration(v.duration_seconds)}</span>
        {v.source_type === "upload" && (
          <>
            <span>·</span>
            <span>{fmtSize(v.file_bytes)}</span>
            <span>·</span>
            <span className="text-amber-700 dark:text-amber-500">
              Not optimized — production will handle streaming
            </span>
          </>
        )}
      </div>

      <div>
        <div className="text-xs mb-1">Name</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== v.name && onSaveField("name", name)} />
      </div>

      <div>
        <div className="text-xs mb-1">Description</div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => onSaveField("description", description)}
          className="w-full border rounded p-2 text-sm min-h-[60px]"
          placeholder="Add a description…"
        />
      </div>

      <UsedOnList usages={usages} />



      <div>
        <div className="text-xs mb-1">Labels</div>
        <LabelPicker scope="videos"
          value={tags}
          onChange={(next) => {
            const added = next.filter((t) => !tags.includes(t));
            const removed = tags.filter((t) => !next.includes(t));
            added.forEach(onAddTag);
            removed.forEach(onRemoveTag);
          }}
        />
      </div>

      <div>
        <div className="text-xs mb-1">Alt Text</div>
        <Input value={alt} onChange={(e) => setAlt(e.target.value)} onBlur={() => onSaveField("alt_text", alt)} />
      </div>

      <div>
        <div className="text-xs mb-1 flex items-center gap-1.5">
          Thumbnail
          <span
            className="text-muted-foreground cursor-help"
            title="The preview image shown for this video before it plays. Upload your own if the automatic thumbnail didn't capture well."
            aria-label="About Thumbnails"
          >
            ⓘ
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-32 aspect-video bg-muted rounded overflow-hidden border flex items-center justify-center shrink-0">
            {signedPoster ? (
              <img src={signedPoster} alt="" className="w-full h-full object-cover" />
            ) : (
              <Play className="w-6 h-6 opacity-40 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              className="inline-flex items-center gap-1.5 text-xs border rounded px-2.5 py-1.5 hover:bg-muted cursor-pointer w-fit"
              title="Upload a custom preview image for this video"
            >
              {v.poster_url ? "Change Thumbnail" : "Upload Thumbnail"}
              <input
                type="file"
                accept="image/*"
                hidden
                aria-label="Upload Video Thumbnail"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadThumbnail(f);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="text-[11px] text-muted-foreground max-w-[280px]">
              The preview image shown before the video plays. Upload your own if the automatic capture didn't work well.
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <CopyRefButton
          reference={buildVideoRef({
            id: v.slug_id, name: v.name, source: v.source_type, url: playbackUrl,
            altUrl: v.alt_url, posterUrl: v.poster_url,
          })}
          id={v.slug_id}
        />
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(toAbsoluteUrl(playbackUrl)); toast.success("URL copied"); }}>
          <Copy className="w-4 h-4 mr-1" /> Copy URL
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadOriginalVideo(v)}>
          <Download className="w-4 h-4 mr-1" />
          {v.source_type === "upload" ? "Download Original" : "Open Source"}
        </Button>
        {v.archived_at ? (
          <Button size="sm" variant="outline" onClick={onUnarchive}>
            <ArchiveRestore className="w-4 h-4 mr-1" /> Unarchive
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onArchive}>
            <Archive className="w-4 h-4 mr-1" /> Archive
          </Button>
        )}
        <Button size="sm" variant="destructive" onClick={onDelete}>
          <Trash2 className="w-4 h-4 mr-1" /> Delete
        </Button>
      </div>
    </div>
  );
}
