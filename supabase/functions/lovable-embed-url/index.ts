import { createClient } from "npm:@supabase/supabase-js@2";
import { relaySecretMatches } from "./relaySecret.ts";
import { isAllowedOrigin, normalizeOrigin, parseAllowedOrigins } from "../_shared/embed.ts";

const EMBED_API = "https://api.lovable.dev/v1/projects";

function corsFor(req: Request, allowed: string[]) {
  const origin = normalizeOrigin(req.headers.get("Origin"));
  return {
    ...(origin && isAllowedOrigin(origin, allowed) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  const allowed = parseAllowedOrigins(Deno.env.get("EMBED_PARENT_ORIGINS"));
  const cors = corsFor(req, allowed);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const apiKey = Deno.env.get("EMBED_API_KEY");
  const projectId = Deno.env.get("EMBED_PROJECT_ID");
  if (!apiKey || !projectId || allowed.length === 0) return json({ error: "Server configuration error" }, 500);

  const relayOk = relaySecretMatches(Deno.env.get("RELAY_EMBED_SECRET"), req.headers.get("x-relay-secret"));
  if (!relayOk && Deno.env.get("EMBED_ALLOW_UNAUTHENTICATED") !== "1") {
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) return json({ error: "Server configuration error" }, 500);
    const m = /^Bearer\s+(.+)$/.exec(req.headers.get("Authorization") ?? "");
    if (!m) return json({ error: "missing token" }, 401);
    const admin = createClient(url, service);
    const { data: userData, error: userErr } = await admin.auth.getUser(m[1].trim());
    if (userErr || !userData.user) return json({ error: "invalid user" }, 401);
    const { data: role, error: roleErr } = await admin
      .from("user_roles").select("user_id").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (roleErr) return json({ error: "role check failed" }, 500);
    if (!role) return json({ error: "forbidden" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const parentOrigin = normalizeOrigin(body?.parent_origin);
  if (!isAllowedOrigin(parentOrigin, allowed)) return json({ error: "This address isn't allowed to show the preview." }, 400);

  let upstream: Response;
  try {
    upstream = await fetch(`${EMBED_API}/${encodeURIComponent(projectId)}/embed-url`, {
      method: "POST",
      headers: { "Lovable-API-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ parent_origin: parentOrigin }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return json({ error: "The preview service didn't answer. Try again." }, 502);
  }
  if (!upstream.ok) {
    console.error("embed-url failed", upstream.status, (await upstream.text().catch(() => "")).slice(0, 500));
    return json({ error: upstream.status === 429 ? "Too many requests. Try again in a moment." : "Couldn't load the preview." }, 502);
  }
  const data = await upstream.json().catch(() => null);
  if (!data?.embed_url || !data?.expires_at) return json({ error: "Couldn't load the preview." }, 502);
  return json({ embed_url: data.embed_url, expires_at: data.expires_at });
});
