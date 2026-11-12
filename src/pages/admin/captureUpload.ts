// Shared upload primitives used by the Images tool, the Video tool and the
// phone-first Capture page (/manage/capture).
//
// Everything here writes to Lovable Cloud storage + tables:
//   images  -> images-original (private) + images-web-gated (PRIVATE) -> `images` row
//   videos  -> videos-web-gated (PRIVATE) -> `videos` row (published into videos-web)
// New image derivatives land in the PRIVATE staging bucket and are only moved
// into the PUBLIC images-web bucket when the asset is published (see the
// publish-assets edge function). Originals always stay private.
import { supabase } from "@/prototype/client";
import { optimizeImagePair } from "@/lib/imageOptimize";
import { extractAndPersistExif } from "./imageExif";
import { probeVideoFile } from "./videoHelpers";
import { GATED_BUCKET, VIDEO_GATED_BUCKET, VIDEO_PUBLIC_BUCKET } from "@/lib/assetUrl";
import { sanitizeCaptureName } from "./captureName";

export const SIGN_EXPIRY = 60 * 60 * 24 * 365 * 10;

/** Public (never-expiring) bucket that holds published video files + posters. */
export const POSTER_BUCKET = VIDEO_PUBLIC_BUCKET;

/**
 * Storage bucket a video row's files actually live in. New uploads stage in the
 * private gated bucket; publishing moves them (same keys) into videos-web.
 * Legacy rows still point at the old private originals bucket.
 */
export function videoBucketFor(row: { storage_url?: string | null; visibility?: string | null }): string {
  const u = row?.storage_url ?? "";
  if (u.includes(`/${VIDEO_GATED_BUCKET}/`)) return VIDEO_GATED_BUCKET;
  if (u.includes(`/${VIDEO_PUBLIC_BUCKET}/`)) return VIDEO_PUBLIC_BUCKET;
  if (u.includes("/videos-original/")) return "videos-original";
  return row?.visibility === "public" ? VIDEO_PUBLIC_BUCKET : VIDEO_GATED_BUCKET;
}

export async function signedUrl(bucket: string, path: string): Promise<string> {
  const { data } = await (supabase as any).storage.from(bucket).createSignedUrl(path, SIGN_EXPIRY);
  return data?.signedUrl ?? "";
}

/** Permanent URL for an object in a PUBLIC bucket (images-web, videos-web). */
export function publicUrl(bucket: string, path: string): string {
  const { data } = (supabase as any).storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl ?? "";
}

/** Guard: never register an asset against a build-time source path. */
function assertServed(...urls: string[]) {
  for (const u of urls) {
    if (!u || u.startsWith("/src/") || u.startsWith("src/")) {
      throw new Error("Refusing to register asset with unserved build-time path");
    }
  }
}

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

/** Ensure a filename is unique against a set of names already in use. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 10000; i++) {
    const cand = `${base}-${i}${ext}`;
    if (!taken.has(cand)) return cand;
  }
  return `${base}-${Date.now()}${ext}`;
}

export interface UploadOpts {
  /** Final asset name (already de-duplicated by the caller). */
  filename: string;
  /** Label paths to store on the row. */
  tags?: string[];
  description?: string;
  altText?: string;
  /** Longest side for the generated web copy. */
  maxSide?: number;
}

/**
 * Upload one image. Rolls back the stored objects if the row insert fails so
 * storage never accumulates files the database doesn't know about.
 */
export async function uploadImageFile(file: File, opts: UploadOpts): Promise<any> {
  opts = { ...opts, filename: sanitizeCaptureName(opts.filename, file.name) };
  const { blob, fallbackBlob, width, height } = await optimizeImagePair(file, opts.maxSide ?? 1920);
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const safe = safeName(opts.filename);
  const stem = `${stamp}_${rand}_${safe.replace(/\.\w+$/, "")}`;
  const origPath = `${stamp}_${rand}_${safe}`;
  const webPath = `${stem}.webp`;
  const fbPath = `${stem}.jpg`;

  const up1 = await (supabase as any).storage
    .from("images-original").upload(origPath, file, { contentType: file.type });
  if (up1.error) throw up1.error;
  const up2 = await (supabase as any).storage
    .from(GATED_BUCKET).upload(webPath, blob, { contentType: "image/webp" });
  if (up2.error) {
    await (supabase as any).storage.from("images-original").remove([origPath]);
    throw up2.error;
  }
  // JPEG fallback for <picture>. Best-effort: a failure here must not sink an
  // otherwise-good upload — the row simply has no fallback.
  const up3 = await (supabase as any).storage
    .from(GATED_BUCKET).upload(fbPath, fallbackBlob, { contentType: "image/jpeg" });
  const haveFallback = !up3.error;

  try {
    const origUrl = await signedUrl("images-original", origPath);
    // Canonical (public-shaped) URL inside the PRIVATE staging bucket. It is
    // not fetchable anonymously; publishing swaps the bucket segment in place.
    const webUrl = publicUrl(GATED_BUCKET, webPath);
    const fbUrl = haveFallback ? publicUrl(GATED_BUCKET, fbPath) : "";
    assertServed(origUrl, webUrl);

    const { data, error } = await (supabase as any).from("images").insert({
      filename: opts.filename,
      original_path: origPath, web_path: webPath,
      original_url: origUrl, web_url: webUrl,
      fallback_path: haveFallback ? fbPath : null,
      fallback_url: haveFallback ? fbUrl : null,
      fallback_bytes: haveFallback ? fallbackBlob.size : null,
      width, height,
      original_bytes: file.size, web_bytes: blob.size,
      tags: opts.tags ?? [],
      description: opts.description ?? "",
      alt_text: opts.altText ?? "",
      visibility: "gated",
    }).select("*").single();
    if (error) throw error;

    // EXIF (GPS / capture date / camera) comes from the ORIGINAL file, which
    // still carries full metadata. Fire-and-forget: never block the upload.
    void extractAndPersistExif(data.id, file).catch(() => {});
    return data;
  } catch (e) {
    await (supabase as any).storage.from("images-original").remove([origPath]);
    await (supabase as any).storage.from(GATED_BUCKET).remove(haveFallback ? [webPath, fbPath] : [webPath]);
    throw e;
  }
}

/**
 * Upload one video. A poster frame is grabbed client-side (no transcoding)
 * and stored in the public videos-web bucket, so the poster URL never expires.
 *
 * `altFile` is an optional second encoding of the SAME clip (e.g. a WebM next
 * to the MP4). Both are stored and the row records the alternate so pages can
 * render a <video> with one <source> per format.
 */
export async function uploadVideoFile(
  file: File,
  opts: UploadOpts & { altFile?: File | null },
): Promise<any> {
  opts = { ...opts, filename: sanitizeCaptureName(opts.filename, file.name) };
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const safe = safeName(opts.filename);
  const storagePath = `${stamp}_${rand}_${safe}`;

  const probe = await probeVideoFile(file).catch(() => ({
    duration: 0, width: 0, height: 0, posterBlob: null as Blob | null,
  }));

  const up = await (supabase as any).storage
    .from(VIDEO_GATED_BUCKET).upload(storagePath, file, { contentType: file.type });
  if (up.error) throw up.error;

  // Alternate encoding (best effort — a failure must not sink the upload).
  let altPath: string | null = null;
  let altUrl: string | null = null;
  if (opts.altFile) {
    const aPath = `${stamp}_${rand}_${safeName(opts.altFile.name)}`;
    const au = await (supabase as any).storage
      .from(VIDEO_GATED_BUCKET).upload(aPath, opts.altFile, { contentType: opts.altFile.type });
    if (!au.error) {
      altPath = aPath;
      altUrl = publicUrl(VIDEO_GATED_BUCKET, aPath);
    }
  }

  let posterUrl: string | null = null;
  let posterPath: string | null = null;
  if (probe.posterBlob) {
    const pPath = `video-posters/${stamp}_${rand}_${safe.replace(/\.[^.]+$/, "")}.webp`;
    const pu = await (supabase as any).storage.from(VIDEO_GATED_BUCKET).upload(
      pPath, probe.posterBlob, { contentType: "image/webp", upsert: true },
    );
    if (!pu.error) {
      posterPath = pPath;
      posterUrl = publicUrl(VIDEO_GATED_BUCKET, pPath);
    }
  }

  try {
    // Canonical (public-shaped) URL inside the PRIVATE staging bucket — only
    // the bucket segment changes when the video is published.
    const url = publicUrl(VIDEO_GATED_BUCKET, storagePath);
    assertServed(url);
    const { data, error } = await (supabase as any).from("videos").insert({
      name: opts.filename,
      source_type: "upload",
      storage_path: storagePath,
      storage_url: url,
      alt_path: altPath,
      alt_url: altUrl,
      alt_mime: opts.altFile && altPath ? (opts.altFile.type || null) : null,
      alt_bytes: opts.altFile && altPath ? opts.altFile.size : null,
      duration_seconds: probe.duration || null,
      width: probe.width || null,
      height: probe.height || null,
      file_bytes: file.size,
      poster_url: posterUrl,
      poster_path: posterPath,
      tags: opts.tags ?? [],
      description: opts.description ?? "",
      alt_text: opts.altText ?? "",
      visibility: "gated",
    }).select("*").single();
    if (error) throw error;
    return data;
  } catch (e) {
    const paths = altPath ? [storagePath, altPath] : [storagePath];
    if (posterPath) paths.push(posterPath);
    await (supabase as any).storage.from(VIDEO_GATED_BUCKET).remove(paths);
    throw e;
  }
}


/**
 * Record "used on page" links. These join tables are insert/delete only
 * (updates are denied by policy), so we always insert fresh rows.
 */
export async function attachPageUsages(
  kind: "image" | "video",
  assetId: string,
  pageIds: string[],
): Promise<void> {
  if (!pageIds.length) return;
  const table = kind === "image" ? "image_page_usages" : "video_page_usages";
  const col = kind === "image" ? "image_id" : "video_id";
  const rows = pageIds.map((page_id) => ({ [col]: assetId, page_id }));
  await (supabase as any).from(table).upsert(rows, { onConflict: `${col},page_id` });
}
