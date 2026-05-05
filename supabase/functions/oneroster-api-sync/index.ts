// ==========================================================================
// HPA -- OneRoster v1.2 REST API sync  (Supabase Edge Function)
// ==========================================================================
// Dashboard-editor safe version: single quotes only, pure ASCII.
// Deployed name: oneroster-api-sync
// ==========================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return json(405, { error: 'method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: 'edge function missing SUPABASE_URL / SERVICE_ROLE_KEY env' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const authHeader = req.headers.get('authorization') || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerToken) return json(401, { error: 'missing bearer token' });

  let actorEmail: string | null = null;
  let actorIsCron = false;

  if (callerToken === SERVICE_ROLE) {
    actorIsCron = true;
  } else {
    const { data: userData, error: userErr } = await admin.auth.getUser(callerToken);
    if (userErr || !userData?.user) return json(401, { error: 'invalid token' });
    actorEmail = userData.user.email ?? null;
    const { data: profile } = await admin
      .from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
    if (profile?.role !== 'super_admin') {
      return json(403, { error: 'only super_admin can run manual sync' });
    }
  }

  const { data: secretRows, error: secErr } = await admin
    .rpc('secrets_read_for_service', { p_category: 'oneroster_api' });
  if (secErr) return json(500, { error: `secrets_read_for_service: ${secErr.message}` });

  const secretMap = new Map<string, string>();
  for (const row of (secretRows ?? []) as Array<{ name: string; value: string }>) {
    secretMap.set(row.name, row.value);
  }
  const clientId     = secretMap.get('oneroster_api_client_id');
  const clientSecret = secretMap.get('oneroster_api_client_secret');
  const tokenUrl     = secretMap.get('oneroster_api_token_url');
  // Preserve query string (e.g. ?appName=hpa) — only strip trailing slashes on the path
  const rawBaseUrl   = secretMap.get('oneroster_api_base_url') || '';
  const baseUrl      = rawBaseUrl.includes('?')
    ? rawBaseUrl
    : rawBaseUrl.replace(/\/+$/, '');

  if (!clientId || !clientSecret || !tokenUrl || !baseUrl) {
    const runId = await recordSyncRun(admin, {
      status: 'failed',
      source: actorIsCron ? 'cron' : 'manual',
      actorEmail, error: 'OneRoster API credentials not configured',
      row_counts: {}, details: {},
    });
    return json(400, { run_id: runId, error: 'OneRoster API credentials not configured' });
  }

  const startedAt = new Date().toISOString();
  let row_counts: Record<string, number> = {};
  try {
    const accessToken = await fetchAccessToken(tokenUrl, clientId, clientSecret);
    const data = await fetchAll(baseUrl, accessToken);
    const mapped = mapOneRosterToOperational(data);
    const { staffAdded } = await upsertMapped(admin, mapped);

    row_counts = mapped.counts;
    if (staffAdded) row_counts.staff_added = staffAdded;
    const warnings: string[] = [];
    if (!row_counts.orgs)  warnings.push('no orgs returned');
    if (!row_counts.users) warnings.push('no users returned');

    const runId = await recordSyncRun(admin, {
      status: warnings.length ? 'partial' : 'success',
      source: actorIsCron ? 'cron' : 'manual',
      actorEmail,
      error: warnings.length ? warnings.join('; ') : null,
      row_counts,
      details: { started_at: startedAt, base_url: baseUrl, sample_urls: sampleUrls(baseUrl) },
    });

    return json(200, {
      ok: true, run_id: runId, status: warnings.length ? 'partial' : 'success',
      row_counts, warnings,
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    const runId = await recordSyncRun(admin, {
      status: 'failed',
      source: actorIsCron ? 'cron' : 'manual',
      actorEmail, error: msg,
      row_counts,
      details: { started_at: startedAt, base_url: baseUrl },
    });
    return json(500, { ok: false, run_id: runId, error: msg });
  }
});

// --------------------------------------------------------------------------
// OAuth: client_credentials grant
// --------------------------------------------------------------------------
async function fetchAccessToken(tokenUrl: string, clientId: string, clientSecret: string) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://purl.imsglobal.org/spec/or/v1p2/scope/roster-core.readonly ' +
           'https://purl.imsglobal.org/spec/or/v1p2/scope/roster.readonly',
  });
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token endpoint ${resp.status}: ${text.slice(0, 300)}`);
  }
  const j = await resp.json();
  if (!j.access_token) throw new Error('Token endpoint returned no access_token');
  return j.access_token as string;
}

// --------------------------------------------------------------------------
// Paginated GET
// --------------------------------------------------------------------------
const PAGE_LIMIT = 5000;
const COLLECTIONS = [
  { key: 'orgs',              path: '/orgs' },
  { key: 'academicSessions',  path: '/academicSessions' },
  { key: 'courses',           path: '/courses' },
  { key: 'classes',           path: '/classes' },
  { key: 'users',             path: '/users' },
  { key: 'enrollments',       path: '/enrollments' },
  { key: 'demographics',      path: '/demographics' },
] as const;

async function fetchCollection(baseUrl: string, path: string, token: string) {
  const out: any[] = [];
  let offset = 0;
  // Preserve any query string the user included in the Base URL (e.g. ?appName=hpa)
  const [baseRoot, baseQuery = ''] = baseUrl.split('?');
  const basePathRooted = baseRoot.replace(/\/+$/, '');
  for (;;) {
    const u = new URL(basePathRooted + path);
    if (baseQuery) {
      for (const [k, v] of new URLSearchParams(baseQuery)) {
        u.searchParams.set(k, v);
      }
    }
    u.searchParams.set('limit',  String(PAGE_LIMIT));
    u.searchParams.set('offset', String(offset));
    const resp = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      if (resp.status === 404) return out;
      const text = await resp.text();
      throw new Error(`GET ${path} ${resp.status}: ${text.slice(0, 300)}`);
    }
    const body = await resp.json();
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

// --------------------------------------------------------------------------
// Mapping
// --------------------------------------------------------------------------
function mapOneRosterToOperational(d: Record<string, any[]>) {
  const counts = { orgs: 0, sessions: 0, courses: 0, classes: 0, users: 0, students: 0, teachers: 0, enrollments: 0, demographics: 0 };

  const campuses = (d.orgs ?? []).filter(o => {
    const t = String(o.type || o.orgType || '').toLowerCase();
    return t === 'school' || t === '' || t.includes('school');
  }).map(o => ({
    oneroster_org_sourced_id: o.sourcedId,
    name: o.name,
    code: o.identifier || (o.name ? o.name.replace(/[^A-Z0-9]+/gi, '').slice(0, 6).toUpperCase() : ''),
    is_active: (o.status || 'active').toLowerCase() === 'active',
  }));
  counts.orgs = (d.orgs ?? []).length;

  const school_years: any[] = [];
  const terms: any[] = [];
  for (const s of (d.academicSessions ?? [])) {
    const type = String(s.type || '').toLowerCase();
    if (type === 'schoolyear' || type === 'school_year') {
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
    is_active: (c.status || 'active').toLowerCase() === 'active',
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
    // Item 1: Only pull active users
    const userStatus = String(u.status || 'active').toLowerCase();
    if (userStatus !== 'active') continue;

    const roles = Array.isArray(u.roles) ? u.roles : [];
    const roleStrs = roles.length
      ? roles.map((r: any) => String(r.role || r).toLowerCase())
      : [String(u.role || '').toLowerCase()];

    // Each OneRoster user role carries its own `org.sourcedId`. Take the
    // first org from any role, falling back to primaryOrg / orgs[0].
    const orgFromRole = roles.find((r: any) => r?.org?.sourcedId)?.org?.sourcedId;
    const primaryOrgSourcedId =
         orgFromRole
      || (Array.isArray(u.primaryOrg) ? u.primaryOrg[0]?.sourcedId : u.primaryOrg?.sourcedId)
      || u.primaryOrgSourcedId
      || (Array.isArray(u.orgs) ? u.orgs[0]?.sourcedId : null)
      || null;

    if (roleStrs.some(r => r === 'student')) {
      students.push({
        oneroster_user_sourced_id: u.sourcedId,
        student_id: u.identifier || u.username || u.sourcedId,
        first_name: u.givenName, last_name: u.familyName,
        email: u.email, grade_level: parseInt(u.grades || u.grade || '9', 10) || null,
        primary_org_sourced_id: primaryOrgSourcedId,  // temp, resolved to campus_id after campus upsert
        is_active: (u.status || 'active').toLowerCase() === 'active',
      });
    } else if (roleStrs.some(r => r === 'teacher' || r === 'aide')) {
      teachers.push({
        oneroster_user_sourced_id: u.sourcedId,
        first_name: u.givenName, last_name: u.familyName, email: u.email,
        primary_org_sourced_id: primaryOrgSourcedId,  // temp, same as above
        is_active: (u.status || 'active').toLowerCase() === 'active',
      });
    }
  }
  counts.users = (d.users ?? []).length;
  counts.students = students.length;
  counts.teachers = teachers.length;

  const student_enrollments: any[] = [];
  const teacher_class_assignments: any[] = [];
  for (const e of (d.enrollments ?? [])) {
    const role = String(e.role || '').toLowerCase();
    if (role === 'student') {
      student_enrollments.push({
        oneroster_enrollment_sourced_id: e.sourcedId,
        status: (e.status || 'active').toLowerCase(),
      });
    } else if (role === 'teacher' || role === 'aide') {
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

// --------------------------------------------------------------------------
// Upsert
// --------------------------------------------------------------------------
async function upsertMapped(admin: any, mapped: { records: Record<string, any[]> }) {
  const r = mapped.records;

  // 1) Campuses first
  if (r.campuses?.length) {
    const { error } = await admin.from('campuses')
      .upsert(r.campuses, { onConflict: 'oneroster_org_sourced_id', ignoreDuplicates: false });
    if (error) throw new Error(`campuses upsert failed: ${error.message}`);
  }

  // 2) Build sourcedId -> uuid map for campuses so we can resolve users' campus_id
  const campusMap = new Map<string, string>();
  if (r.campuses?.length) {
    const { data, error } = await admin.from('campuses')
      .select('id, oneroster_org_sourced_id')
      .in('oneroster_org_sourced_id', r.campuses.map((c: any) => c.oneroster_org_sourced_id));
    if (error) throw new Error(`campus lookup failed: ${error.message}`);
    for (const row of (data ?? [])) campusMap.set(row.oneroster_org_sourced_id, row.id);
  }

  // Attach campus_id to teachers/students, then strip temp field
  for (const t of r.teachers ?? []) {
    if (t.primary_org_sourced_id && campusMap.has(t.primary_org_sourced_id)) {
      t.campus_id = campusMap.get(t.primary_org_sourced_id);
    }
    delete t.primary_org_sourced_id;
  }
  for (const s of r.students ?? []) {
    if (s.primary_org_sourced_id && campusMap.has(s.primary_org_sourced_id)) {
      s.campus_id = campusMap.get(s.primary_org_sourced_id);
    }
    delete s.primary_org_sourced_id;
  }

  // 3) Remaining tables in dependency order
  const batches: [string, any[], string][] = [
    ['school_years',             r.school_years,             'oneroster_academic_session_sourced_id'],
    ['terms',                    r.terms,                    'oneroster_academic_session_sourced_id'],
    ['courses',                  r.courses,                  'oneroster_course_sourced_id'],
    ['course_sections',          r.course_sections,          'oneroster_class_sourced_id'],
    ['teachers',                 r.teachers,                 'oneroster_user_sourced_id'],
    ['students',                 r.students,                 'oneroster_user_sourced_id'],
    ['student_enrollments',      r.student_enrollments,      'oneroster_enrollment_sourced_id'],
    ['teacher_class_assignments',r.teacher_class_assignments,'oneroster_enrollment_sourced_id'],
  ];
  for (const [table, rows, conflict] of batches) {
    if (!rows?.length) continue;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await admin.from(table)
        .upsert(rows.slice(i, i + CHUNK), { onConflict: conflict, ignoreDuplicates: false });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    }
  }

  // 4) Auto-populate staff_whitelist from teachers with emails. This lets them
  //    sign in via Microsoft SSO immediately. We only insert rows that don't
  //    already exist (ON CONFLICT DO NOTHING) so manual role upgrades are safe.
  const teachersWithEmail = (r.teachers ?? []).filter((t: any) => t.email && t.is_active);
  let staffAdded = 0;
  if (teachersWithEmail.length) {
    // Look up internal teacher_id for each oneroster_user_sourced_id so the
    // whitelist row can deep-link.
    const { data: tRows, error: tErr } = await admin.from('teachers')
      .select('id, oneroster_user_sourced_id, email, campus_id')
      .in('oneroster_user_sourced_id', teachersWithEmail.map((t: any) => t.oneroster_user_sourced_id));
    if (tErr) throw new Error(`teacher id lookup failed: ${tErr.message}`);
    const teacherByOr = new Map<string, any>();
    for (const tr of tRows ?? []) teacherByOr.set(tr.oneroster_user_sourced_id, tr);

    const whitelistRows = teachersWithEmail
      .map((t: any) => {
        const dbTeacher = teacherByOr.get(t.oneroster_user_sourced_id);
        if (!dbTeacher || !dbTeacher.email) return null;
        return {
          email: dbTeacher.email.toLowerCase(),
          role: 'teacher',
          campus_id: dbTeacher.campus_id ?? null,
          teacher_id: dbTeacher.id,
          tenant_hint: 'oneroster_auto',
        };
      })
      .filter(Boolean) as any[];

    if (whitelistRows.length) {
      // Filter out emails that already exist in the whitelist (case-insensitive)
      // so we never overwrite a manual role upgrade (e.g. teacher → campus_admin).
      const candidateEmails = whitelistRows.map(w => w.email);
      const { data: existing, error: exErr } = await admin.from('staff_whitelist')
        .select('email').in('email', candidateEmails);
      if (exErr) throw new Error(`staff_whitelist lookup failed: ${exErr.message}`);
      const existingSet = new Set((existing ?? []).map((e: any) => e.email.toLowerCase()));
      const newRows = whitelistRows.filter(w => !existingSet.has(w.email));

      if (newRows.length) {
        const CHUNK = 500;
        for (let i = 0; i < newRows.length; i += CHUNK) {
          const { error } = await admin.from('staff_whitelist')
            .insert(newRows.slice(i, i + CHUNK));
          if (error) throw new Error(`staff_whitelist insert failed: ${error.message}`);
        }
        staffAdded = newRows.length;
      }
    }
  }
  return { staffAdded };
}

// --------------------------------------------------------------------------
// Record a sync run
// --------------------------------------------------------------------------
async function recordSyncRun(admin: any, p: {
  status: string; source: string; actorEmail: string | null;
  error: string | null; row_counts: Record<string, number>;
  details: Record<string, any>;
}) {
  const { data, error } = await admin.rpc('record_sync_run', {
    p_category: 'oneroster_api',
    p_source: p.source,
    p_status: p.status,
    p_row_counts: p.row_counts,
    p_error_message: p.error,
    p_details: { ...p.details, actor_email: p.actorEmail },
    p_started_at: null,
  });
  if (error) console.error('record_sync_run failed:', error);
  return data ?? null;
}

// Build the first full URL for each collection — useful in sync_runs.details
// to debug empty responses.
function sampleUrls(baseUrl: string): string[] {
  const [baseRoot, baseQuery = ''] = baseUrl.split('?');
  const basePathRooted = baseRoot.replace(/\/+$/, '');
  return COLLECTIONS.slice(0, 3).map(c => {
    const u = new URL(basePathRooted + c.path);
    if (baseQuery) {
      for (const [k, v] of new URLSearchParams(baseQuery)) {
        u.searchParams.set(k, v);
      }
    }
    u.searchParams.set('limit', '5000');
    u.searchParams.set('offset', '0');
    return u.toString();
  });
}
