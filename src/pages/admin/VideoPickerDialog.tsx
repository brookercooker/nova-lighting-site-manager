import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TopDropContent } from "./designChat/TopDropPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/prototype/client";
import { leafOf, matchesLabelFilter } from "./labelPath";
import { useLabelsForScope } from "./useAllLabels";

interface Choice { url: string; poster?: string; name: string }
export interface LibraryVideo extends Choice { id?: string; altUrl?: string; labels: string[]; createdAt?: string }

/** The video library as the page editor uses it: `url` and `poster` are exactly what a video block stores. */
export async function loadLibraryVideos(limit = 120): Promise<LibraryVideo[]> {
  const { data } = await (supabase as any)
    .from("videos")
    .select("id,name,storage_url,external_url,poster_url,alt_url,tags,created_at")
    .is("archived_at", null)
    .limit(limit);
  return (data ?? [])
    .map((row: any) => ({
      id: row.id,
      url: row.external_url || row.storage_url || "",
      altUrl: row.alt_url || undefined,
      poster: row.poster_url || undefined,
      name: row.name || "",
      labels: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
      createdAt: row.created_at ?? undefined,
    }))
    .filter((c: LibraryVideo) => !!c.url);
}

/** Same search the picker uses: name and labels (full path or last part). */
export function videoMatches(i: LibraryVideo, term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return i.name.toLowerCase().includes(t) || i.labels.some((l) => l.toLowerCase().includes(t) || leafOf(l).toLowerCase().includes(t));
}

/** Pick a video from the library, paste a YouTube / Vimeo link, or upload a file. */
export default function VideoPickerDialog({
  open, onOpenChange, onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (choice: Choice) => void;
}) {
  const [items, setItems] = useState<LibraryVideo[]>([]);
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    setQ(""); setUrl(""); setLabel("");
    void loadLibraryVideos().then(setItems);
  }, [open]);

  // Labels come from the same per-tool label registry the Videos page uses.
  const { data: labelRows = [], refetch: refetchLabels } = useLabelsForScope("videos");
  useEffect(() => { if (open) refetchLabels(); }, [open, refetchLabels]);
  const allLabels = useMemo(
    () => labelRows.map((r) => r.path).sort((a, b) => a.localeCompare(b)),
    [labelRows],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = items.filter((i) => {
      if (label && !matchesLabelFilter(i.labels, label)) return false;
      return videoMatches(i, term);
    });
    return list.sort((a, b) => {
      const la = (a.labels[0] ?? "\uffff").toLowerCase();
      const lb = (b.labels[0] ?? "\uffff").toLowerCase();
      return la === lb ? a.name.localeCompare(b.name) : la.localeCompare(lb);
    });
  }, [items, q, label]);

  const upload = async (file: File) => {
    const path = `design/${Date.now()}-${file.name}`;
    await (supabase as any).storage.from("videos-web").upload(path, file);
    const publicUrl = (supabase as any).storage.from("videos-web").getPublicUrl(path).data.publicUrl;
    onPick({ url: publicUrl, name: file.name.replace(/\.[^.]+$/, "") });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TopDropContent className="gap-4 p-6 overflow-y-auto">
        <DialogHeader><DialogTitle>Choose a Video</DialogTitle></DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos" className="w-52" />
          <div className="flex-1 min-w-[220px] flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="…or paste a YouTube, Vimeo, or video link"
            />
            <Button
              variant="outline"
              disabled={!url.trim()}
              onClick={() => { onPick({ url: url.trim(), name: "" }); onOpenChange(false); }}
            >
              Use Link
            </Button>
          </div>
          <label className="inline-flex">
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
            />
            <Button asChild variant="outline"><span>Upload</span></Button>
          </label>
        </div>

        {allLabels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className="text-xs text-muted-foreground mr-0.5">Labels</span>
            <button
              onClick={() => setLabel("")}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                label === "" ? "bg-foreground text-background border-foreground" : "hover:bg-muted text-muted-foreground"
              }`}
            >
              All
            </button>
            {allLabels.map((l) => (
              <button
                key={l}
                title={l}
                onClick={() => setLabel(label === l ? "" : l)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  label === l ? "bg-tag-selected text-tag-selected-foreground border-tag-selected" : "hover:bg-muted text-muted-foreground"
                }`}
              >
                {leafOf(l)}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-[50vh] overflow-y-auto">
          {filtered.map((it) => (
            <button
              key={it.url + it.name}
              onClick={() => { onPick(it); onOpenChange(false); }}
              className="group rounded-lg overflow-hidden border text-left hover:border-primary transition-colors"
              title={it.labels.length ? `${it.name} — ${it.labels.join(", ")}` : it.name}
            >
              {it.poster ? (
                <img src={it.poster} alt={it.name} className="w-full aspect-video object-cover" loading="lazy" />
              ) : (
                <div className="w-full aspect-video bg-muted" />
              )}
              <span className="block truncate px-2 pt-1.5 text-xs">{it.name}</span>
              {it.labels.length > 0 && (
                <span className="block truncate px-2 pb-1.5 text-[10px] text-muted-foreground">
                  {it.labels.join(" · ")}
                </span>
              )}
            </button>
          ))}
          {!filtered.length && (
            <p className="col-span-full text-sm text-muted-foreground py-6 text-center">No videos found.</p>
          )}
        </div>
      </TopDropContent>
    </Dialog>
  );
}
