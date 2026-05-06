// ==========================================================================
// HPA -- OneRoster v1.2 REST API sync  (Supabase Edge Function)
// v10: process tobedeleted users (with is_active=false) so their enrollments
// link instead of being silently dropped. Always emits `rescued_students`
// in row_counts so we know the rescue pass ran. Dumps a deterministic
// diagnostics object into sync_runs.details (status_breakdown,
// campus_resolution: {students_no_candidates, students_no_candidate_match,
// orphan_students_sample, orphan_candidate_sid_counts, ...}) so we can
// see exactly why students lose campus_id without guessing.
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
    const dropped = await upsertMapped(admin, mapped);

    row_counts = mapped.counts;
    if (dropped.staffAdded) row_counts.whitelist_added = dropped.staffAdded;
    if (dropped.droppedStudentEnrollments) {
      row_counts.dropped_student_enrollments = dropped.droppedStudentEnrollments;
      if (dropped.droppedStudentMissingStudent) row_counts.dropped_student_enrollments_missing_student = dropped.droppedStudentMissingStudent;
      if (dropped.droppedStudentMissingSection) row_counts.dropped_student_enrollments_missing_section = dropped.droppedStudentMissingSection;
      if (dropped.droppedStudentMissingBoth)    row_counts.dropped_student_enrollments_missing_both    = dropped.droppedStudentMissingBoth;
    }
    if (dropped.droppedTeacherAssignments) {
      row_counts.dropped_teacher_assignments = dropped.droppedTeacherAssignments;
      if (dropped.droppedTeacherMissingTeacher) row_counts.dropped_teacher_assignments_missing_teacher = dropped.droppedTeacherMissingTeacher;
      if (dropped.droppedTeacherMissingSection) row_counts.dropped_teacher_assignments_missing_section = dropped.droppedTeacherMissingSection;
      if (dropped.droppedTeacherMissingBoth)    row_counts.dropped_teacher_assignments_missing_both    = dropped.droppedTeacherMissingBoth;
    }
    const warnings: string[] = [];
    if (!row_counts.orgs)  warnings.push('no orgs returned');
    if (!row_counts.users) warnings.push('no users returned');
    if (dropped.droppedStudentEnrollments) warnings.push(`${dropped.droppedStudentEnrollments} student enrollments not linked`);
    if (dropped.droppedTeacherAssignments) warnings.push(`${dropped.droppedTeacherAssignments} teacher assignments not linked`);

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
        status_breakdown: mapped.statusStats || {},
        campus_resolution: dropped.diagnostics || {},
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

  const course_sections = (d.classes ?? []).map(cl => ({
    oneroster_class_sourced_id: cl.sourcedId,
    section_code: cl.classCode || cl.title || cl.sourcedId,
    is_active: (cl.status || 'active').toLowerCase() === 'active',
    _or_course_sid: cl.course?.sourcedId || null,
    _or_school_sid: cl.school?.sourcedId || (Array.isArray(cl.schools) ? cl.schools[0]?.sourcedId : null),
    _or_term_sid:   Array.isArray(cl.terms) ? cl.terms[0]?.sourcedId : (cl.term?.sourcedId || null),
  }));
  counts.classes = course_sections.length;

  // Build helper maps so each user can be pinned to a SCHOOL org, not the
  // district. OneRoster's `primaryOrg` for many students points to the
  // auto-generated district office; that wouldn't match any campus in our
  // table. Walk enrollments -> classes.school to derive each user's possible
  // schools (kept as a Set so we don't lock them to the first enrollment).
  const classToSchoolSid = new Map<string, string>();
  for (const cl of (d.classes ?? [])) {
    const sid = cl.school?.sourcedId
      || (Array.isArray(cl.schools) ? cl.schools[0]?.sourcedId : null);
    if (cl.sourcedId && sid) classToSchoolSid.set(cl.sourcedId, sid);
  }
  const userToSchoolSids = new Map<string, Set<string>>();
  for (const e of (d.enrollments ?? [])) {
    const userSid  = e.user?.sourcedId;
    const classSid = e.class?.sourcedId;
    if (!userSid || !classSid) continue;
    const schoolSid = classToSchoolSid.get(classSid);
    if (!schoolSid) continue;
    if (!userToSchoolSids.has(userSid)) userToSchoolSids.set(userSid, new Set());
    userToSchoolSids.get(userSid)!.add(schoolSid);
  }

  // Helper: build the priority-ordered list of org sids we should try when
  // resolving a user's campus_id. The upsert step picks the FIRST sid in
  // this list that exists in campusMap.
  const buildCandidateOrgSids = (u: any, roles: any[], primaryEntry: any): string[] => {
    const out: string[] = [];
    const push = (sid: any) => {
      if (typeof sid === 'string' && sid && !out.includes(sid)) out.push(sid);
    };
    // 1. Enrollment-derived schools (authoritative for pinning to a campus)
    const enrollSet = userToSchoolSids.get(u.sourcedId);
    if (enrollSet) for (const sid of enrollSet) push(sid);
    // 2. The primary role's org
    push(primaryEntry?.org?.sourcedId);
    // 3. Every other role's org
    for (const r of roles) push(r?.org?.sourcedId);
    // 4. user.primaryOrg (object or array form)
    const poArr = Array.isArray(u.primaryOrg)
      ? u.primaryOrg
      : (u.primaryOrg ? [u.primaryOrg] : []);
    for (const po of poArr) push(po?.sourcedId ?? po);
    push(u.primaryOrgSourcedId);
    // 5. user.orgs[] (catch-all)
    const orgsList = Array.isArray(u.orgs) ? u.orgs : [];
    for (const o of orgsList) push(o?.sourcedId ?? o);
    return out;
  };

  const students: any[] = [];
  const teachers: any[] = [];
  const staff: any[] = [];
  const roleStats: Record<string, number> = {};
  const statusStats: Record<string, number> = {};
  for (const u of (d.users ?? [])) {
    const userStatus = String(u.status || 'active').toLowerCase();
    statusStats[userStatus || '(none)'] = (statusStats[userStatus || '(none)'] || 0) + 1;
    // Process every status — tobedeleted users still get upserted with
    // is_active=false so their enrollments link. (Earlier we skipped them
    // and that orphaned ~1419 enrollments referencing tobedeleted students.)
    const isUserActive = userStatus === 'active';

    const roles = Array.isArray(u.roles) ? u.roles : [];
    const primaryEntry =
         roles.find((r: any) => String(r.roleType || '').toLowerCase() === 'primary')
      || roles[0]
      || null;
    const primaryRoleStr = primaryEntry
      ? String(primaryEntry.role || '').toLowerCase()
      : String(u.role || '').toLowerCase();

    // Permissive secondary check: if primary role is something we'd skip
    // (parent/guardian/relative/empty) but the user has a recognized role
    // somewhere else in roles[], use that as a fallback.
    const allRoleStrs = roles
      .map((r: any) => String(r.role || '').toLowerCase())
      .filter(Boolean);
    const fallbackRoleStr =
         (allRoleStrs.includes('student')                          ? 'student' : null)
      || (allRoleStrs.includes('teacher')                          ? 'teacher' : null)
      || (allRoleStrs.includes('aide')                             ? 'aide'    : null)
      || null;
    const skippableSet = new Set(['parent', 'guardian', 'relative', '']);
    const effectiveRoleStr = (skippableSet.has(primaryRoleStr) && fallbackRoleStr)
      ? fallbackRoleStr
      : primaryRoleStr;

    roleStats[primaryRoleStr || '(none)'] = (roleStats[primaryRoleStr || '(none)'] || 0) + 1;

    // Collect every plausible campus sid for this user. The upsert pass
    // picks the FIRST one that's actually in `campusMap` (i.e. a real
    // school we synced), giving us a multi-fallback resolution.
    const candidateOrgSids = buildCandidateOrgSids(u, roles, primaryEntry);

    if (effectiveRoleStr === 'student') {
      students.push({
        oneroster_user_sourced_id: u.sourcedId,
        student_id: u.identifier || u.username || u.sourcedId,
        first_name: u.givenName, last_name: u.familyName,
        email: u.email, grade_level: parseInt(u.grades || u.grade || '9', 10) || null,
        _or_candidate_org_sids: candidateOrgSids,
        is_active: isUserActive,
      });
    } else if (effectiveRoleStr === 'teacher') {
      teachers.push({
        oneroster_user_sourced_id: u.sourcedId,
        first_name: u.givenName, last_name: u.familyName, email: u.email,
        _or_candidate_org_sids: candidateOrgSids,
        oneroster_role: 'teacher',
        is_active: isUserActive,
      });
    } else {
      // Aides land here too (treated as non-instructional staff to match
      // Clever's split). Skip pure parent/guardian/relative rows here —
      // they may still get rescued below if they have student enrollments.
      if (skippableSet.has(effectiveRoleStr)) continue;

      staff.push({
        oneroster_user_sourced_id: u.sourcedId,
        first_name: u.givenName, last_name: u.familyName, email: u.email,
        _or_candidate_org_sids: candidateOrgSids,
        oneroster_role: effectiveRoleStr,
        title: u.title || null,
        is_active: isUserActive,
      });
    }
  }

  // Rescue pass: OneRoster sometimes tags a real student's primary role as
  // 'guardian' or 'relative' (or leaves it blank). If they have an enrollment
  // with role='student', they ARE a student. Re-classify them and remove from
  // staff/teachers if they slipped in there earlier.
  const knownUserSids = new Set<string>();
  for (const s of students) knownUserSids.add(s.oneroster_user_sourced_id);
  for (const t of teachers) knownUserSids.add(t.oneroster_user_sourced_id);
  for (const s of staff)    knownUserSids.add(s.oneroster_user_sourced_id);

  const enrolledStudentSids = new Set<string>();
  for (const e of (d.enrollments ?? [])) {
    if (String(e.role || '').toLowerCase() === 'student' && e.user?.sourcedId) {
      enrolledStudentSids.add(e.user.sourcedId);
    }
  }

  let rescuedAsStudents = 0;
  const studentSidSet = new Set(students.map((s: any) => s.oneroster_user_sourced_id));
  for (const u of (d.users ?? [])) {
    const sid = u.sourcedId;
    if (!enrolledStudentSids.has(sid)) continue;
    if (studentSidSet.has(sid)) continue;
    const userStatus = String(u.status || 'active').toLowerCase();
    // Process all statuses including 'tobedeleted' — they still have active
    // enrollments referencing them and we want those to link.

    const roles = Array.isArray(u.roles) ? u.roles : [];
    const primaryEntry =
         roles.find((r: any) => String(r.roleType || '').toLowerCase() === 'primary')
      || roles[0]
      || null;

    students.push({
      oneroster_user_sourced_id: sid,
      student_id: u.identifier || u.username || sid,
      first_name: u.givenName, last_name: u.familyName,
      email: u.email, grade_level: parseInt(u.grades || u.grade || '9', 10) || null,
      _or_candidate_org_sids: buildCandidateOrgSids(u, roles, primaryEntry),
      is_active: userStatus === 'active',
    });
    studentSidSet.add(sid);
    rescuedAsStudents++;

    // Make sure they don't also linger in teachers/staff (e.g. tagged 'aide'
    // but enrolled as student elsewhere).
    const tIdx = teachers.findIndex((x: any) => x.oneroster_user_sourced_id === sid);
    if (tIdx >= 0) teachers.splice(tIdx, 1);
    const sIdx = staff.findIndex((x: any) => x.oneroster_user_sourced_id === sid);
    if (sIdx >= 0) staff.splice(sIdx, 1);
  }
  counts.users = (d.users ?? []).length;
  counts.students = students.length;
  counts.teachers = teachers.length;
  counts.staff = staff.length;
  // Always surface rescued_students (even 0) so we know the rescue pass ran.
  (counts as any).rescued_students = rescuedAsStudents;

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
    } else if (role === 'teacher') {
      // Aides intentionally excluded — they live in `staff` and don't teach
      // classes from a verification-flow perspective.
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
    statusStats,
  };
}

// Chunked upsert that returns id maps in one pass via .select(). Avoids
// huge `.in()` URLs that PostgREST rejects.
async function upsertChunked(
  admin: any, table: string, rows: any[],
  conflictCol: string, idMap?: Map<string, string>,
) {
  if (!rows?.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { data, error } = await admin.from(table)
      .upsert(slice, { onConflict: conflictCol, ignoreDuplicates: false })
      .select(`id, ${conflictCol}`);
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    if (idMap) for (const row of data ?? []) idMap.set(row[conflictCol], row.id);
  }
}

async function upsertMapped(admin: any, mapped: { records: Record<string, any[]> }) {
  const r = mapped.records;

  // 1) Campuses
  const campusMap = new Map<string, string>();
  await upsertChunked(admin, 'campuses', r.campuses, 'oneroster_org_sourced_id', campusMap);

  // Resolve each user's campus_id by walking their candidate org sids and
  // picking the first one that matches a real synced campus. Then strip
  // the temp field before upsert.
  const pickCampus = (sids?: string[]): string | undefined => {
    if (!sids?.length) return undefined;
    for (const sid of sids) {
      if (campusMap.has(sid)) return campusMap.get(sid);
    }
    return undefined;
  };

  // Diagnostic counters so we can see *why* a student ends up with no
  // campus. (Stored back into sync_runs.details for inspection.)
  let studentsNoCandidates = 0;
  let studentsNoCandidateMatch = 0;
  let studentsResolvedFromEnroll = 0;
  let studentsResolvedFromOrgRefs = 0;
  const orphanStudentsSample: Array<Record<string, any>> = [];
  const orphanCandidateSidCounts: Record<string, number> = {};

  for (const t of r.teachers ?? []) {
    const cid = pickCampus(t._or_candidate_org_sids);
    if (cid) t.campus_id = cid;
    delete t._or_candidate_org_sids;
  }
  for (const s of r.students ?? []) {
    const sids: string[] = s._or_candidate_org_sids || [];
    const cid = pickCampus(sids);
    if (cid) {
      s.campus_id = cid;
      // Track WHICH candidate slot won (enrollment vs other) so we can see
      // which fallback path is doing the heavy lifting.
      if (sids[0] && campusMap.has(sids[0])) studentsResolvedFromEnroll++;
      else studentsResolvedFromOrgRefs++;
    } else if (sids.length === 0) {
      studentsNoCandidates++;
      if (orphanStudentsSample.length < 15) {
        orphanStudentsSample.push({
          sid: s.oneroster_user_sourced_id,
          student_id: s.student_id,
          name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
          reason: 'no_candidate_sids',
          candidates: [],
        });
      }
    } else {
      studentsNoCandidateMatch++;
      for (const sid of sids) orphanCandidateSidCounts[sid] = (orphanCandidateSidCounts[sid] || 0) + 1;
      if (orphanStudentsSample.length < 15) {
        orphanStudentsSample.push({
          sid: s.oneroster_user_sourced_id,
          student_id: s.student_id,
          name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
          reason: 'no_match_in_campusMap',
          candidates: sids,
        });
      }
    }
    delete s._or_candidate_org_sids;
  }
  for (const st of r.staff ?? []) {
    const cid = pickCampus(st._or_candidate_org_sids);
    if (cid) st.campus_id = cid;
    delete st._or_candidate_org_sids;
  }

  // 2) School years + terms
  await upsertChunked(admin, 'school_years', r.school_years, 'oneroster_academic_session_sourced_id');
  const termMap = new Map<string, string>();
  await upsertChunked(admin, 'terms', r.terms, 'oneroster_academic_session_sourced_id', termMap);

  // 3) Courses
  const courseMap = new Map<string, string>();
  await upsertChunked(admin, 'courses', r.courses, 'oneroster_course_sourced_id', courseMap);

  // 4) course_sections — resolve course_id, campus_id, term_id
  let sectionsNoCampus = 0;
  for (const cs of r.course_sections ?? []) {
    if (cs._or_course_sid && courseMap.has(cs._or_course_sid)) cs.course_id = courseMap.get(cs._or_course_sid);
    if (cs._or_school_sid && campusMap.has(cs._or_school_sid)) cs.campus_id = campusMap.get(cs._or_school_sid);
    if (cs._or_term_sid   && termMap.has(cs._or_term_sid))     cs.term_id   = termMap.get(cs._or_term_sid);
    if (!cs.campus_id) sectionsNoCampus++;
    delete cs._or_course_sid; delete cs._or_school_sid; delete cs._or_term_sid;
  }
  const sectionMap = new Map<string, string>();
  await upsertChunked(admin, 'course_sections', r.course_sections, 'oneroster_class_sourced_id', sectionMap);

  // 5) Teachers / staff / students
  const teacherMap = new Map<string, string>();
  const studentMap = new Map<string, string>();
  await upsertChunked(admin, 'teachers', r.teachers, 'oneroster_user_sourced_id', teacherMap);
  await upsertChunked(admin, 'staff',    r.staff,    'oneroster_user_sourced_id');
  await upsertChunked(admin, 'students', r.students, 'oneroster_user_sourced_id', studentMap);

  // 6) Resolve and upsert enrollments
  let droppedStudentEnrollments = 0;
  let droppedStudentMissingStudent = 0;
  let droppedStudentMissingSection = 0;
  let droppedStudentMissingBoth = 0;
  let droppedTeacherAssignments = 0;
  let droppedTeacherMissingTeacher = 0;
  let droppedTeacherMissingSection = 0;
  let droppedTeacherMissingBoth = 0;

  const seStrong: any[] = [];
  for (const se of r.student_enrollments ?? []) {
    const sId = studentMap.get(se._or_user_sid);
    const cId = sectionMap.get(se._or_class_sid);
    delete se._or_user_sid; delete se._or_class_sid;
    if (!sId && !cId) { droppedStudentMissingBoth++; droppedStudentEnrollments++; continue; }
    if (!sId)         { droppedStudentMissingStudent++; droppedStudentEnrollments++; continue; }
    if (!cId)         { droppedStudentMissingSection++; droppedStudentEnrollments++; continue; }
    se.student_id = sId; se.course_section_id = cId;
    seStrong.push(se);
  }
  await upsertChunked(admin, 'student_enrollments', seStrong, 'oneroster_enrollment_sourced_id');

  const tcStrong: any[] = [];
  for (const ta of r.teacher_class_assignments ?? []) {
    const tId = teacherMap.get(ta._or_user_sid);
    const cId = sectionMap.get(ta._or_class_sid);
    delete ta._or_user_sid; delete ta._or_class_sid;
    if (!tId && !cId) { droppedTeacherMissingBoth++; droppedTeacherAssignments++; continue; }
    if (!tId)         { droppedTeacherMissingTeacher++; droppedTeacherAssignments++; continue; }
    if (!cId)         { droppedTeacherMissingSection++; droppedTeacherAssignments++; continue; }
    ta.teacher_id = tId; ta.course_section_id = cId;
    tcStrong.push(ta);
  }
  await upsertChunked(admin, 'teacher_class_assignments', tcStrong, 'oneroster_enrollment_sourced_id');

  // 7) Auto-populate staff_whitelist for SSO. We only insert rows that
  //    don't already exist so manual role upgrades are preserved.
  let whitelistAdded = 0;

  const teacherWlRows: any[] = (r.teachers ?? [])
    .filter((t: any) => t.email && t.is_active && teacherMap.has(t.oneroster_user_sourced_id))
    .map((t: any) => ({
      email: t.email.toLowerCase(),
      role: 'teacher',
      campus_id: t.campus_id ?? null,
      teacher_id: teacherMap.get(t.oneroster_user_sourced_id),
      tenant_hint: 'oneroster_auto',
    }));

  const adminRoleMap: Record<string, string> = {
    districtadministrator: 'district_admin',
    siteadministrator:     'campus_admin',
    administrator:         'campus_admin',
  };
  const staffWlRows: any[] = (r.staff ?? [])
    .filter((s: any) => s.email && s.is_active && adminRoleMap[String(s.oneroster_role || '').toLowerCase()])
    .map((s: any) => ({
      email: s.email.toLowerCase(),
      role: adminRoleMap[String(s.oneroster_role).toLowerCase()],
      campus_id: s.campus_id ?? null,
      teacher_id: null,
      tenant_hint: 'oneroster_auto',
    }));

  const allWl = [...teacherWlRows, ...staffWlRows];
  if (allWl.length) {
    // Chunk the existence check to avoid large IN clauses.
    const existingSet = new Set<string>();
    const candidateEmails = allWl.map(w => w.email);
    const CHUNK = 200;
    for (let i = 0; i < candidateEmails.length; i += CHUNK) {
      const batch = candidateEmails.slice(i, i + CHUNK);
      const { data, error } = await admin.from('staff_whitelist')
        .select('email').in('email', batch);
      if (error) throw new Error(`staff_whitelist lookup failed: ${error.message}`);
      for (const row of data ?? []) existingSet.add(String(row.email).toLowerCase());
    }
    const newRows = allWl.filter(w => !existingSet.has(w.email));
    if (newRows.length) {
      for (let i = 0; i < newRows.length; i += 500) {
        const slice = newRows.slice(i, i + 500);
        const { error } = await admin.from('staff_whitelist').insert(slice);
        if (error) throw new Error(`staff_whitelist insert failed: ${error.message}`);
      }
      whitelistAdded = newRows.length;
    }
  }

  return {
    staffAdded: whitelistAdded,
    droppedStudentEnrollments,
    droppedStudentMissingStudent,
    droppedStudentMissingSection,
    droppedStudentMissingBoth,
    droppedTeacherAssignments,
    droppedTeacherMissingTeacher,
    droppedTeacherMissingSection,
    droppedTeacherMissingBoth,
    diagnostics: {
      students_no_candidates: studentsNoCandidates,
      students_no_candidate_match: studentsNoCandidateMatch,
      students_resolved_from_enrollment: studentsResolvedFromEnroll,
      students_resolved_from_org_refs: studentsResolvedFromOrgRefs,
      sections_no_campus: sectionsNoCampus,
      campus_map_size: campusMap.size,
      campus_map_sids: [...campusMap.keys()],
      orphan_candidate_sid_counts: orphanCandidateSidCounts,
      orphan_students_sample: orphanStudentsSample,
    },
  };
}

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
