// =============================================================================
// HPA — OneRoster v1.2 REST API sync  (Supabase Edge Function)
// =============================================================================
// Fetches orgs, academicSessions, courses, classes, users, enrollments from
// the Infinite Campus OneRoster REST API using OAuth 2.0 client_credentials,
// then upserts rows into the operational tables. Writes a sync_runs row on
// success or failure. Can be invoked:
//
//   1. Manually from the admin UI (POST /functions/v1/oneroster-api-sync
//      with the user's JWT — service role is checked via secret read).
//   2. By pg_cron via cron_trigger_oneroster_sync() using the stored
//      service-role key (see /app/supabase/oneroster_api_cron.sql).
//
// NEVER returns secret values to the caller; only row counts + status.
// =============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ORIGIN_ALLOW = "*"; // locked down via service-role key check below
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ORIGIN_ALLOW,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST")    return json(405, { error: "method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: "edge function missing SUPABASE_URL / SERVICE_ROLE_KEY env" });
  }

  // Admin client (bypasses RLS) — used for secret reads and upserts.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---------- auth: is the caller allowed? --------------------------------
  // Two accepted callers:
  //   a) pg_cron — uses the service role JWT (Supabase sends role=service_role)
  //   b) super_admin in the UI — we re-check their profiles.role here.
  const authHeader = req.headers.get("authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return json(401, { error: "missing bearer token" });

  let actorEmail: string | null = null;
  let actorIsCron = false;
  let actorIsSuper = false;

  if (callerToken === SERVICE_ROLE) {
    actorIsCron = true;
  } else {
    const { data: userData, error: userErr } = await admin.auth.getUser(callerToken);
    if (userErr || !userData?.user) return json(401, { error: "invalid token" });
    actorEmail = userData.user.email ?? null;
    const { data: profile } = await admin
      .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (profile?.role !== "super_admin") {
      return json(403, { error: "only super_admin can run manual sync" });
    }
    actorIsSuper = true;
  }

  // ---------- load secrets -----------------------------------------------
  const { data: secretRows, error: secErr } = await admin
    .rpc("secrets_read_for_service", { p_category: "oneroster_api" });
  if (secErr) return json(500, { error: `secrets_read_for_service: ${secErr.message}` });

  const secretMap = new Map<string, string>();
  for (const row of (secretRows ?? []) as Array<{ name: string; value: string }>) {
    secretMap.set(row.name, row.value);
  }
  const clientId     = secretMap.get("oneroster_api_client_id");
  const clientSecret = secretMap.get("oneroster_api_client_secret");
  const tokenUrl     = secretMap.get("oneroster_api_token_url");
  const baseUrl      = (secretMap.get("oneroster_api_base_url") || "").replace(/\/+$/, "");

  if (!clientId || !clientSecret || !tokenUrl || !baseUrl) {
    const runId = await recordSyncRun(admin, {
      status: "failed",
      source: actorIsCron ? "cron" : "manual",
      actorEmail, error: "OneRoster API credentials not configured",
      row_counts: {}, details: {},
    });
    return json(400, { run_id: runId, error: "OneRoster API credentials not configured" });
  }

  // ---------- run ---------------------------------------------------------
  const startedAt = new Date().toISOString();
  let row_counts: Record<string, number> = {};
  try {
    const accessToken = await fetchAccessToken(tokenUrl, clientId, clientSecret);
    const data = await fetchAll(baseUrl, accessToken);
    const mapped = mapOneRosterToOperational(data);
    await upsertMapped(admin, mapped);

    row_counts = mapped.counts;
    const warnings: string[] = [];
    if (!row_counts.orgs)     warnings.push("no orgs returned");
    if (!row_counts.users)    warnings.push("no users returned");

    const runId = await recordSyncRun(admin, {
      status: warnings.length ? "partial" : "success",
      source: actorIsCron ? "cron" : "manual",
      actorEmail,
      error: warnings.length ? warnings.join("; ") : null,
      row_counts,
      details: { started_at: startedAt, base_url: baseUrl },
    });

    return json(200, {
      ok: true, run_id: runId, status: warnings.length ? "partial" : "success",
      row_counts, warnings,
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    const runId = await recordSyncRun(admin, {
      status: "failed",
      source: actorIsCron ? "cron" : "manual",
      actorEmail, error: msg,
      row_counts,
      details: { started_at: startedAt, base_url: baseUrl },
    });
    return json(500, { ok: false, run_id: runId, error: msg });
  }
});

// ---------------------------------------------------------------------------
// OAuth: client_credentials grant
// ---------------------------------------------------------------------------
async function fetchAccessToken(tokenUrl: string, clientId: string, clientSecret: string) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly " +
           "https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly",
  });
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token endpoint ${resp.status}: ${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  if (!json.access_token) throw new Error("Token endpoint returned no access_token");
  return json.access_token as string;
}

// ---------------------------------------------------------------------------
// Paginated GET for each OneRoster collection
// ---------------------------------------------------------------------------
const PAGE_LIMIT = 5000;
const COLLECTIONS = [
  { key: "orgs",              path: "/orgs" },
  { key: "academicSessions",  path: "/academicSessions" },
  { key: "courses",           path: "/courses" },
  { key: "classes",           path: "/classes" },
  { key: "users",             path: "/users" },
  { key: "enrollments",       path: "/enrollments" },
  { key: "demographics",      path: "/demographics" },
] as const;

async function fetchCollection(baseUrl: string, path: string, token: string) {
  const out: any[] = [];
  let offset = 0;
  for (;;) {
    const u = new URL(baseUrl + path);
    u.searchParams.set("limit",  String(PAGE_LIMIT));
    u.searchParams.set("offset", String(offset));
    const resp = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      if (resp.status === 404) return out; // endpoint not implemented on this tenant
      const text = await resp.text();
      throw new Error(`GET ${path} ${resp.status}: ${text.slice(0, 300)}`);
    }
    const body = await resp.json();
    // OneRoster wraps the list in a key derived from the endpoint name.
    const listKey = Object.keys(body).find(k => Array.isArray(body[k]));
    const page: any[] = listKey ? body[listKey] : [];
    out.push(...page);
    if (page.length < PAGE_LIMIT) break;
    offset += page.length;
  }
  return out;
}

async function fetchAll(baseUrl: string, token: string) {
  const data: Record<string, any[]> = {};
  for (const c of COLLECTIONS) {
    data[c.key] = await fetchCollection(baseUrl, c.path, token);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Mapping: OneRoster JSON objects → operational table rows
// (Same shape as /app/frontend/src/lib/oneroster.js, adapted for JSON input.)
// ---------------------------------------------------------------------------
function mapOneRosterToOperational(d: Record<string, any[]>) {
  const counts = { orgs: 0, sessions: 0, courses: 0, classes: 0, users: 0, students: 0, teachers: 0, enrollments: 0, demographics: 0 };

  const campuses = (d.orgs ?? []).filter(o => {
    const t = String(o.type || o.orgType || "").toLowerCase();
    return t === "school" || t === "" || t.includes("school");
  }).map(o => ({
    oneroster_org_sourced_id: o.sourcedId,
    name: o.name,
    code: o.identifier || (o.name ? o.name.replace(/[^A-Z0-9]+/gi, "").slice(0, 6).toUpperCase() : ""),
    is_active: (o.status || "active").toLowerCase() === "active",
  }));
  counts.orgs = (d.orgs ?? []).length;

  const school_years: any[] = [];
  const terms: any[] = [];
  for (const s of (d.academicSessions ?? [])) {
    const type = String(s.type || "").toLowerCase();
    if (type === "schoolyear" || type === "school_year") {
      school_years.push({
        oneroster_academic_session_sourced_id: s.sourcedId,
        name: s.title || s.name || s.sourcedId,
        start_date: s.startDate, end_date: s.endDate, is_active: true,
      });
    } else {
      terms.push({
        oneroster_academic_session_sourced_id: s.sourcedId,
        name: s.title || s.name || s.sourcedId,
        start_date: s.startDate, end_date: s.endDate,
      });
    }
  }
  counts.sessions = (d.academicSessions ?? []).length;

  const courses = (d.courses ?? []).map(c => ({
    oneroster_course_sourced_id: c.sourcedId,
    code: c.courseCode || c.identifier || c.sourcedId,
    title: c.title,
    is_active: (c.status || "active").toLowerCase() === "active",
  }));
  counts.courses = courses.length;

  const course_sections = (d.classes ?? []).map(cl => ({
    oneroster_class_sourced_id: cl.sourcedId,
    section_code: cl.classCode || cl.title || cl.sourcedId,
  }));
  counts.classes = course_sections.length;

  const students: any[] = [];
  const teachers: any[] = [];
  for (const u of (d.users ?? [])) {
    const roles = Array.isArray(u.roles)
      ? u.roles.map((r: any) => String(r.role || r).toLowerCase())
      : [String(u.role || "").toLowerCase()];
    const campusId = (Array.isArray(u.primaryOrg) ? u.primaryOrg[0]?.sourcedId : u.primaryOrgSourcedId)
                   || (Array.isArray(u.orgs) ? u.orgs[0]?.sourcedId : null);

    if (roles.some(r => r === "student")) {
      students.push({
        oneroster_user_sourced_id: u.sourcedId,
        student_id: u.identifier || u.username || u.sourcedId,
        first_name: u.givenName, last_name: u.familyName,
        email: u.email, grade_level: parseInt(u.grades || u.grade || "9", 10) || null,
        is_active: (u.status || "active").toLowerCase() === "active",
      });
    } else if (roles.some(r => r === "teacher" || r === "aide")) {
      teachers.push({
        oneroster_user_sourced_id: u.sourcedId,
        first_name: u.givenName, last_name: u.familyName, email: u.email,
        is_active: (u.status || "active").toLowerCase() === "active",
      });
    }
  }
  counts.users = (d.users ?? []).length;
  counts.students = students.length;
  counts.teachers = teachers.length;

  const student_enrollments: any[] = [];
  const teacher_class_assignments: any[] = [];
  for (const e of (d.enrollments ?? [])) {
    const role = String(e.role || "").toLowerCase();
    if (role === "student") {
      student_enrollments.push({
        oneroster_enrollment_sourced_id: e.sourcedId,
        status: (e.status || "active").toLowerCase(),
      });
    } else if (role === "teacher" || role === "aide") {
      teacher_class_assignments.push({
        oneroster_enrollment_sourced_id: e.sourcedId,
      });
    }
  }
  counts.enrollments = (d.enrollments ?? []).length;
  counts.demographics = (d.demographics ?? []).length;

  return {
    records: { campuses, school_years, terms, courses, course_sections, students, teachers, student_enrollments, teacher_class_assignments },
    counts,
  };
}

// ---------------------------------------------------------------------------
// Upsert with full-refresh semantics (match by sourcedId). We skip heavy
// relational joins here — Edge Function only loads the roster. Relationship
// patching (student→campus, enrollment→class) is handled in a follow-up
// cleanup query.
// ---------------------------------------------------------------------------
async function upsertMapped(admin: any, mapped: { records: Record<string, any[]> }) {
  const r = mapped.records;
  const batches: [string, any[], string][] = [
    ["campuses",                 r.campuses,                 "oneroster_org_sourced_id"],
    ["school_years",             r.school_years,             "oneroster_academic_session_sourced_id"],
    ["terms",                    r.terms,                    "oneroster_academic_session_sourced_id"],
    ["courses",                  r.courses,                  "oneroster_course_sourced_id"],
    ["course_sections",          r.course_sections,          "oneroster_class_sourced_id"],
    ["teachers",                 r.teachers,                 "oneroster_user_sourced_id"],
    ["students",                 r.students,                 "oneroster_user_sourced_id"],
    ["student_enrollments",      r.student_enrollments,      "oneroster_enrollment_sourced_id"],
    ["teacher_class_assignments",r.teacher_class_assignments,"oneroster_enrollment_sourced_id"],
  ];
  for (const [table, rows, conflict] of batches) {
    if (!rows?.length) continue;
    // Supabase limits a single upsert to ~1000 rows; chunk defensively.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await admin.from(table)
        .upsert(rows.slice(i, i + CHUNK), { onConflict: conflict, ignoreDuplicates: false });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Record a sync run. Calls the SQL RPC so the RLS policy is honoured.
// ---------------------------------------------------------------------------
async function recordSyncRun(admin: any, p: {
  status: string; source: string; actorEmail: string | null;
  error: string | null; row_counts: Record<string, number>;
  details: Record<string, any>;
}) {
  const { data, error } = await admin.rpc("record_sync_run", {
    p_category: "oneroster_api",
    p_source: p.source,
    p_status: p.status,
    p_row_counts: p.row_counts,
    p_error_message: p.error,
    p_details: { ...p.details, actor_email: p.actorEmail },
    p_started_at: null,
  });
  if (error) console.error("record_sync_run failed:", error);
  return data ?? null;
}
