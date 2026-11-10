import { managerCors, managerOrigins } from "../_shared/managerSecurity.ts";
// Bootstraps admin roles.
// - If the signed-in user's email is listed in admin_emails, ensures they have
//   the 'admin' role in user_roles.
// - If admin_emails is completely empty AND user_roles has no admins,
//   promotes the caller to admin (first-user bootstrap).
// - Always ensures the caller has at least the 'user' role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";


Deno.serve(async (req) => {
  const allowed = managerOrigins(Deno.env.get("EMBED_PARENT_ORIGINS"), Deno.env.get("SITE_MANAGER_ORIGINS"));
  const corsHeaders = managerCors(req, allowed);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "missing token" }, 401);
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return json({ error: "missing token" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(url, service);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user?.email) return json({ error: "invalid user" }, 401);

    const uid = userData.user.id;
    const email = userData.user.email.trim().toLowerCase();

    // Only emails listed in admin_emails get a role; everyone else gets nothing.
    const { data: match } = await admin
      .from("admin_emails")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (!match) return json({ ok: true, bootstrapped: false });

    await admin.from("user_roles").upsert(
      { user_id: uid, role: "admin" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

    return json({ ok: true, bootstrapped: true, email });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
