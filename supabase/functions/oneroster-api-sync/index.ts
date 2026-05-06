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
    const { staffAdded, droppedStudentEnrollments, droppedTeacherAssignments } = await upsertMapped(admin, mapped);

    row_counts = mapped.counts;
    if (staffAdded) row_counts.whitelist_added = staffAdded;
    if (droppedStudentEnrollments) row_counts.dropped_student_enrollments = droppedStudentEnrollments;
    if (droppedTeacherAssignments) row_counts.dropped_teacher_assignments = droppedTeacherAssignments;
    const warnings: string[] = [];
    if (!row_counts.orgs)  warnings.push('no orgs returned');
    if (!row_counts.users) warnings.push('no users returned');
    if (droppedStudentEnrollments) warnings.push(`${droppedStudentEnrollments} student enrollments not linked (missing student or section)`);
    if (droppedTeacherAssignments) warnings.push(`${droppedTeacherAssignments} teacher assignments not linked`);

    const runId = await recordSyncRun(admin, {
      status: warnings.length ? 'partial' : 'success',
      source: actorIsCron ? 'cron' : 'manual',
      actorEmail,
      error: warnings.length ? warnings.join('; ') : null,
      row_counts,
      details: {
        started_at: startedAt, base_url: baseUrl,
        sample_urls: sampleUrls(baseUrl),
        role_breakdown: mapped.roleStats || {},
      },
    });

    return json(200, {
      ok: true, run_id: runId, status: warnings.length ? 'partial' : 'success',
      row_counts, warnings, role_breakdown: mapped.roleStats || {},
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
  const counts = { orgs: 0, sessions: 0, courses: 0, classes: 0, users: 0, students: 0, teachers: 0, staff: 0, enrollments: 0, demographics: 0 };

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

  // course_sections need course_id and campus_id resolved AFTER upserts;
  // capture the OneRoster ref ids here as temp fields.
  const course_sections = (d.classes ?? []).map(cl => ({
    oneroster_class_sourced_id: cl.sourcedId,
    section_code: cl.classCode || cl.title || cl.sourcedId,
    is_active: (cl.status || 'active').toLowerCase() === 'active',
    _or_course_sid: cl.course?.sourcedId || null,
    _or_school_sid: cl.school?.sourcedId || (Array.isArray(cl.schools) ? cl.schools[0]?.sourcedId : null),
    _or_term_sid:   Array.isArray(cl.terms) ? cl.terms[0]?.sourcedId : (cl.term?.sourcedId || null),
  }));
  counts.classes = course_sections.length;

  const students: any[] = [];
  const teachers: any[] = [];
  const staff: any[] = [];
  const roleStats: Record<string, number> = {}; // diagnostic: primaryRole -> count
  for (const u of (d.users ?? [])) {
    // Item 1: Only pull active users
    const userStatus = String(u.status || 'active').toLowerCase();
    if (userStatus !== 'active') continue;

    const roles = Array.isArray(u.roles) ? u.roles : [];

    // Use the OneRoster `roleType=primary` role to bucket the user. Many
    // admin staff (principals, asst principals, academic coaches) ALSO carry
    // a secondary teaching role for backup coverage; they should still be
    // staff. Falls back to first role, then top-level user.role.
    const primaryEntry =
         roles.find((r: any) => String(r.roleType || '').toLowerCase() === 'primary')
      || roles[0]
      || null;
    const primaryRoleStr = primaryEntry
      ? String(primaryEntry.role || '').toLowerCase()
      : String(u.role || '').toLowerCase();

    roleStats[primaryRoleStr || '(none)'] = (roleStats[primaryRoleStr || '(none)'] || 0) + 1;

    // Pick org from primary role first; fall back to any role / primaryOrg.
    const orgFromPrimary = primaryEntry?.org?.sourcedId;
    const primaryOrgSourcedId =
         orgFromPrimary
      || roles.find((r: any) => r?.org?.sourcedId)?.org?.sourcedId
      || (Array.isArray(u.primaryOrg) ? u.primaryOrg[0]?.sourcedId : u.primaryOrg?.sourcedId)
      || u.primaryOrgSourcedId
      || (Array.isArray(u.orgs) ? u.orgs[0]?.sourcedId : null)
      || null;

    if (primaryRoleStr === 'student') {
      students.push({
        oneroster_user_sourced_id: u.sourcedId,
        student_id: u.identifier || u.username || u.sourcedId,
        first_name: u.givenName, last_name: u.familyName,
        email: u.email, grade_level: parseInt(u.grades || u.grade || '9', 10) || null,
        primary_org_sourced_id: primaryOrgSourcedId,
        is_active: true,
      });
    } else if (primaryRoleStr === 'teacher' || primaryRoleStr === 'aide') {
      teachers.push({
        oneroster_user_sourced_id: u.sourcedId,
        first_name: u.givenName, last_name: u.familyName, email: u.email,
        primary_org_sourced_id: primaryOrgSourcedId,
        is_active: true,
      });
    } else {
      const nonStaff = new Set(['parent', 'guardian', 'relative', '']);
      if (nonStaff.has(primaryRoleStr)) continue;

      staff.push({
        oneroster_user_sourced_id: u.sourcedId,
        first_name: u.givenName, last_name: u.familyName, email: u.email,
        primary_org_sourced_id: primaryOrgSourcedId,
        oneroster_role: primaryRoleStr,
        title: u.title || null,
        is_active: true,
      });
    }
  }
  counts.users = (d.users ?? []).length;
  counts.students = students.length;
  counts.teachers = teachers.length;
  counts.staff = staff.length;

  const student_enrollments: any[] = [];
  const teacher_class_assignments: any[] = [];
  for (const e of (d.enrollments ?? [])) {
    const role = String(e.role || '').toLowerCase();
    const userSid  = e.user?.sourcedId  || null;
    const classSid = e.class?.sourcedId || null;
    if (role === 'student') {
      student_enrollments.push({
        oneroster_enrollment_sourced_id: e.sourcedId,
        status: (e.status || 'active').toLowerCase(),
        _or_user_sid:  userSid,
        _or_class_sid: classSid,
      });
    } else if (role === 'teacher' || role === 'aide') {
      teacher_class_assignments.push({
        oneroster_enrollment_sourced_id: e.sourcedId,
        _or_user_sid:  userSid,
        _or_class_sid: classSid,
      });
    }
  }
  counts.enrollments = (d.enrollments ?? []).length;
  counts.demographics = (d.demographics ?? []).length;

  return {
    records: { campuses, school_years, terms, courses, course_sections, students, teachers, staff, student_enrollments, teacher_class_assignments },
    counts,
    roleStats,
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

  // Attach campus_id to teachers/students/staff, then strip temp field
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
  for (const st of r.staff ?? []) {
    if (st.primary_org_sourced_id && campusMap.has(st.primary_org_sourced_id)) {
      st.campus_id = campusMap.get(st.primary_org_sourced_id);
    }
    delete st.primary_org_sourced_id;
  }

  // 3) Resolve course_section FKs (course_id, campus_id, term_id) before upserting
  const termMap = new Map<string, string>();
  if (r.terms?.length) {
    const { data, error } = await admin.from('terms')
      .select('id, oneroster_academic_session_sourced_id')
      .in('oneroster_academic_session_sourced_id', r.terms.map((t: any) => t.oneroster_academic_session_sourced_id));
    if (error) throw new Error(`term lookup failed: ${error.message}`);
    for (const row of (data ?? [])) termMap.set(row.oneroster_academic_session_sourced_id, row.id);
  }
  // school_years + terms first
  for (const tbl of ['school_years', 'terms'] as const) {
    if (!r[tbl]?.length) continue;
    const { error } = await admin.from(tbl)
      .upsert(r[tbl], { onConflict: 'oneroster_academic_session_sourced_id', ignoreDuplicates: false });
    if (error) throw new Error(`${tbl} upsert failed: ${error.message}`);
  }
  // courses
  if (r.courses?.length) {
    const { error } = await admin.from('courses')
      .upsert(r.courses, { onConflict: 'oneroster_course_sourced_id', ignoreDuplicates: false });
    if (error) throw new Error(`courses upsert failed: ${error.message}`);
  }
  const courseMap = new Map<string, string>();
  if (r.courses?.length) {
    const { data, error } = await admin.from('courses')
      .select('id, oneroster_course_sourced_id')
      .in('oneroster_course_sourced_id', r.courses.map((c: any) => c.oneroster_course_sourced_id));
    if (error) throw new Error(`course lookup failed: ${error.message}`);
    for (const row of (data ?? [])) courseMap.set(row.oneroster_course_sourced_id, row.id);
  }
  // Re-fetch term map after upsert in case it was empty before
  if (r.terms?.length && termMap.size === 0) {
    const { data, error } = await admin.from('terms')
      .select('id, oneroster_academic_session_sourced_id')
      .in('oneroster_academic_session_sourced_id', r.terms.map((t: any) => t.oneroster_academic_session_sourced_id));
    if (error) throw new Error(`term lookup retry failed: ${error.message}`);
    for (const row of (data ?? [])) termMap.set(row.oneroster_academic_session_sourced_id, row.id);
  }

  // course_sections — resolve course_id, campus_id, term_id from temp fields
  for (const cs of r.course_sections ?? []) {
    if (cs._or_course_sid && courseMap.has(cs._or_course_sid)) cs.course_id = courseMap.get(cs._or_course_sid);
    if (cs._or_school_sid && campusMap.has(cs._or_school_sid)) cs.campus_id = campusMap.get(cs._or_school_sid);
    if (cs._or_term_sid   && termMap.has(cs._or_term_sid))     cs.term_id   = termMap.get(cs._or_term_sid);
    delete cs._or_course_sid; delete cs._or_school_sid; delete cs._or_term_sid;
  }
  if (r.course_sections?.length) {
    const CHUNK = 500;
    for (let i = 0; i < r.course_sections.length; i += CHUNK) {
      const { error } = await admin.from('course_sections')
        .upsert(r.course_sections.slice(i, i + CHUNK), { onConflict: 'oneroster_class_sourced_id', ignoreDuplicates: false });
      if (error) throw new Error(`course_sections upsert failed: ${error.message}`);
    }
  }

  // 4) Teachers / staff / students
  for (const [tbl, rows] of [
    ['teachers', r.teachers],
    ['staff',    r.staff],
    ['students', r.students],
  ] as const) {
    if (!rows?.length) continue;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await admin.from(tbl)
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'oneroster_user_sourced_id', ignoreDuplicates: false });
      if (error) throw new Error(`${tbl} upsert failed: ${error.message}`);
    }
  }

  // 5) Build user / section lookup maps for enrollments
  const sectionMap = new Map<string, string>();
  if (r.course_sections?.length) {
    const { data, error } = await admin.from('course_sections')
      .select('id, oneroster_class_sourced_id')
      .in('oneroster_class_sourced_id', r.course_sections.map((cs: any) => cs.oneroster_class_sourced_id));
    if (error) throw new Error(`section lookup failed: ${error.message}`);
    for (const row of (data ?? [])) sectionMap.set(row.oneroster_class_sourced_id, row.id);
  }
  const studentMap = new Map<string, string>();
  if (r.students?.length) {
    const { data, error } = await admin.from('students')
      .select('id, oneroster_user_sourced_id')
      .in('oneroster_user_sourced_id', r.students.map((s: any) => s.oneroster_user_sourced_id));
    if (error) throw new Error(`student lookup failed: ${error.message}`);
    for (const row of (data ?? [])) studentMap.set(row.oneroster_user_sourced_id, row.id);
  }
  const teacherMap = new Map<string, string>();
  if (r.teachers?.length) {
    const { data, error } = await admin.from('teachers')
      .select('id, oneroster_user_sourced_id')
      .in('oneroster_user_sourced_id', r.teachers.map((t: any) => t.oneroster_user_sourced_id));
    if (error) throw new Error(`teacher lookup failed: ${error.message}`);
    for (const row of (data ?? [])) teacherMap.set(row.oneroster_user_sourced_id, row.id);
  }

  // 6) Resolve and upsert enrollments
  let droppedStudentEnrollments = 0;
  let droppedTeacherAssignments = 0;
  const seStrong: any[] = [];
  for (const se of r.student_enrollments ?? []) {
    const sId = studentMap.get(se._or_user_sid);
    const cId = sectionMap.get(se._or_class_sid);
    delete se._or_user_sid; delete se._or_class_sid;
    if (!sId || !cId) { droppedStudentEnrollments++; continue; }
    se.student_id = sId; se.course_section_id = cId;
    seStrong.push(se);
  }
  if (seStrong.length) {
    const CHUNK = 500;
    for (let i = 0; i < seStrong.length; i += CHUNK) {
      const { error } = await admin.from('student_enrollments')
        .upsert(seStrong.slice(i, i + CHUNK), { onConflict: 'oneroster_enrollment_sourced_id', ignoreDuplicates: false });
      if (error) throw new Error(`student_enrollments upsert failed: ${error.message}`);
    }
  }

  const tcStrong: any[] = [];
  for (const ta of r.teacher_class_assignments ?? []) {
    const tId = teacherMap.get(ta._or_user_sid);
    const cId = sectionMap.get(ta._or_class_sid);
    delete ta._or_user_sid; delete ta._or_class_sid;
    if (!tId || !cId) { droppedTeacherAssignments++; continue; }
    ta.teacher_id = tId; ta.course_section_id = cId;
    tcStrong.push(ta);
  }
  if (tcStrong.length) {
    const CHUNK = 500;
    for (let i = 0; i < tcStrong.length; i += CHUNK) {
      const { error } = await admin.from('teacher_class_assignments')
        .upsert(tcStrong.slice(i, i + CHUNK), { onConflict: 'oneroster_enrollment_sourced_id', ignoreDuplicates: false });
      if (error) throw new Error(`teacher_class_assignments upsert failed: ${error.message}`);
    }
  }

  // 7) Auto-populate staff_whitelist for SSO. We only insert rows that
  //    don't already exist so manual role upgrades are preserved.
  let whitelistAdded = 0;

  // Teachers
  const teachersWithEmail = (r.teachers ?? []).filter((t: any) => t.email && t.is_active);
  let teacherWlRows: any[] = [];
  if (teachersWithEmail.length) {
    const { data: tRows, error: tErr } = await admin.from('teachers')
      .select('id, oneroster_user_sourced_id, email, campus_id')
      .in('oneroster_user_sourced_id', teachersWithEmail.map((t: any) => t.oneroster_user_sourced_id));
    if (tErr) throw new Error(`teacher id lookup failed: ${tErr.message}`);
    const teacherByOr = new Map<string, any>();
    for (const tr of tRows ?? []) teacherByOr.set(tr.oneroster_user_sourced_id, tr);

    teacherWlRows = teachersWithEmail
      .map((t: any) => {
        const dbT = teacherByOr.get(t.oneroster_user_sourced_id);
        if (!dbT?.email) return null;
        return {
          email: dbT.email.toLowerCase(),
          role: 'teacher',
          campus_id: dbT.campus_id ?? null,
          teacher_id: dbT.id,
          tenant_hint: 'oneroster_auto',
        };
      })
      .filter(Boolean) as any[];
  }

  // Administrative staff
  const adminRoleMap: Record<string, string> = {
    districtadministrator: 'district_admin',
    siteadministrator:     'campus_admin',
    administrator:         'campus_admin',
  };
  const adminStaff = (r.staff ?? []).filter((s: any) =>
    s.email && s.is_active && adminRoleMap[String(s.oneroster_role || '').toLowerCase()]
  );
  let staffWlRows: any[] = [];
  if (adminStaff.length) {
    staffWlRows = adminStaff.map((s: any) => ({
      email: s.email.toLowerCase(),
      role: adminRoleMap[String(s.oneroster_role).toLowerCase()],
      campus_id: s.campus_id ?? null,
      teacher_id: null,
      tenant_hint: 'oneroster_auto',
    }));
  }

  const allWl = [...teacherWlRows, ...staffWlRows];
  if (allWl.length) {
    const candidateEmails = allWl.map(w => w.email);
    const { data: existing, error: exErr } = await admin.from('staff_whitelist')
      .select('email').in('email', candidateEmails);
    if (exErr) throw new Error(`staff_whitelist lookup failed: ${exErr.message}`);
    const existingSet = new Set((existing ?? []).map((e: any) => e.email.toLowerCase()));
    const newRows = allWl.filter(w => !existingSet.has(w.email));

    if (newRows.length) {
      const CHUNK = 500;
      for (let i = 0; i < newRows.length; i += CHUNK) {
        const { error } = await admin.from('staff_whitelist')
          .insert(newRows.slice(i, i + CHUNK));
        if (error) throw new Error(`staff_whitelist insert failed: ${error.message}`);
      }
      whitelistAdded = newRows.length;
    }
  }

  return {
    staffAdded: whitelistAdded,
    droppedStudentEnrollments,
    droppedTeacherAssignments,
  };
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
