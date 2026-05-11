// =============================================================================
// HPA -- set-staff-password
// =============================================================================
// Lets a super admin (or district admin) set a non-SSO sign-in password for a
// staff user, without an email round-trip. The caller's JWT is verified
// against `profiles` to enforce role. The service_role key is used server-side
// to either create a brand-new auth.users entry (if the email never signed in
// before) or update the password of an existing one.
//
// Request body:
//   { email: string, password: string }
//
// Response:
//   { ok: true, user_id: uuid, action: "created" | "updated" }
//
// Deploy:
//   supabase functions deploy set-staff-password
//   (and ensure SUPABASE_SERVICE_ROLE_KEY is set in the function's secrets;
//    Supabase usually auto-injects it.)
// =============================================================================

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: "Function not configured (missing service role)" }, 500);
  }

  // 1) Verify the caller is signed-in staff with admin privileges.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }
  const userJwt = authHeader.slice(7);
  const supaUser = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
  const { data: userInfo, error: whoErr } = await supaUser.auth.getUser(userJwt);
  if (whoErr || !userInfo?.user) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }
  const callerEmail = userInfo.user.email || "";

  // Service-role client for privileged operations.
  const supaAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // Lookup caller's role via profiles -> must be super_admin or district_admin.
  const { data: callerProfile } = await supaAdmin
    .from("profiles")
    .select("role")
    .eq("id", userInfo.user.id)
    .maybeSingle();
  const callerRole = callerProfile?.role || "";
  if (!["super_admin", "district_admin"].includes(callerRole)) {
    return jsonResponse({ error: "Not authorized" }, 403);
  }

  // 2) Parse and validate body.
  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Valid email required" }, 400);
  }
  if (password.length < 8) {
    return jsonResponse({ error: "Password must be at least 8 characters" }, 400);
  }

  // 3) Enforce: the target email must already be on the staff whitelist.
  // This is the gate that prevents an admin from creating random accounts.
  const { data: wlRow } = await supaAdmin
    .from("staff_whitelist")
    .select("email, role")
    .eq("email", email)
    .maybeSingle();
  if (!wlRow) {
    return jsonResponse(
      { error: "Email is not on the staff access list. Add them first." },
      400,
    );
  }

  // 4) See if the auth user exists; if so update password, else invite-style create.
  //
  // supabase-js v2 doesn't have a direct getUserByEmail, so we list users
  // with a filter (1000 max per page is fine for the foreseeable user count).
  const { data: list, error: listErr } = await supaAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) return jsonResponse({ error: "Couldn't query users: " + listErr.message }, 500);
  const existing = list?.users?.find((u: any) => (u.email || "").toLowerCase() === email);

  let userId: string;
  let action: "created" | "updated";
  if (existing) {
    const { error: updErr } = await supaAdmin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (updErr) return jsonResponse({ error: "Update failed: " + updErr.message }, 500);
    userId = existing.id;
    action = "updated";
  } else {
    const { data: created, error: createErr } = await supaAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) return jsonResponse({ error: "Create failed: " + createErr.message }, 500);
    userId = created.user.id;
    action = "created";
  }

  // 5) Audit log (uses the database). Best-effort -- don't block on failure.
  try {
    await supaAdmin.from("audit_logs").insert({
      actor_email: callerEmail,
      action: "auth.password.set",
      target: email,
      details: { result: action },
    });
  } catch (_e) { /* noop */ }

  return jsonResponse({ ok: true, user_id: userId, action });
});
