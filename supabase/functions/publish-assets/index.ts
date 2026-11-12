import { managerCors, managerOrigins } from "../_shared/managerSecurity.ts";
// Promote images between the PRIVATE staging bucket (images-web-gated) and the
// PUBLIC delivery bucket (images-web).
//
//   action: "publish"  -> images-web-gated  ->  images-web   (visibility = public)
//   action: "gate"     -> images-web        ->  images-web-gated (visibility = gated)
//
// The object key is preserved across the move, so a URL only ever changes
// bucket segment. That lets page code keep a single stable reference while the
// file's reachability follows the publish state.
import { moveKey, parseIds, type StorageApi } from "./move.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";


const BUCKETS = {
  image: { gated: "images-web-gated", public: "images-web" },
  video: { gated: "videos-web-gated", public: "videos-web" },
} as const;


Deno.serve(async (req) => {
  const allowed = managerOrigins(Deno.env.get("EMBED_PARENT_ORIGINS"), Deno.env.get("SITE_MANAGER_ORIGINS"));
  const corsHeaders = managerCors(req, allowed);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Caller must be a signed-in Site Manager user.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const { data: userData } = await admin.auth.getUser(token);
  const userId = userData?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { data: roles } = await admin
    .from("user_roles").select("role").eq("user_id", userId);
  if (!roles?.length) return json({ error: "forbidden" }, 403);

  let body: { ids?: unknown; action?: "publish" | "gate"; kind?: "image" | "video" };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = parseIds(body.ids);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const ids = parsed.ids;
  const action = body.action === "gate" ? "gate" : "publish";

  const kind = body.kind === "video" ? "video" : "image";
  const pair = BUCKETS[kind];
  const from = action === "publish" ? pair.gated : pair.public;
  const to = action === "publish" ? pair.public : pair.gated;

  const table = kind === "video" ? "videos" : "images";
  const select = kind === "video"
    ? "id, storage_path, storage_url, alt_path, alt_url, poster_path, poster_url, source_type, visibility"
    : "id, web_path, web_url, fallback_path, fallback_url, visibility";
  const { data: rows, error } = await admin.from(table).select(select).in("id", ids);
  if (error) return json({ error: error.message }, 500);

  const results: Array<{ id: string; ok: boolean; message?: string }> = [];

  for (const row of (rows ?? []) as any[]) {
    if (kind === "video" && row.source_type && row.source_type !== "upload") {
      // YouTube/Vimeo embeds have no stored file — just flip the flag.
      const { error: e } = await admin.from(table)
        .update({ visibility: action === "publish" ? "public" : "gated" }).eq("id", row.id);
      results.push({ id: row.id, ok: !e, message: e?.message });
      continue;
    }
    const keys = (kind === "video"
      ? [row.storage_path, row.alt_path, row.poster_path]
      : [row.web_path, row.fallback_path]).filter(Boolean) as string[];
    let moved = true;
    let note = "";

    for (const key of keys) {
      const err = await moveKey(admin.storage as unknown as StorageApi, key, from, to, pair.public, action === "gate");
      if (err) { moved = false; note = err; break; }
    }

    if (!moved) {
      results.push({ id: row.id, ok: false, message: note });
      continue;
    }

    const rewrite = (u: string | null) =>
      u ? u.replace(`/${from}/`, `/${to}/`) : u;

    const patch: Record<string, unknown> = {
      visibility: action === "publish" ? "public" : "gated",
    };
    if (kind === "video") {
      patch.storage_url = rewrite(row.storage_url);
      patch.alt_url = rewrite(row.alt_url);
      patch.poster_url = rewrite(row.poster_url);
    } else {
      patch.web_url = rewrite(row.web_url);
      patch.fallback_url = rewrite(row.fallback_url);
    }

    const { error: upErr } = await admin.from(table).update(patch).eq("id", row.id);

    results.push({ id: row.id, ok: !upErr, message: upErr?.message });
  }

  return json({ action, kind, results });
});
