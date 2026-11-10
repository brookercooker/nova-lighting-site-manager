import { Copy, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";


export type PageRef = { id: string; name: string; path: string };
export type ObjectRef = {
  id: string;
  name: string;
  status?: "Draft" | "Ready";
  intendedPages?: string[];
  description?: string | null;
};
export type ImageRef = { id: string; filename: string; url: string; fallbackUrl?: string | null };
export type VideoRef = {
  id: string;
  name: string;
  source: "upload" | "youtube" | "vimeo";
  url: string;
  /** Alternate encoding (e.g. the WebM next to the MP4). */
  altUrl?: string | null;
  posterUrl?: string | null;
};

export const buildPageRef = (p: PageRef) =>
  `Page "${p.name}" (id: ${p.id}, route: ${p.path || "?"})`;

export const buildObjectRef = (o: ObjectRef) =>
  `Object "${o.name}" (id: ${o.id}, route: /objects/${o.id})`;

/**
 * Signed storage URLs carry an expiring `token` — never hand one to page code.
 * Only permanent public-bucket URLs may appear in a copied reference.
 */
const permanent = (u?: string | null) =>
  u && !u.includes("/object/sign/") && !u.includes("token=") ? u : null;

export const buildImageRef = (i: ImageRef) => {
  const fb = permanent(i.fallbackUrl);
  return fb && fb !== i.url
    ? `Image "${i.filename}" (id: ${i.id}, url: ${i.url}, fallback: ${fb}) — render with <SmartImage src="{url}" fallbackSrc="{fallback}" alt="…" /> from "@/components/SmartImage" so WebP is served with a JPEG fallback`
    : `Image "${i.filename}" (id: ${i.id}, url: ${i.url}) — render with <SmartImage src="{url}" alt="…" /> from "@/components/SmartImage"`;
};


export const buildVideoRef = (v: VideoRef) => {
  if (v.source !== "upload") return `Video "${v.name}" (id: ${v.id}, source: ${v.source}, url: ${v.url})`;
  const alt = permanent(v.altUrl);
  const poster = permanent(v.posterUrl);
  const warn = permanent(v.url) ? "" : " — NOTE: this clip still lives in the private bucket, so its URL expires; re-upload it to get a permanent link";
  return alt && alt !== v.url
    ? `Video "${v.name}" (id: ${v.id}, source: upload, url: ${v.url}, alternate: ${alt}${poster ? `, poster: ${poster}` : ""}) — render with <SmartVideo src="{url}" altSrc="{alternate}" ${poster ? 'poster="{poster}" ' : ""}controls /> from "@/components/SmartVideo" so WebM is served with an MP4 fallback${warn}`
    : `Video "${v.name}" (id: ${v.id}, source: upload, url: ${v.url}${poster ? `, poster: ${poster}` : ""}) — render with <SmartVideo src="{url}" ${poster ? 'poster="{poster}" ' : ""}controls /> from "@/components/SmartVideo"${warn}`;
};



async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch { toast.error("Copy failed"); }
}

export function CopyRefButton({
  reference, size = "sm", label = "Copy Reference", compact = false,
  disabled = false, disabledMessage,
}: {
  reference: string; id?: string; size?: "sm" | "default"; label?: string; compact?: boolean;
  disabled?: boolean; disabledMessage?: string;
}) {
  const base = compact ? "h-9 w-9 sm:h-8 sm:w-8 p-0" : "inline-flex items-center justify-center gap-1.5 whitespace-nowrap w-fit max-w-full px-3 h-9 sm:h-8 text-xs";
  const interactive = disabled
    ? "opacity-50 cursor-not-allowed"
    : "transition-all duration-200 cursor-pointer hover:bg-nova-ink hover:text-nova-cream hover:border-nova-ink hover:shadow-md hover:-translate-y-[1px] focus-visible:bg-nova-ink focus-visible:text-nova-cream active:translate-y-0 active:shadow-sm";
  return (
    <Button
      type="button"
      size={size}
      variant="secondary"
      className={`group ${base} ${interactive}`}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) { toast.warning(disabledMessage ?? "Copy Reference is not available yet."); return; }
        copy(reference, "Reference");
      }}
      title={disabled ? (disabledMessage ?? "") : (compact ? `Copy reference: ${reference}` : reference)}
      aria-label="Copy Reference"
      aria-disabled={disabled || undefined}
    >
      <Copy className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110" />
      {!compact && <span className="whitespace-nowrap">{label}</span>}
    </Button>
  );
}

export function CopyUrlButton({
  value, title, toastLabel = "URL",
}: {
  value: string; title?: string; toastLabel?: string;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap w-fit max-w-full px-3 h-8 text-xs";
  const interactive = "transition-all duration-200 cursor-pointer hover:bg-nova-ink hover:text-nova-cream hover:border-nova-ink hover:shadow-md hover:-translate-y-[1px] focus-visible:bg-nova-ink focus-visible:text-nova-cream active:translate-y-0 active:shadow-sm";
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className={`group ${base} ${interactive}`}
      onClick={(e) => { e.stopPropagation(); copy(value, toastLabel); }}
      title={title ?? value}
      aria-label="Copy URL"
    >
      <LinkIcon className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110" />
      <span className="whitespace-nowrap">Copy URL</span>
    </Button>
  );
}

