import { managerCors, managerOrigins, allowedCaptureOrigin, validCapturePath } from "../_shared/managerSecurity.ts";
// Server-side page/object thumbnail capture via Cloudflare Browser Rendering.
// Auth: admin JWT required. Emits a short-lived render_token so the headless
// browser can bypass the app's client-side AdminGate.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { captureConfigured } from "./config.ts";

const CF_ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID")!;
const CF_TOKEN = Deno.env.get("CLOUDFLARE_BROWSER_RENDERING_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "page-thumbnails";

interface Body {
  kind: "page" | "object";
  id: string;
  path: string;              // e.g. "/home"; object paths are resolved server-side
  origin: string;            // e.g. "https://novalightingsandbox.lovable.app"
  buildVersion: string;
  force?: boolean;
}

Deno.serve(async (req) => {
  const allowed = managerOrigins(Deno.env.get("EMBED_PARENT_ORIGINS"), Deno.env.get("SITE_MANAGER_ORIGINS"));
  const corsHeaders = managerCors(req, allowed);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: userData } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const uid = userData?.user?.id;
    if (!uid) return json({ error: "unauthorized" }, 401);
    const { data: roleRows } = await admin.from("user_roles").select("role").eq("user_id", uid);
    const isAdmin = (roleRows ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    const body = (await req.json()) as Body;
    if (!body?.kind || !body?.id || !body?.path || !body?.origin) {
      return json({ error: "bad_request" }, 400);
    }

    const origin = allowedCaptureOrigin(body.origin, allowed);
    if (!origin) return json({ error: "origin_not_allowed" }, 400);
    if (!validCapturePath(body.path)) return json({ error: "bad_request" }, 400);

    // Optional thumbnails must not turn an unconfigured service into a runtime failure.
    // Reuse the client's existing expected-skip handling; keep previous thumbnails untouched.
    if (!captureConfigured(CF_ACCOUNT_ID, CF_TOKEN)) {
      return json({ ok: false, skipped: "route_not_resolved", error: "route_not_resolved", detail: "Thumbnail service is not configured — keeping the previous thumbnail." });
    }

    let capturePath = body.path;
    if (body.kind === "object") {
      // Object registry rows are admin-only, so the public /objects/<slug>
      // route cannot safely look itself up during headless capture. Resolve the
      // component with the service role here and capture the DB-free preview
      // route instead. This prevents intermittent "No object" screenshots from
      // being stored as valid thumbnails.
      const { data: objectRow, error: objectErr } = await admin
        .from("object_registry")
        .select("component_key,archived_at")
        .eq("id", body.id)
        .maybeSingle();
      if (objectErr) throw objectErr;
      if (!objectRow || objectRow.archived_at || !objectRow.component_key) {
        return json({ ok: false, skipped: "object_not_renderable", error: "object_not_renderable" }, 200);
      }
      capturePath = `/preview/object/${encodeURIComponent(objectRow.component_key)}`;
    }

    // Mint short-lived render token so CF's headless browser bypasses AdminGate.
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await admin.from("render_tokens").insert({
      token,
      purpose: `screenshot:${body.kind}:${body.id}`,
      expires_at: expires,
    });

    const sep = capturePath.includes("?") ? "&" : "?";
    const targetUrl = `${origin}${capturePath}${sep}render_token=${token}`;

    // Capture at two sizes. `snap()` returns both the screenshot and the page
    // HTML so we can detect and refuse to store a 404 / error snapshot.
    const thumb = await snap(targetUrl, 1280, 800);
    if (isNotFoundOrError(thumb.content)) {
      await admin.from("render_tokens").delete().eq("token", token);
      // Not an error: the route simply isn't built/published yet. Return 200 so
      // this shows up as a skip rather than a runtime edge-function failure.
      return json({
        ok: false,
        skipped: "route_not_resolved",
        error: "route_not_resolved",
        detail: "Captured render is the app's 404/error page — keeping previous thumbnail. Publish/build the page in Lovable and click 'Regenerate thumbnail'.",
      }, 200);
    }
    const preview = await snap(targetUrl, 1440, 900);

    const thumbPath = `${body.kind}/${body.id}-thumb.jpg`;
    const previewPath = `${body.kind}/${body.id}-preview.jpg`;

    const up1 = await admin.storage.from(BUCKET).upload(thumbPath, thumb.blob, {
      contentType: "image/jpeg", upsert: true, cacheControl: "3600",
    });
    if (up1.error) throw up1.error;
    const up2 = await admin.storage.from(BUCKET).upload(previewPath, preview.blob, {
      contentType: "image/jpeg", upsert: true, cacheControl: "3600",
    });
    if (up2.error) throw up2.error;

    const bust = Date.now();
    const thumbUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${thumbPath}?v=${bust}`;
    const previewUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${previewPath}?v=${bust}`;

    const table = body.kind === "page" ? "pages" : "object_registry";
    const { error: upErr } = await admin.from(table)
      .update({
        thumbnail_url: thumbUrl,
        preview_url: previewUrl,
        thumbnail_updated_at: new Date().toISOString(),
        thumbnail_build_version: body.buildVersion,
      })
      .eq("id", body.id);
    if (upErr) throw upErr;

    await admin.from("render_tokens").delete().eq("token", token);

    return json({ ok: true, thumbnail_url: thumbUrl, preview_url: previewUrl });
  } catch (e) {
    console.error("capture-thumbnail error", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});



/** Detects the app's NotFound render (or Lovable login gate) so we never
 *  overwrite a real thumbnail with a picture of a 404 or auth screen. */
function isNotFoundOrError(html: string): boolean {
  if (!html) return true;
  if (/data-app-render-status=["']not-found["']/i.test(html)) return true;
  if (/name=["']x-app-render-status["']\s+content=["']not-found["']/i.test(html)) return true;
  // Defensive fallback: literal 404 heading with our "Oops!" copy.
  if (/Oops!\s*Page not found/i.test(html)) return true;
  // Lovable preview auth wall (should be bypassed by render_token, but guard anyway).
  if (/lovable\.dev\/login|Log in to preview/i.test(html)) return true;
  return false;
}

/** Cloudflare Browser Rendering /snapshot returns both the rendered HTML and
 *  a base64 screenshot in one round-trip, so we can classify the page before
 *  storing the image. */
async function snap(url: string, vpW: number, vpH: number): Promise<{ blob: Blob; content: string }> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/snapshot`;
  const payload = {
    url,
    viewport: { width: vpW, height: vpH },
    screenshotOptions: { type: "jpeg", quality: 82, fullPage: false },
    gotoOptions: { waitUntil: "networkidle0", timeout: 30000 },
  };

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const txt = await res.text().catch(() => "");
    if (res.ok) {
      try {
        const parsed = JSON.parse(txt);
        const b64: string | undefined = parsed?.result?.screenshot;
        const content: string = parsed?.result?.content ?? "";
        if (b64) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          return { blob: new Blob([bytes], { type: "image/jpeg" }), content };
        }
        lastErr = `Cloudflare BR snapshot: no screenshot in response`;
      } catch (_e) {
        lastErr = `Cloudflare BR snapshot: unparseable response ${txt.slice(0, 200)}`;
      }
    } else {
      lastErr = `Cloudflare BR ${res.status}: ${txt.slice(0, 300)}`;
    }
    const retryable = res.status === 429 || res.status >= 500 || /timeout|busy/i.test(txt);
    if (!retryable) throw new Error(lastErr);
    const waitMs = Math.min(30000, 2000 * 2 ** attempt);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error(lastErr || "Cloudflare BR: retries exhausted");
}
