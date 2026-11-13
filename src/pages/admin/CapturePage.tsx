import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  ArrowLeft, Camera, ImagePlus, X, Check, Loader2, AlertTriangle,
  FileText, Trash2, CloudUpload,
} from "lucide-react";
import LabelPicker from "./LabelPicker";
import CameraCaptureSheet from "./CameraCaptureSheet";
import { colorFor } from "./labelColors";
import { leafOf } from "./labelPath";
import { usePages } from "./useAdminData";
import { uploadImageFile, uploadVideoFile, attachPageUsages, uniqueName } from "./captureUpload";
import { formatBytes } from "@/lib/imageOptimize";
import { useManagerTitle } from "./useManagerTitle";
import { sanitizeCaptureName } from "./captureName";
import { useCaptureLeaveGuard } from "./useCaptureLeaveGuard";
import ConfirmDialog from "./ConfirmDialog";

type Kind = "image" | "video";
type Status = "staged" | "uploading" | "done" | "error";

interface Staged {
  key: string;
  file: File;
  kind: Kind;
  name: string;
  nameHint?: string;
  preview: string;
  tags: string[];
  /** Pages this single item should be linked to (merged with the batch list). */
  pageIds: string[];
  /** Second encoding of the same clip (e.g. the WebM next to the MP4). */
  altFile?: File | null;
  status: Status;
  error?: string;
}

let seq = 0;

function kindOf(file: File): Kind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  // Some browsers report an empty type for .webm picked from disk.
  if (/\.(webm|mp4|mov|m4v|ogv)$/i.test(file.name)) return "video";
  return null;
}

const stemOf = (name: string) => name.replace(/\.[^.]+$/, "").toLowerCase();
const extOf = (name: string) => (name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
const formatOf = (name: string) => extOf(name).toUpperCase() || "VIDEO";


function LabelChips({ tags, onRemove }: { tags: string[]; onRemove?: (t: string) => void }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const c = colorFor(t);
        return (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
            style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
          >
            {leafOf(t)}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(t)}
                aria-label={`Remove label ${leafOf(t)}`}
                className="capture-hit-sm -mr-1 grid place-items-center opacity-60 active:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </span>

        );
      })}
    </div>
  );
}

/** Optional "used on page" assignment — used for the whole batch and per item. */
function PageAssign({
  options, value, onChange, disabled, triggerLabel = "Assign pages", compact = false,
}: {
  options: any[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  triggerLabel?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.filter((p) => value.includes(p.id));
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((p) => p !== id) : [...value, id]);
  return (
    <div className="space-y-1.5 min-w-0">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs max-w-full">
              <span className="truncate">{p.name || p.path}</span>
              {!disabled && (
                <button
                  type="button" onClick={() => toggle(p.id)}
                  aria-label={`Remove page ${p.name || p.path}`}
                  className="capture-hit-sm -mr-1 grid place-items-center opacity-60 active:opacity-100 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className={compact ? "h-10 gap-1.5 text-xs" : "h-11 gap-2"}>
              <FileText className={compact ? "w-4 h-4" : "w-4 h-4"} />
              {triggerLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(92vw,22rem)] p-0">
            <Command>
              <CommandInput placeholder="Search pages…" />
              <CommandList className="capture-scroll max-h-[45vh]">
                <CommandEmpty>No pages found.</CommandEmpty>
                <CommandGroup>
                  {options.map((p) => (
                    <CommandItem key={p.id} value={`${p.name} ${p.path}`} onSelect={() => toggle(p.id)} className="min-h-11">
                      <Checkbox checked={value.includes(p.id)} className="mr-2 pointer-events-none" />
                      <span className="truncate">{p.name || p.path}</span>
                      <span className="ml-auto pl-2 text-xs text-muted-foreground truncate">{p.path}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>

              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export default function CapturePage() {
  useManagerTitle("Capture");
  const qc = useQueryClient();
  const [items, setItems] = useState<Staged[]>([]);
  const [imageTags, setImageTags] = useState<string[]>([]);
  const [videoTags, setVideoTags] = useState<string[]>([]);
  const [pageIds, setPageIds] = useState<string[]>([]);
  
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{ images: number; videos: number; failed: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  useCaptureLeaveGuard(items.some(i => i.status !== "done"));
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const cameraRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const libraryRef = useRef<HTMLInputElement>(null);

  const { data: allPages = [] } = usePages();
  const pageOptions = useMemo(
    () => (allPages as any[])
      .filter((p) => !p.archived_at)
      .sort((a, b) => (a.name ?? a.path).localeCompare(b.name ?? b.path)),
    [allPages],
  );

  // Release object URLs when the page unmounts.
  useEffect(() => () => { itemsRef.current.forEach((i) => URL.revokeObjectURL(i.preview)); }, []);

  // App-like scrolling while this tool is open: no browser pull-to-refresh and
  // no rubber-band bounce past the top/bottom of the staged list.
  useEffect(() => {
    const el = document.documentElement;
    const prevOverscroll = el.style.overscrollBehaviorY;
    const prevHighlight = el.style.getPropertyValue("-webkit-tap-highlight-color");
    el.style.overscrollBehaviorY = "none";
    el.style.setProperty("-webkit-tap-highlight-color", "transparent");
    return () => {
      el.style.overscrollBehaviorY = prevOverscroll;
      el.style.setProperty("-webkit-tap-highlight-color", prevHighlight);
    };
  }, []);


  const stage = (files: FileList | File[]) => {
    const arr = Array.from(files);
    const rejected: string[] = [];
    const taken = new Set(items.map((i) => i.name));
    const next: Staged[] = [];
    const paired: string[] = [];
    // Existing video items keyed by their base name, so a second encoding of
    // the same clip (clip.mp4 + clip.webm) becomes ONE upload with two sources.
    const videoByStem = new Map<string, Staged>();
    for (const i of items) if (i.kind === "video" && !i.altFile) videoByStem.set(stemOf(i.name), i);
    const attachedTo = new Map<string, File>();

    for (const file of arr) {
      const kind = kindOf(file);
      if (!kind) { rejected.push(file.name); continue; }

      if (kind === "video") {
        const stem = stemOf(file.name);
        const staged = next.find(
          (i) => i.kind === "video" && !i.altFile && stemOf(i.name) === stem && extOf(i.name) !== extOf(file.name),
        );
        if (staged) {
          staged.altFile = file;
          paired.push(file.name);
          continue;
        }
        const existing = videoByStem.get(stem);
        if (existing && extOf(existing.name) !== extOf(file.name) && !attachedTo.has(existing.key)) {
          attachedTo.set(existing.key, file);
          paired.push(file.name);
          continue;
        }
      }

      const name = uniqueName(sanitizeCaptureName(file.name), taken);
      taken.add(name);
      next.push({
        key: `s${++seq}`,
        file,
        kind,
        name,
        preview: URL.createObjectURL(file),
        tags: [],
        pageIds: [],
        altFile: null,
        status: "staged",
      });
    }
    if (rejected.length) {
      toast.error(`${rejected.length} unsupported file${rejected.length === 1 ? "" : "s"} skipped`, {
        description: `Only photos and videos can be captured. Skipped: ${rejected.join(", ")}`,
      });
    }
    if (paired.length) {
      toast.success(`${paired.length} alternate video format${paired.length === 1 ? "" : "s"} paired`, {
        description: `${paired.join(", ")} will be uploaded as an extra <source> on the matching clip.`,
      });
    }
    if (next.length || attachedTo.size) {
      setSummary(null);
      setItems((prev) => [
        ...prev.map((i) => ({ ...i, altFile: attachedTo.get(i.key) ?? i.altFile })),
        ...next,
      ]);
    }
  };


  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) stage(e.target.files);
    e.target.value = "";
  };

  const patch = (key: string, p: Partial<Staged>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const removeItem = (key: string) => {
    setItems((prev) => {
      const hit = prev.find((i) => i.key === key);
      if (hit) URL.revokeObjectURL(hit.preview);
      return prev.filter((i) => i.key !== key);
    });
  };

  const clearAll = () => {
    setConfirmClear(false);
    items.forEach((i) => URL.revokeObjectURL(i.preview));
    setItems([]);
    setSummary(null);
  };

  const imageCount = items.filter((i) => i.kind === "image").length;
  const videoCount = items.filter((i) => i.kind === "video").length;
  const pending = items.filter((i) => i.status === "staged" || i.status === "error");
  const totalBytes = items.reduce((n, i) => n + i.file.size + (i.altFile?.size ?? 0), 0);


  const upload = async () => {
    if (!pending.length) return;
    setBusy(true);
    setSummary(null);
    setProgress({ done: 0, total: pending.length });
    let images = 0, videos = 0, failed = 0;

    // Sequential on purpose: a phone on cellular will time out if we push
    // several full-resolution originals in parallel.
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const name = sanitizeCaptureName(item.name, item.file.name);
      patch(item.key, { name, status: "uploading", error: undefined, ...(name !== item.name ? { nameHint: "Name adjusted for upload." } : {}) });
      try {
        const tags = Array.from(new Set([
          ...(item.kind === "image" ? imageTags : videoTags),
          ...item.tags,
        ]));
        const row = item.kind === "image"
          ? await uploadImageFile(item.file, { filename: name, tags })
          : await uploadVideoFile(item.file, { filename: name, tags, altFile: item.altFile });
        const pages = Array.from(new Set([...pageIds, ...item.pageIds]));
        if (pages.length) await attachPageUsages(item.kind, row.id, pages);
        patch(item.key, { status: "done" });
        if (item.kind === "image") images++; else videos++;
      } catch (e: unknown) {
        failed++;
        patch(item.key, {
          status: "error",
          error: e instanceof Error ? e.message : "Upload failed",
        });
      }
      setProgress({ done: i + 1, total: pending.length });
    }

    setBusy(false);
    setProgress(null);
    setSummary({ images, videos, failed });
    qc.invalidateQueries({ queryKey: ["admin", "images"] });
    qc.invalidateQueries({ queryKey: ["admin", "videos"] });
    qc.invalidateQueries({ queryKey: ["admin", "image_page_usages"] });
    qc.invalidateQueries({ queryKey: ["admin", "video_page_usages"] });
    if (failed === 0) {
      toast.success(`Uploaded ${images + videos} item${images + videos === 1 ? "" : "s"}`);
      // Fresh slate for the next batch: drop staged items and batch labels/pages,
      // keeping only the summary line so the result stays visible.
      items.forEach((i) => URL.revokeObjectURL(i.preview));
      setItems([]);
      setImageTags([]);
      setVideoTags([]);
      setPageIds([]);
    } else {
      toast.error(`${failed} upload${failed === 1 ? "" : "s"} failed — tap Upload to retry`);
    }
  };

  return (
    <div className="capture-app min-h-[100dvh] bg-background pb-40">
      <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} title="Remove All Staged Items?" description={`Remove all ${items.length} staged items? ${items.some(i => i.status === "done") ? "Uploaded items will stay in your library." : "Nothing has been uploaded yet."}`} confirmLabel="Remove All" onConfirm={clearAll} />
      <CameraCaptureSheet
        open={cameraOpen} onOpenChange={setCameraOpen} onCapture={(file) => stage([file])}
        onUnavailable={(reason) => {
          const messages = {
            unsupported: "Live camera isn't available in this browser, so we opened your photo picker instead.",
            denied: "Camera access was blocked, so we opened your photo picker instead. You can allow the camera in your browser settings.",
            notfound: "No camera was found, so we opened your photo picker instead.",
            error: "The camera couldn't be started, so we opened your photo picker instead.",
          };
          toast.info(messages[reason]);
          cameraRef.current?.click();
        }}
      />
      <header className="capture-safe-top capture-safe-x sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-2 flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="gap-2 -ml-1 px-2">
            <Link to="/manage/images">
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Site Manager</span>
              <span className="sr-only sm:hidden">Back to Site Manager</span>
            </Link>
          </Button>
          <h1 className="text-base font-semibold flex-1 truncate">Capture</h1>
          {items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => items.length >= 2 ? setConfirmClear(true) : clearAll()} disabled={busy} className="gap-1.5 px-2 text-muted-foreground">
              <Trash2 className="w-4 h-4" />
              Clear
            </Button>
          )}
        </div>
      </header>

      <main className="capture-safe-x mx-auto max-w-3xl px-4 py-4 space-y-5 sm:px-4">
        {/* Capture controls */}
        <section className="space-y-3">
          <input
            ref={cameraRef} type="file" accept="image/*" capture="environment"
            className="sr-only" onChange={onPick} aria-label="Take a Photo"
          />
          <input
            ref={libraryRef} type="file" accept="image/*,video/*,.webm,.mp4,.mov"
            multiple className="sr-only" onChange={onPick} aria-label="Choose Photos or Videos"
          />
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button" size="lg" disabled={busy}
              onClick={() => setCameraOpen(true)}
              className="h-24 flex-col gap-2 text-base rounded-xl transition-transform active:scale-[0.97]"
            >
              <Camera className="w-7 h-7" />
              Take Photo
            </Button>
            <Button
              type="button" size="lg" variant="outline" disabled={busy}
              onClick={() => libraryRef.current?.click()}
              className="h-24 flex-col gap-2 text-base rounded-xl transition-transform active:scale-[0.97]"
            >
              <ImagePlus className="w-7 h-7" />
              Choose Files
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">MP4 and WebM files with matching names upload as one clip.</p>
        </section>


        {/* Batch tagging */}
        {items.length > 0 && (
          <section className="rounded-lg border bg-card p-4 space-y-4">
            <h2 className="text-sm font-semibold">Apply to This Batch</h2>

            {imageCount > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Photo labels · {imageCount} photo{imageCount === 1 ? "" : "s"}
                </div>
                
                <LabelPicker scope="images" value={imageTags} onChange={setImageTags} triggerLabel="Add photo label" />
              </div>
            )}

            {videoCount > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Video labels · {videoCount} video{videoCount === 1 ? "" : "s"}
                </div>
                
                <LabelPicker scope="videos" value={videoTags} onChange={setVideoTags} triggerLabel="Add video label" />
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Used on page · applied to every item in this batch
              </div>
              <PageAssign options={pageOptions} value={pageIds} onChange={setPageIds} disabled={busy} />
            </div>

          </section>
        )}

        {/* Staged items */}
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Nothing staged yet.
          </div>
        ) : (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">
              Staged · {items.length} item{items.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
            </h2>
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.key} className="rounded-xl border bg-card p-3 flex gap-3">
                  <div className="relative w-24 h-24 sm:w-20 sm:h-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {item.kind === "image" ? (
                      <img
                        src={item.preview} alt={`Preview of ${item.name}`} loading="lazy" draggable={false}
                        className="w-full h-full object-cover pointer-events-none"
                      />
                    ) : (
                      <video src={item.preview} muted playsInline preload="metadata" className="w-full h-full object-cover pointer-events-none" />
                    )}
                    {item.status === "uploading" && (
                      <div className="absolute inset-0 grid place-items-center bg-background/70">
                        <Loader2 className="w-5 h-5 animate-spin" />
                      </div>
                    )}
                    {item.status === "done" && (
                      <div className="absolute inset-0 grid place-items-center bg-background/70">
                        <Check className="w-5 h-5 text-emerald-600" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start gap-2">
                      <Input
                        value={item.name}
                        disabled={busy || item.status === "done"}
                        onChange={(e) => patch(item.key, { name: e.target.value })}
                        onBlur={() => { const name = sanitizeCaptureName(item.name, item.file.name); patch(item.key, { name, nameHint: name !== item.name ? "Name adjusted: using a safe name of up to 80 characters." : item.nameHint }); }}
                        aria-describedby={item.nameHint ? `capture-name-${item.key}` : undefined}
                        aria-label={`Name for ${item.name}`}
                        enterKeyHint="done"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        className="h-11 text-base"
                      />
                      <Button
                        type="button" variant="ghost" size="icon" disabled={busy}
                        onClick={() => removeItem(item.key)}
                        aria-label={`Remove ${item.name} from this batch`}
                        className="shrink-0 h-11 w-11"
                      >
                        <X className="w-5 h-5" />
                      </Button>

                    </div>
                    {item.nameHint && <p id={`capture-name-${item.key}`} role="status" className="text-xs text-muted-foreground">{item.nameHint}</p>}
                    <div className="text-xs text-muted-foreground">
                      {item.kind === "image" ? "Photo" : "Video"}
                      {item.kind === "video" && (
                        <> · {formatOf(item.name)}{item.altFile ? ` + ${formatOf(item.altFile.name)}` : ""}</>
                      )}
                      {" · "}
                      {formatBytes(item.file.size + (item.altFile?.size ?? 0))}
                    </div>
                    {item.kind === "video" && item.altFile && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="rounded-full border bg-muted px-2 py-0.5">
                          Alternate format: {item.altFile.name}
                        </span>
                        {item.status !== "done" && !busy && (
                          <button
                            type="button"
                            onClick={() => patch(item.key, { altFile: null })}
                            className="capture-hit-sm grid place-items-center opacity-60 active:opacity-100"
                            aria-label={`Remove alternate format for ${item.name}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}

                      </div>
                    )}
                    {item.status === "done" ? (
                      <LabelChips tags={item.tags} />
                    ) : (
                      <LabelPicker
                        scope={item.kind === "image" ? "images" : "videos"}
                        value={item.tags}
                        onChange={(next) => patch(item.key, { tags: next })}
                        triggerLabel="Label this one"
                        compact
                      />
                    )}
                    <PageAssign
                      options={pageOptions}
                      value={item.pageIds}
                      onChange={(next) => patch(item.key, { pageIds: next })}
                      disabled={busy || item.status === "done"}
                      triggerLabel="Pages for this one"
                      compact
                    />

                    {item.status === "error" && (
                      <div className="flex items-start gap-1.5 text-xs text-destructive">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{item.error}</span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {summary && (
          <section className="rounded-xl border bg-card p-4 text-sm space-y-3">
            <div className="font-medium">
              Uploaded {summary.images} photo{summary.images === 1 ? "" : "s"} and {summary.videos} video{summary.videos === 1 ? "" : "s"}
              {summary.failed > 0 ? ` · ${summary.failed} failed` : ""}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="outline"><Link to="/manage/images">Open Images</Link></Button>
              <Button asChild variant="outline"><Link to="/manage/videos">Open Videos</Link></Button>
            </div>
          </section>
        )}
      </main>

      {/* Sticky upload bar */}
      {items.length > 0 && (
        <div className="capture-safe-bottom capture-safe-x fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur">
          {progress && (
            <div
              className="h-1 bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
              role="progressbar"
              aria-valuenow={progress.done}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-label="Upload Progress"
            />
          )}
          <div className="mx-auto max-w-3xl px-4 pt-2 pb-2 sm:px-4 flex items-center gap-3">
            <div className="flex-1 min-w-0 text-xs text-muted-foreground">
              {progress
                ? `Uploading ${progress.done} of ${progress.total}…`
                : pending.length
                  ? `${pending.length} ready · ${formatBytes(totalBytes)}`
                  : "All uploaded"}
            </div>
            <Button
              type="button" size="lg" disabled={busy || !pending.length}
              onClick={upload}
              className="h-12 gap-2 min-w-[9rem] rounded-xl text-base transition-transform active:scale-[0.97]"
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CloudUpload className="w-5 h-5" />}
              {busy ? "Uploading…" : `Upload ${pending.length || ""}`.trim()}
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}
