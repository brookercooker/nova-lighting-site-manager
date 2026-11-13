import { Component, Suspense, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import html2canvas from "html2canvas";
import { supabase } from "@/prototype/client";
import { objectRegistry } from "@/components/objects/registry";
import ObjectSections, { parseSections } from "@/components/ObjectSections";
import { ThumbnailContext } from "@/lib/thumbnail";
import { BUILD_ID } from "@/lib/buildVersion";
import { createReplay } from "@/lib/inlineEditCore";
import { ThumbnailCartProvider } from "@/contexts/CartContext";

const tasks = new Map<string, Promise<string | null>>();
let queue = Promise.resolve();
class CaptureBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
function CaptureReady({ onReady }: { onReady: () => void }) { useEffect(onReady, [onReady]); return null; }
/** Capture the saved object, regardless of publication status, without visitor chrome or a privileged remote read. */
export function requestObjectThumbnail(id: string, force = false): Promise<string | null> {
  if (force) tasks.delete(id);
  const existing = tasks.get(id);
  if (existing) return existing;
  const task = queue.then(() => capture(id, force)).catch(() => null);
  tasks.set(id, task);
  queue = task.then(() => undefined);
  return task;
}
async function capture(id: string, force: boolean): Promise<string | null> {
  const db = supabase as any;
  const { data: row, error } = await db.from("object_registry").select("component_key,content,inline_edits,thumbnail_url,archived_at").eq("id", id).maybeSingle();
  if (error || !row || row.archived_at) return null;
  if (row.thumbnail_url && !force) return row.thumbnail_url;
  const Live = row.component_key ? objectRegistry[row.component_key]?.component : undefined;
  const sections = parseSections(row.content);
  if (!Live && !sections.length) return null;
  const container = document.createElement("div");
  container.className = "fixed left-[-10000px] top-0 w-[1280px] min-h-[200px] bg-background text-foreground pointer-events-none";
  container.setAttribute("aria-hidden", "true"); container.setAttribute("inert", "");
  document.body.appendChild(container);
  const root = createRoot(container);
  const replay = createReplay();
  try {
    let mounted = false;
    let reportReady: () => void = () => {};
    const committed = new Promise<void>(resolve => { reportReady = () => { mounted = true; resolve(); }; });
    root.render(<CaptureBoundary><MemoryRouter><ThumbnailCartProvider><ThumbnailContext.Provider value={true}><Suspense fallback={null}>{Live ? <Live /> : <ObjectSections sections={sections} />}<CaptureReady onReady={reportReady} /></Suspense></ThumbnailContext.Provider></ThumbnailCartProvider></MemoryRouter></CaptureBoundary>);
    await Promise.race([committed, new Promise(resolve => setTimeout(resolve, 8000))]);
    if (!mounted) return null;
    await new Promise(resolve => setTimeout(resolve, 400));
    const objectRoot = container.firstElementChild;
    if (objectRoot && row.inline_edits) replay.apply(objectRoot, row.inline_edits);
    await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise(resolve => setTimeout(resolve, 2000))]);
    await Promise.all(Array.from(container.querySelectorAll("img")).map(image => {
      image.loading = "eager";
      if (image.complete) return Promise.resolve();
      return new Promise<void>(resolve => { image.onload = () => resolve(); image.onerror = () => resolve(); setTimeout(resolve, 2500); });
    }));
    if (!container.textContent?.trim() && !container.querySelector("img,video,svg")) return null;
    const canvas = await html2canvas(container, { width: 1280, height: Math.min(1200, container.scrollHeight), scale: 0.4, useCORS: true, logging: false });
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) return null;
    const path = `object/${id}-thumb.jpg`;
    const { error: uploadError } = await db.storage.from("page-thumbnails").upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (uploadError) return null;
    const { data: urlData } = db.storage.from("page-thumbnails").getPublicUrl(path);
    const url = urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
    if (!url) return null;
    const { error: saveError } = await db.from("object_registry").update({ thumbnail_url: url, thumbnail_updated_at: new Date().toISOString(), thumbnail_build_version: BUILD_ID }).eq("id", id);
    return saveError ? null : url;
  } finally { replay.restoreAll(); root.unmount(); container.remove(); }
}