import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TopDropContent } from "./designChat/TopDropPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/prototype/client";
import { leafOf, matchesLabelFilter } from "./labelPath";
import { useLabelsForScope } from "./useAllLabels";
import { libraryImageCandidates } from "./imageTileSrc";
import LibraryImageThumbnail from "./LibraryImageThumbnail";



interface Choice { url: string; alt: string }
export interface LibraryImage extends Choice { id?: string; name?: string; labels: string[]; createdAt?: string; visibility?: string; webPath?: string; webUrl?: string; fallbackUrl?: string; originalUrl?: string }

/** The image library as the page editor uses it: `url` is exactly what an image block stores. */
export async function loadLibraryImages(limit = 2000): Promise<LibraryImage[]> {
  const { data } = await (supabase as any)
    .from("images")
    .select("id,filename,web_path,web_url,fallback_url,original_url,alt_text,tags,created_at,visibility")
    .is("archived_at", null)
    .limit(limit);
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.filename || row.alt_text || "",
    url: libraryImageCandidates(row)[0] ?? "",
    alt: row.alt_text || row.filename || "",
    labels: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
    createdAt: row.created_at ?? undefined,
    visibility: row.visibility,
    webPath: row.web_path,
    webUrl: row.web_url,
    fallbackUrl: row.fallback_url,
    originalUrl: row.original_url,
  }));
}

/** Same search the picker uses: name/alt text and labels (full path or last part). */
export function imageMatches(i: LibraryImage, term: string) {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return i.alt.toLowerCase().includes(t) || (i.name ?? "").toLowerCase().includes(t) ||
    i.labels.some((l) => l.toLowerCase().includes(t) || leafOf(l).toLowerCase().includes(t));
}


/** Pick an image from the library, paste a URL, or upload one from the computer. */
export default function ImagePickerDialog({
  open, onOpenChange, onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (choice: Choice) => void;
}) {
  const [items, setItems] = useState<LibraryImage[]>([]);
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [usable, setUsable] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setQ(""); setUrl(""); setLabel("");
    void loadLibraryImages().then(setItems);
  }, [open]);

  // Labels come from the same per-tool label registry the Images page uses,
  // so chips reflect user-created labels and refresh when they change.
  const { data: labelRows = [], refetch: refetchLabels } = useLabelsForScope("images");
  useEffect(() => { if (open) refetchLabels(); }, [open, refetchLabels]);
  const allLabels = useMemo(
    () => labelRows.map((r) => r.path).sort((a, b) => a.localeCompare(b)),
    [labelRows],
  );



  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = items.filter((i) => {
      if (label && !matchesLabelFilter(i.labels, label)) return false;
      return imageMatches(i, term);
    });
    // Sort by label first so search results group together by label.
    return list.sort((a, b) => {
      const la = (a.labels[0] ?? "\uffff").toLowerCase();
      const lb = (b.labels[0] ?? "\uffff").toLowerCase();
      return la === lb ? a.alt.localeCompare(b.alt) : la.localeCompare(lb);
    });
  }, [items, q, label]);


  const upload = async (file: File) => {
    const path = `design/${Date.now()}-${file.name}`;
    await (supabase as any).storage.from("images-web").upload(path, file);
    const publicUrl = (supabase as any).storage.from("images-web").getPublicUrl(path).data.publicUrl;
    onPick({ url: publicUrl, alt: file.name.replace(/\.[^.]+$/, "") });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TopDropContent className="gap-4 p-6 overflow-y-auto">
        <DialogHeader><DialogTitle>Choose an Image</DialogTitle></DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search images" className="w-52" />
          <div className="flex-1 min-w-[220px] flex gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image link" />
            <Button
              variant="outline"
              disabled={!url.trim()}
              onClick={() => { onPick({ url: url.trim(), alt: "" }); onOpenChange(false); }}
            >
              Use Link
            </Button>
          </div>
          <label className="inline-flex">
            <input
              type="file"
              accept="image/*"
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

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-4 flex-1 min-h-0 auto-rows-max content-start overflow-y-auto overscroll-contain pr-2">
          {filtered.map((it) => (
            <button
              key={it.id ?? it.url}
              type="button"
              onClick={() => { onPick({ ...it, url: usable[it.id ?? it.url] ?? it.url }); onOpenChange(false); }}
              className="group rounded-lg overflow-hidden border hover:border-primary transition-colors text-left"
              title={it.labels.length ? `${it.alt} — ${it.labels.join(", ")}` : it.alt}
            >
              <LibraryImageThumbnail candidates={libraryImageCandidates({ web_url: it.webUrl ?? it.url, fallback_url: it.fallbackUrl, original_url: it.originalUrl })} className="w-full aspect-[4/3] object-cover bg-muted" onSource={url => setUsable(previous => previous[it.id ?? it.url] === url ? previous : { ...previous, [it.id ?? it.url]: url })} />
              {it.labels.length > 0 && (
                <span className="block truncate px-1.5 py-1 text-[10px] text-muted-foreground">
                  {it.labels.join(" · ")}
                </span>
              )}
            </button>
          ))}
          {!filtered.length && (
            <p className="col-span-full text-sm text-muted-foreground py-6 text-center">No images found.</p>
          )}
        </div>
      </TopDropContent>
    </Dialog>
  );
}
