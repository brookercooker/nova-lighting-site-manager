import { managerCors, managerOrigins } from "../_shared/managerSecurity.ts";
// Admin-only: list users and update roles.
// Actions:
//   GET / (default): list users with their roles
//   POST { action: "set_admin", user_id, is_admin }: add/remove admin role
//   POST { action: "set_user", user_id, is_user }: grant access / remove all roles
import { createClient } from "npm:@supabase/supabase-js@2";


Deno.serve(async (req) => {
  const allowed = managerOrigins(Deno.env.get("EMBED_PARENT_ORIGINS"), Deno.env.get("SITE_MANAGER_ORIGINS"));
  const corsHeaders = managerCors(req, allowed, "GET, POST, OPTIONS");
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !anon || !service) {
      return json({ error: "Server configuration error" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "missing token" }, 401);
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return json({ error: "missing token" }, 401);

    const admin = createClient(url, service);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "invalid user" }, 401);

    const callerId = userData.user.id;
    const callerEmail = (userData.user.email ?? "").trim().toLowerCase();

    // Verify caller is admin using the service client directly. This avoids
    // depending on the public has_role RPC, whose permissions are intentionally
    // restricted for security scan compliance.
    const { data: callerAdminRole, error: callerRoleErr } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();
    if (callerRoleErr) return json({ error: callerRoleErr.message }, 500);

    let hasAdmin = !!callerAdminRole;
    if (!hasAdmin && callerEmail) {
      const { data: adminEmail, error: emailErr } = await admin
        .from("admin_emails")
        .select("email")
        .eq("email", callerEmail)
        .maybeSingle();
      if (emailErr) return json({ error: emailErr.message }, 500);

      if (adminEmail) {
        const { error: roleErr } = await admin
          .from("user_roles")
          .upsert([
            { user_id: callerId, role: "user" },
            { user_id: callerId, role: "admin" },
          ], { onConflict: "user_id,role", ignoreDuplicates: true });
        if (roleErr) return json({ error: roleErr.message }, 500);
        hasAdmin = true;
      }
    }

    if (!hasAdmin) return json({ error: "forbidden" }, 403);

    // Best-effort audit trail; a failed insert never fails the action.
    const audit = async (action: string, targetId: string | null, targetEmail: string | null, detail: Record<string, unknown> | null = null) => {
      try {
        const { error } = await admin.from("admin_audit_log").insert({
          actor_id: callerId, actor_email: callerEmail || null, action,
          target_id: targetId, target_email: targetEmail, detail,
        });
        if (error) console.error("admin audit insert failed", error.message);
      } catch (e) { console.error("admin audit insert failed", e); }
    };
    const emailOf = async (id: string) => {
      try { const { data } = await admin.auth.admin.getUserById(id); return data?.user?.email ?? null; } catch { return null; }
    };

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const { action } = body ?? {};

      if (action === "invite_user" || action === "create_user") {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        const role = body.role === "admin" ? "admin" : "user";
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: "Please enter a valid email address." }, 400);
        }
        if (!password || password.length < 8) {
          return json({ error: "Password must be at least 8 characters." }, 400);
        }
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (createErr || !created?.user) {
          return json({ error: createErr?.message || "Failed to create user" }, 500);
        }
        const rolesToInsert: Array<{ user_id: string; role: string }> = [
          { user_id: created.user.id, role: "user" },
        ];
        if (role === "admin") rolesToInsert.push({ user_id: created.user.id, role: "admin" });
        const { error: roleErr } = await admin
          .from("user_roles")
          .upsert(rolesToInsert, { onConflict: "user_id,role", ignoreDuplicates: true });
        if (roleErr) return json({ error: roleErr.message }, 500);
        await audit("create_user", created.user.id, created.user.email ?? email, { role });
        return json({ ok: true, user_id: created.user.id, email: created.user.email });
      }

      if (action === "delete_user") {
        const { user_id } = body ?? {};
        if (typeof user_id !== "string") return json({ error: "bad request" }, 400);
        if (user_id === userData.user.id) {
          return json({ error: "You cannot delete your own account." }, 400);
        }
        const targetEmail = await emailOf(user_id);
        // Delete the account first; user_roles rows go with it (ON DELETE CASCADE).
        const { error: delUserErr } = await admin.auth.admin.deleteUser(user_id);
        if (delUserErr) return json({ error: delUserErr.message }, 500);
        await audit("delete_user", user_id, targetEmail);
        return json({ ok: true });
      }
      if (action === "set_password") {
        const { user_id, password } = body ?? {};
        if (typeof user_id !== "string") return json({ error: "bad request" }, 400);
        if (typeof password !== "string" || password.length < 8) {
          return json({ error: "Password must be at least 8 characters." }, 400);
        }
        const { error: pwErr } = await admin.auth.admin.updateUserById(user_id, { password });
        if (pwErr) return json({ error: pwErr.message }, 500);
        await audit("set_password", user_id, await emailOf(user_id), { password_changed: true });
        return json({ ok: true });
      }

      if (action === "set_user") {
        const { user_id, is_user } = body ?? {};
        if (typeof user_id !== "string" || typeof is_user !== "boolean") return json({ error: "bad request" }, 400);
        if (user_id === userData.user.id) {
          return json({ error: "You cannot change access for your own account." }, 400);
        }
        if (is_user) {
          const { error } = await admin.from("user_roles")
            .upsert([{ user_id, role: "user" }], { onConflict: "user_id,role", ignoreDuplicates: true });
          if (error) return json({ error: error.message }, 500);
        } else {
          const { error } = await admin.from("user_roles").delete()
            .eq("user_id", user_id).in("role", ["user", "admin"]);
          if (error) return json({ error: error.message }, 500);
        }
        await audit("set_user", user_id, await emailOf(user_id), { is_user });
        return json({ ok: true });
      }

      const { user_id, is_admin } = body ?? {};
      if (action !== "set_admin" || typeof user_id !== "string") {
        return json({ error: "bad request" }, 400);
      }
      // Prevent an admin from removing their own admin role (avoids lockout).
      if (user_id === userData.user.id && is_admin === false) {
        return json({ error: "You cannot remove your own admin role." }, 400);
      }
      if (is_admin) {
        const { error } = await admin
          .from("user_roles")
          .upsert([
            { user_id, role: "user" },
            { user_id, role: "admin" },
          ], { onConflict: "user_id,role", ignoreDuplicates: true });
        if (error) return json({ error: error.message }, 500);
      } else {
        const { error } = await admin
          .from("user_roles")
          .delete()
          .eq("user_id", user_id)
          .eq("role", "admin");
        if (error) return json({ error: error.message }, 500);
      }
      await audit("set_admin", user_id, await emailOf(user_id), { is_admin: !!is_admin });
      return json({ ok: true });
    }


    // GET: list users
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) return json({ error: listErr.message }, 500);

    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("user_id, role");
    if (rolesErr) return json({ error: rolesErr.message }, 500);

    const roleMap = new Map<string, Set<string>>();
    for (const r of roles ?? []) {
      if (!roleMap.has(r.user_id)) roleMap.set(r.user_id, new Set());
      roleMap.get(r.user_id)!.add(r.role);
    }

    const users = (list.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      is_admin: roleMap.get(u.id)?.has("admin") ?? false,
      is_user: roleMap.get(u.id)?.has("user") ?? false,
    }));

    return json({ users });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
