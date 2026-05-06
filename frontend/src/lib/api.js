// Unified data-access layer.
// Demo mode (FORCE_DEMO=true OR missing env vars) uses a localStorage-backed
// snapshot of demoData.js. Live mode hits Supabase directly (RPCs + RLS).

import * as seed from "./demoData";
import { supabase, isDemoMode } from "./supabase";
import { scoreAttempt, computeGrowth, shuffleSeeded } from "./scoring";

// ---------------------------------------------------------------------------
// Direct-fetch RPC fallback. supabase-js@2.105.1 has a known bug where it
// double-reads the response body of failed RPC calls, surfacing every error
// (404 not found, RLS reject, raise exception, etc.) as the cryptic
// `TypeError: Failed to execute 'text' on 'Response': body stream already read`.
// We bypass it for hot-path student RPCs by calling /rest/v1/rpc/<name>
// directly and parsing the JSON ourselves.
// ---------------------------------------------------------------------------
async function rpcDirect(fnName, args) {
  const SUPABASE_URL     = process.env.REACT_APP_SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase env vars not configured");
  }
  const headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  // If a real Supabase session exists (staff user), use that JWT — needed so
  // server-side RLS can read the staff role. The student flow runs as anon.
  try {
    const { data: session } = await supabase.auth.getSession();
    const tok = session?.session?.access_token;
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
  } catch { /* ignore */ }

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST", headers, body: JSON.stringify(args ?? {}),
  });
  // Read body exactly once.
  const text = await resp.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }

  if (!resp.ok) {
    const msg = (body && typeof body === "object" && (body.message || body.hint || body.details))
      || (typeof body === "string" && body) || `HTTP ${resp.status}`;
    const err = new Error(msg);
    err.code = body?.code;
    err.details = body?.details;
    err.hint = body?.hint;
    err.status = resp.status;
    throw err;
  }
  return body;
}

const STORAGE_KEY = "hpa.demo.v2";

// ---------------------------------------------------------------------------
// LOCAL STORE (demo mode only)
// ---------------------------------------------------------------------------
function loadStore() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* ignore */ }
  }
  const initial = {
    campuses: clone(seed.campuses),
    school_years: clone(seed.school_years),
    terms: clone(seed.terms),
    courses: clone(seed.courses),
    course_sections: clone(seed.course_sections),
    teachers: clone(seed.teachers),
    teacher_class_assignments: clone(seed.teacher_class_assignments),
    students: clone(seed.students),
    student_enrollments: clone(seed.student_enrollments),
    tests: clone(seed.tests),
    questions: clone(seed.questions),
    test_attempts: clone(seed.test_attempts),
    growth_results: clone(seed.growth_results),
    audit_logs: clone(seed.audit_logs),
    app_settings: clone(seed.app_settings),
    staff_users: clone(seed.staff_users),
    oneroster_imports: clone(seed.oneroster_imports),
    test_imports: clone(seed.test_imports),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}
function saveStore(store) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function uid(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }

let _store = null;
function store() {
  if (!_store) _store = loadStore();
  return _store;
}
function persist() { saveStore(store()); }

export function resetDemoData() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem("hpa.enrollments");
  }
  _store = null;
  return store();
}

// Audit helper used internally
export function addAudit(actor, action, target, details) {
  if (isDemoMode) {
    const s = store();
    s.audit_logs.unshift({
      id: uid("al"), actor: actor || "system", action, target,
      details: details || {}, created_at: new Date().toISOString(),
    });
    persist();
    return;
  }
  // Best-effort write; don't block the caller on failure.
  supabase.from("audit_logs").insert({
    actor_email: actor || null,
    action,
    target: target ? String(target) : null,
    details: details || {},
  }).then(() => {}, () => {});
}

// ---------------------------------------------------------------------------
// READS
// ---------------------------------------------------------------------------

export async function listCampuses() {
  if (isDemoMode) return store().campuses;
  const { data, error } = await supabase.from("campuses").select("*").order("name");
  if (error) throw error;
  return data || [];
}

export async function listCourses() {
  if (isDemoMode) return store().courses;
  const { data, error } = await supabase.from("courses").select("*").order("title");
  if (error) throw error;
  return data || [];
}

export async function listTeachers(campusId = null) {
  if (isDemoMode) {
    const all = store().teachers;
    return campusId ? all.filter(t => t.campus_id === campusId) : all;
  }
  let q = supabase.from("teachers").select("*").order("last_name");
  if (campusId) q = q.eq("campus_id", campusId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function listStudents(campusId = null) {
  if (isDemoMode) {
    const all = store().students;
    return campusId ? all.filter(s => s.campus_id === campusId) : all;
  }
  let q = supabase.from("students").select("*").order("last_name");
  if (campusId) q = q.eq("campus_id", campusId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Per-campus active-student/teacher counts. Uses HEAD requests with
// `count: 'exact'` so we get accurate totals regardless of dataset size
// (Supabase's default `.select('*')` caps a single response at 1000 rows
// which silently truncated the Campuses page totals).
export async function getCampusCounts() {
  if (isDemoMode) {
    const s = store();
    return s.campuses.map(c => ({
      campus_id: c.id,
      students: s.students.filter(x => x.campus_id === c.id && x.is_active !== false).length,
      teachers: s.teachers.filter(x => x.campus_id === c.id && x.is_active !== false).length,
    }));
  }
  const { data: campuses, error: cErr } = await supabase
    .from("campuses").select("id");
  if (cErr) throw cErr;
  const out = await Promise.all((campuses || []).map(async c => {
    const [{ count: students }, { count: teachers }] = await Promise.all([
      supabase.from("students")
        .select("id", { count: "exact", head: true })
        .eq("campus_id", c.id).eq("is_active", true),
      supabase.from("teachers")
        .select("id", { count: "exact", head: true })
        .eq("campus_id", c.id).eq("is_active", true),
    ]);
    return { campus_id: c.id, students: students ?? 0, teachers: teachers ?? 0 };
  }));
  return out;
}

export async function listTests() {
  if (isDemoMode) return store().tests;
  const { data, error } = await supabase.from("tests").select("*").order("name");
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Sections (course sections) -- scoped by RLS
// ---------------------------------------------------------------------------
// listSectionsScoped() returns whatever sections the current user is allowed
// to see (RLS does the filtering): teachers see only their assigned sections,
// campus admins see only their campus, district/super admins see everything.
// Each row includes joined course, campus, teacher names and an enrollment
// count for the index page.
export async function listSectionsScoped() {
  if (isDemoMode) {
    const s = store();
    return (s.course_sections || []).map(cs => {
      const course = (s.courses || []).find(c => c.id === cs.course_id);
      const campus = (s.campuses || []).find(c => c.id === cs.campus_id);
      const tcas = (s.teacher_class_assignments || []).filter(t => t.course_section_id === cs.id);
      const teachers = tcas.map(t => (s.teachers || []).find(x => x.id === t.teacher_id)).filter(Boolean);
      const enrollment_count = (s.student_enrollments || []).filter(e => e.course_section_id === cs.id).length;
      return { ...cs, course, campus, teachers, enrollment_count };
    });
  }
  const { data, error } = await supabase.from("course_sections").select(`
    id, section_code, is_active,
    course:courses(id, title, code),
    campus:campuses(id, name),
    assignments:teacher_class_assignments(teacher:teachers(id, first_name, last_name)),
    enrollments:student_enrollments(count)
  `).eq("is_active", true).order("section_code");
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    section_code: row.section_code,
    is_active: row.is_active,
    course: row.course || null,
    campus: row.campus || null,
    teachers: (row.assignments || []).map(a => a.teacher).filter(Boolean),
    enrollment_count: row.enrollments?.[0]?.count ?? 0,
  }));
}

// getSectionDetail(id) returns one section with joined course/campus/teachers.
// Throws (or returns null) if RLS blocks access.
export async function getSectionDetail(sectionId) {
  if (isDemoMode) {
    const s = store();
    const cs = (s.course_sections || []).find(c => c.id === sectionId);
    if (!cs) return null;
    const course = (s.courses || []).find(c => c.id === cs.course_id);
    const campus = (s.campuses || []).find(c => c.id === cs.campus_id);
    const tcas = (s.teacher_class_assignments || []).filter(t => t.course_section_id === cs.id);
    const teachers = tcas.map(t => (s.teachers || []).find(x => x.id === t.teacher_id)).filter(Boolean);
    return { ...cs, course, campus, teachers };
  }
  const { data, error } = await supabase.from("course_sections").select(`
    id, section_code, is_active,
    course:courses(id, title, code),
    campus:campuses(id, name),
    assignments:teacher_class_assignments(teacher:teachers(id, first_name, last_name))
  `).eq("id", sectionId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    section_code: data.section_code,
    is_active: data.is_active,
    course: data.course || null,
    campus: data.campus || null,
    teachers: (data.assignments || []).map(a => a.teacher).filter(Boolean),
  };
}

// getSectionRoster(sectionId) -> active students enrolled in this section,
// joined with the student record. Returns [] if RLS blocks access.
export async function getSectionRoster(sectionId) {
  if (isDemoMode) {
    const s = store();
    return (s.student_enrollments || [])
      .filter(e => e.course_section_id === sectionId)
      .map(e => ({
        enrollment_id: e.id,
        status: e.status,
        student: (s.students || []).find(x => x.id === e.student_id) || null,
      }))
      .filter(r => r.student)
      .sort((a, b) => (a.student.last_name || "").localeCompare(b.student.last_name || ""));
  }
  const { data, error } = await supabase.from("student_enrollments").select(`
    id, status,
    student:students(id, first_name, last_name, student_id, grade_level, is_active)
  `).eq("course_section_id", sectionId);
  if (error) throw error;
  return (data || [])
    .filter(r => r.student && r.student.is_active !== false)
    .map(r => ({ enrollment_id: r.id, status: r.status, student: r.student }))
    .sort((a, b) => {
      const A = (a.student.last_name || "") + (a.student.first_name || "");
      const B = (b.student.last_name || "") + (b.student.first_name || "");
      return A.localeCompare(B);
    });
}

export async function listQuestionsForTest(testId) {
  if (isDemoMode) return store().questions.filter(q => q.test_id === testId);
  const { data, error } = await supabase.from("questions").select("*").eq("test_id", testId).order("question_number");
  if (error) throw error;
  return data || [];
}

export async function listAttempts(filter = {}) {
  if (isDemoMode) {
    let r = store().test_attempts;
    if (filter.test_id) r = r.filter(a => a.test_id === filter.test_id);
    if (filter.student_id) r = r.filter(a => a.student_id === filter.student_id);
    if (filter.course_section_id) r = r.filter(a => a.course_section_id === filter.course_section_id);
    return r;
  }
  let q = supabase.from("test_attempts").select("*");
  Object.entries(filter).forEach(([k, v]) => { q = q.eq(k, v); });
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(reshapeAttemptRow);
}

// In live mode, the test_attempts row stores responses separately. For admin
// reports we lazily attach responses from student_responses when needed; for
// growth-only views we can rely on score_percent which is already on the row.
function reshapeAttemptRow(a) {
  return { ...a, responses: a.responses || [] };
}

export async function listGrowthResults() {
  if (isDemoMode) return store().growth_results;
  const { data, error } = await supabase.from("growth_results").select("*");
  if (error) throw error;
  return data || [];
}

export async function listCourseSections() {
  if (isDemoMode) return store().course_sections;
  const { data, error } = await supabase.from("course_sections").select("*");
  if (error) throw error;
  return data || [];
}

export async function listSchoolYears() {
  if (isDemoMode) return store().school_years;
  const { data, error } = await supabase.from("school_years").select("*").order("start_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listStaff(campusId) {
  if (isDemoMode) return [];
  let q = supabase.from("staff").select("*").order("last_name", { ascending: true });
  if (campusId) q = q.eq("campus_id", campusId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getSettings() {
  if (isDemoMode) return store().app_settings;
  const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data || {};
}

export async function listAuditLogs(limit = 200) {
  if (isDemoMode) {
    return [...store().audit_logs]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, limit);
  }
  const { data, error } = await supabase.from("audit_logs")
    .select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  // Normalize for the AuditLogs page which expects { actor, action, target, details, created_at }
  return (data || []).map(r => ({
    id: r.id,
    actor: r.actor_email || r.actor_id || "system",
    action: r.action,
    target: r.target,
    details: r.details,
    created_at: r.created_at,
  }));
}

export async function listOneRosterImports() {
  if (isDemoMode) return store().oneroster_imports;
  const { data, error } = await supabase.from("oneroster_imports")
    .select("*").order("uploaded_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listTestImports() {
  if (isDemoMode) return store().test_imports;
  const { data, error } = await supabase.from("test_imports")
    .select("*").order("uploaded_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// STUDENT FLOW
// ---------------------------------------------------------------------------

const ENROLLMENTS_CACHE_KEY = "hpa.enrollments";

export async function lookupStudentById(studentId) {
  if (isDemoMode) {
    return store().students.find(s => s.student_id === studentId && s.is_active) || null;
  }
  const { data, error } = await supabase.rpc("student_lookup", { p_student_id: studentId });
  if (error) throw error;
  if (!data || !data.found) return null;
  // Cache enrollments for getStudentEnrollments
  try {
    localStorage.setItem(ENROLLMENTS_CACHE_KEY, JSON.stringify(data.enrollments || []));
  } catch { /* ignore */ }
  const fullName = data.student.name || "";
  const [first, ...rest] = fullName.split(" ");
  return {
    id: data.student.id,
    student_id: data.student.student_id,
    first_name: first || "",
    last_name: rest.join(" ") || "",
    campus_id: data.student.campus_id,
    is_active: true,
  };
}

export async function getStudentEnrollments(studentDbId) {
  const s = store();
  if (isDemoMode) {
    const enrollments = s.student_enrollments.filter(e => e.student_id === studentDbId && e.status === "active");
    return enrollments.map(e => {
      const sec = s.course_sections.find(cs => cs.id === e.course_section_id);
      const course = sec ? s.courses.find(c => c.id === sec.course_id) : null;
      const campus = sec ? s.campuses.find(c => c.id === sec.campus_id) : null;
      const ta = sec ? s.teacher_class_assignments.find(a => a.course_section_id === sec.id) : null;
      const teacher = ta ? s.teachers.find(t => t.id === ta.teacher_id) : null;
      return { enrollment: e, section: sec, course, campus, teacher };
    }).filter(x => x.course);
  }
  // Live mode: read from cache populated by lookupStudentById
  try {
    const raw = localStorage.getItem(ENROLLMENTS_CACHE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      return arr.map(e => ({
        enrollment: { id: e.enrollment_id },
        section: e.section,
        course: e.course,
        campus: e.campus,
        teacher: e.teacher,
      }));
    }
  } catch { /* ignore */ }
  return [];
}

export async function getOpenTestsForCourse(courseId) {
  if (isDemoMode) {
    const tests = await listTests();
    const today = new Date();
    return tests.filter(t => t.course_id === courseId && t.is_published &&
      (!t.opens_at || new Date(t.opens_at) <= today) &&
      (!t.closes_at || new Date(t.closes_at) >= today));
  }
  // Use rpcDirect to bypass supabase-js@2.105.1's broken error handling.
  return (await rpcDirect("student_open_tests", { p_course_id: courseId })) || [];
}

export async function listStudentAttempts(studentDbId) {
  if (isDemoMode) {
    return store().test_attempts.filter(a => a.student_id === studentDbId);
  }
  return (await rpcDirect("student_attempts", { p_student_db_id: studentDbId })) || [];
}

export async function getStudentAttempt(attemptId, studentDbId) {
  if (isDemoMode) {
    const s = store();
    const att = s.test_attempts.find(a => a.id === attemptId);
    if (!att) return null;
    const test = s.tests.find(t => t.id === att.test_id);
    const qs = s.questions.filter(q => q.test_id === att.test_id);
    const questions = att.question_order.map((qid, idx) => {
      const q = qs.find(qq => qq.id === qid);
      return q ? {
        id: q.id, question_number: q.question_number,
        image_url: q.image_url, display_order: idx + 1,
      } : null;
    }).filter(Boolean);
    return {
      attempt: att,
      test: test ? { id: test.id, name: test.name, test_type: test.test_type } : null,
      questions,
      responses: att.responses,
    };
  }
  return await rpcDirect("get_student_attempt", {
    p_attempt_id: attemptId,
    p_student_db_id: studentDbId,
    p_session_secret: getAttemptSecret(attemptId),
  });
}

export async function findOrCreateAttempt(studentDbId, testId, courseSectionId) {
  const s = store();
  if (isDemoMode) {
    let existing = s.test_attempts.find(a => a.student_id === studentDbId && a.test_id === testId);
    if (existing) return existing;
    const qs = s.questions.filter(q => q.test_id === testId && q.is_active);
    const order = shuffleSeeded(qs.map(q => q.id), Date.now() + studentDbId.length);
    const attempt = {
      id: uid("att"),
      student_id: studentDbId, test_id: testId, course_section_id: courseSectionId,
      question_order: order,
      responses: order.map(qid => ({ question_id: qid, selected_answer: null })),
      status: "in_progress",
      started_at: new Date().toISOString(),
      submitted_at: null,
      score_percent: null, correct_count: null, total_count: qs.length,
    };
    s.test_attempts.push(attempt);
    persist();
    return attempt;
  }
  const data = await rpcDirect("start_or_get_attempt", {
    p_student_db_id: studentDbId, p_test_id: testId, p_section_id: courseSectionId,
  });
  // Persist the session_secret keyed by attempt id for save/submit/read calls.
  if (data && data.id && data.session_secret) {
    try {
      const cache = JSON.parse(localStorage.getItem("hpa.attemptSecrets") || "{}");
      cache[data.id] = data.session_secret;
      localStorage.setItem("hpa.attemptSecrets", JSON.stringify(cache));
    } catch { /* ignore */ }
  }
  return data;
}

function getAttemptSecret(attemptId) {
  try {
    const cache = JSON.parse(localStorage.getItem("hpa.attemptSecrets") || "{}");
    return cache[attemptId] || null;
  } catch { return null; }
}
function clearAttemptSecret(attemptId) {
  try {
    const cache = JSON.parse(localStorage.getItem("hpa.attemptSecrets") || "{}");
    delete cache[attemptId];
    localStorage.setItem("hpa.attemptSecrets", JSON.stringify(cache));
  } catch { /* ignore */ }
}

export async function saveResponse(attemptId, questionId, answer) {
  const s = store();
  if (isDemoMode) {
    const att = s.test_attempts.find(a => a.id === attemptId);
    if (!att) throw new Error("Attempt not found");
    const r = att.responses.find(x => x.question_id === questionId);
    if (r) r.selected_answer = answer;
    persist();
    return att;
  }
  await rpcDirect("save_response", {
    p_attempt_id: attemptId,
    p_question_id: questionId,
    p_answer: answer,
    p_session_secret: getAttemptSecret(attemptId),
  });
  return { id: attemptId };
}

export async function submitAttempt(attemptId) {
  const s = store();
  if (isDemoMode) {
    const att = s.test_attempts.find(a => a.id === attemptId);
    if (!att) throw new Error("Attempt not found");
    const qs = s.questions.filter(q => q.test_id === att.test_id);
    const result = scoreAttempt(att.responses, qs);
    Object.assign(att, result, { status: "submitted", submitted_at: new Date().toISOString() });
    upsertGrowthForStudentCourse(att.student_id, s.tests.find(t => t.id === att.test_id)?.course_id);
    addAudit("system", "test.submitted", att.id, { test_id: att.test_id, score: att.score_percent });
    persist();
    return att;
  }
  const secret = getAttemptSecret(attemptId);
  const data = await rpcDirect("submit_attempt", {
    p_attempt_id: attemptId,
    p_session_secret: secret,
  });
  // Server invalidated secret after submit — remove from client cache.
  clearAttemptSecret(attemptId);
  return data;
}

function upsertGrowthForStudentCourse(studentId, courseId) {
  if (!courseId) return;
  const s = store();
  const courseTests = s.tests.filter(t => t.course_id === courseId);
  const boc = courseTests.find(t => t.test_type === "BOC");
  const eoc = courseTests.find(t => t.test_type === "EOC");
  if (!boc || !eoc) return;
  const a1 = s.test_attempts.find(a => a.student_id === studentId && a.test_id === boc.id && a.status === "submitted");
  const a2 = s.test_attempts.find(a => a.student_id === studentId && a.test_id === eoc.id && a.status === "submitted");
  if (!a1 || !a2) return;
  const g = computeGrowth(a1.score_percent, a2.score_percent);
  let row = s.growth_results.find(g => g.student_id === studentId && g.course_id === courseId);
  if (!row) {
    row = { id: uid("gr"), student_id: studentId, course_id: courseId, school_year_id: "sy-2627" };
    s.growth_results.push(row);
  }
  Object.assign(row, { boc_score: a1.score_percent, eoc_score: a2.score_percent, ...g });
}

export async function resetAttempt(attemptId, actor) {
  const s = store();
  if (isDemoMode) {
    const att = s.test_attempts.find(a => a.id === attemptId);
    if (!att) throw new Error("Attempt not found");
    Object.assign(att, { status: "in_progress", submitted_at: null, score_percent: null, correct_count: null });
    att.responses = att.responses.map(r => ({ ...r, selected_answer: null }));
    addAudit(actor || "admin", "attempt.reset", attemptId, {});
    persist();
    return att;
  }
  const { error } = await supabase.rpc("reset_attempt", { p_attempt_id: attemptId, p_actor: actor || null });
  if (error) throw error;
  return { id: attemptId };
}

// ---------------------------------------------------------------------------
// ADMIN: TESTS / QUESTIONS / ANSWER KEY
// ---------------------------------------------------------------------------

export async function createTest(test, actor) {
  if (isDemoMode) {
    const s = store();
    const row = { id: uid("test"), is_published: false, scope: "district", question_count: 0, ...test };
    s.tests.push(row);
    addAudit(actor, "test.created", row.id, { name: row.name });
    persist();
    return row;
  }
  // Pull out join-table fields before insert
  const { course_ids, ...rest } = test;
  const payload = { ...rest };
  delete payload.id;
  // tests.course_id (legacy, single) = first selected course (primary)
  if (Array.isArray(course_ids) && course_ids.length) {
    payload.course_id = course_ids[0];
  }
  const { data, error } = await supabase.from("tests").insert(payload).select("*").single();
  if (error) throw error;
  // Link all selected courses via the join table
  const linkRows = (Array.isArray(course_ids) && course_ids.length ? course_ids : [data.course_id])
    .filter(Boolean)
    .map(cid => ({ test_id: data.id, course_id: cid }));
  if (linkRows.length) {
    const { error: linkErr } = await supabase.from("test_courses")
      .upsert(linkRows, { onConflict: "test_id,course_id", ignoreDuplicates: true });
    if (linkErr) throw linkErr;
  }
  addAudit(actor, "test.created", data.id, { name: data.name, courses: linkRows.length });
  return data;
}

export async function updateTest(testId, patch, actor) {
  if (isDemoMode) {
    const s = store();
    const t = s.tests.find(x => x.id === testId);
    if (!t) throw new Error("Test not found");
    Object.assign(t, patch);
    addAudit(actor, "test.updated", testId, patch);
    persist();
    return t;
  }
  // Extract join-table updates if provided so they don't get sent to the
  // tests.update() (which would 404 on unknown column).
  const { course_ids, ...rest } = patch;
  const payload = { ...rest };
  if (Array.isArray(course_ids) && course_ids.length) {
    payload.course_id = course_ids[0]; // legacy single-course pointer
  }
  const { data, error } = await supabase.from("tests").update(payload).eq("id", testId).select("*").single();
  if (error) throw error;

  // Sync the test_courses join table to exactly course_ids if provided.
  // Simplest reliable strategy: delete all existing links, then insert the
  // new set. Cheap (typically 1-3 rows per test).
  if (Array.isArray(course_ids)) {
    const { error: delErr } = await supabase.from("test_courses").delete().eq("test_id", testId);
    if (delErr) throw delErr;
    if (course_ids.length) {
      const linkRows = course_ids.map(cid => ({ test_id: testId, course_id: cid }));
      const { error: upErr } = await supabase.from("test_courses").insert(linkRows);
      if (upErr) throw upErr;
    }
  }

  addAudit(actor, "test.updated", testId, patch);
  return data;
}

export async function deleteTest(testId) {
  if (isDemoMode) {
    const s = store();
    s.tests = s.tests.filter(x => x.id !== testId);
    persist();
    return { ok: true };
  }
  const { error } = await supabase.rpc("delete_test", { p_test_id: testId });
  if (error) throw error;
  return { ok: true };
}

export async function listTestCourses() {
  if (isDemoMode) return [];
  const { data, error } = await supabase.from("test_courses").select("test_id, course_id");
  if (error) throw error;
  return data || [];
}

export async function upsertQuestion(q, actor) {
  if (isDemoMode) {
    const s = store();
    let row = s.questions.find(x => x.id === q.id);
    if (!row) {
      row = { id: q.id || uid("q"), is_active: true, ...q };
      s.questions.push(row);
    } else {
      Object.assign(row, q);
    }
    const t = s.tests.find(t => t.id === row.test_id);
    if (t) t.question_count = s.questions.filter(qq => qq.test_id === t.id).length;
    addAudit(actor, "question.upserted", row.id, { test_id: row.test_id, qn: row.question_number });
    persist();
    return row;
  }
  // In live mode upsert by (test_id, question_number) — id is generated by DB.
  const payload = { ...q };
  // If id is a UUID, use update path; otherwise insert/upsert by composite key.
  const isUuid = typeof payload.id === "string" && /^[0-9a-f-]{36}$/i.test(payload.id);
  if (isUuid) {
    const { data, error } = await supabase.from("questions").update(payload).eq("id", payload.id).select("*").single();
    if (error) throw error;
    addAudit(actor, "question.upserted", data.id, { test_id: data.test_id, qn: data.question_number });
    return data;
  }
  delete payload.id;
  const { data, error } = await supabase.from("questions")
    .upsert(payload, { onConflict: "test_id,question_number" })
    .select("*").single();
  if (error) throw error;
  addAudit(actor, "question.upserted", data.id, { test_id: data.test_id, qn: data.question_number });
  return data;
}

export async function deleteQuestion(questionId, actor) {
  if (isDemoMode) {
    const s = store();
    const idx = s.questions.findIndex(q => q.id === questionId);
    if (idx >= 0) {
      const [removed] = s.questions.splice(idx, 1);
      const t = s.tests.find(t => t.id === removed.test_id);
      if (t) t.question_count = s.questions.filter(qq => qq.test_id === t.id).length;
      addAudit(actor, "question.deleted", questionId, {});
      persist();
    }
    return true;
  }
  const { error } = await supabase.from("questions").delete().eq("id", questionId);
  if (error) throw error;
  addAudit(actor, "question.deleted", questionId, {});
  return true;
}

export async function recordOneRosterImport(meta, actor) {
  if (isDemoMode) {
    const s = store();
    const row = { id: uid("imp"), uploaded_at: new Date().toISOString(), uploaded_by: actor, ...meta };
    s.oneroster_imports.unshift(row);
    addAudit(actor, "oneroster.import.completed", row.id, meta.counts || {});
    persist();
    return row;
  }
  const { data, error } = await supabase.from("oneroster_imports").insert({
    filename: meta.filename, files_seen: meta.files_seen, counts: meta.counts,
    errors: meta.errors || [], status: meta.status || "completed",
  }).select("*").single();
  if (error) throw error;
  addAudit(actor, "oneroster.import.completed", data.id, meta.counts || {});
  return data;
}

export async function applyOneRosterMapping(records, actor) {
  if (isDemoMode) {
    const s = store();
    const byKey = (arr, key) => new Map(arr.map(r => [r[key], r]));
    function upsert(target, items, key) {
      const m = byKey(target, key);
      items.forEach(it => {
        const existing = m.get(it[key]);
        if (existing) Object.assign(existing, it);
        else target.push(it);
      });
    }
    upsert(s.campuses, records.campuses || [], "id");
    upsert(s.school_years, records.school_years || [], "id");
    upsert(s.terms, records.terms || [], "id");
    upsert(s.courses, records.courses || [], "id");
    upsert(s.course_sections, records.course_sections || [], "id");
    upsert(s.teachers, records.teachers || [], "id");
    upsert(s.students, records.students || [], "id");
    upsert(s.student_enrollments, records.student_enrollments || [], "id");
    upsert(s.teacher_class_assignments, records.teacher_class_assignments || [], "id");
    addAudit(actor, "oneroster.mapping.applied", "operational", {
      campuses: (records.campuses || []).length,
      students: (records.students || []).length,
      teachers: (records.teachers || []).length,
      courses: (records.courses || []).length,
      classes: (records.course_sections || []).length,
      enrollments: (records.student_enrollments || []).length,
    });
    persist();
    return true;
  }
  // Live mode — bulk upsert on the operational tables, matched by sourcedId.
  const upsertBatch = async (table, rows, conflictKey) => {
    if (!rows || !rows.length) return;
    const cleaned = rows.map(r => ({ ...r }));
    cleaned.forEach(r => { delete r.id; }); // let DB generate UUIDs; match by sourcedId
    const { error } = await supabase.from(table).upsert(cleaned, { onConflict: conflictKey });
    if (error) throw error;
  };
  await upsertBatch("campuses",                 records.campuses,                 "oneroster_org_sourced_id");
  await upsertBatch("school_years",             records.school_years,             "oneroster_academic_session_sourced_id");
  await upsertBatch("terms",                    records.terms,                    "oneroster_academic_session_sourced_id");
  await upsertBatch("courses",                  records.courses,                  "oneroster_course_sourced_id");
  await upsertBatch("course_sections",          records.course_sections,          "oneroster_class_sourced_id");
  await upsertBatch("teachers",                 records.teachers,                 "oneroster_user_sourced_id");
  await upsertBatch("students",                 records.students,                 "oneroster_user_sourced_id");
  await upsertBatch("student_enrollments",      records.student_enrollments,      "oneroster_enrollment_sourced_id");
  await upsertBatch("teacher_class_assignments",records.teacher_class_assignments,"oneroster_enrollment_sourced_id");
  addAudit(actor, "oneroster.mapping.applied", "operational", {
    campuses: (records.campuses || []).length,
    students: (records.students || []).length,
    teachers: (records.teachers || []).length,
    courses: (records.courses || []).length,
    classes: (records.course_sections || []).length,
    enrollments: (records.student_enrollments || []).length,
  });
  return true;
}

export async function recordTestImport(meta, actor) {
  if (isDemoMode) {
    const s = store();
    const row = { id: uid("ti"), uploaded_at: new Date().toISOString(), uploaded_by: actor, ...meta };
    s.test_imports.unshift(row);
    addAudit(actor, "test.import.completed", row.id, meta);
    persist();
    return row;
  }
  const { data, error } = await supabase.from("test_imports").insert({
    course_id: meta.course_id || null,
    test_id: meta.test_id || null,
    booklet_filename: meta.booklet_filename || null,
    answer_key_filename: meta.answer_key_filename || null,
    detected_questions: meta.detected_questions || 0,
    uploaded_images: meta.uploaded_images || 0,
    status: meta.status || "completed",
  }).select("*").single();
  if (error) throw error;
  addAudit(actor, "test.import.completed", data.id, meta);
  return data;
}

export async function updateSettings(patch, actor) {
  if (isDemoMode) {
    const s = store();
    Object.assign(s.app_settings, patch);
    addAudit(actor, "settings.updated", "app_settings", patch);
    persist();
    return s.app_settings;
  }
  const { data, error } = await supabase.from("app_settings")
    .update(patch).eq("id", 1).select("*").single();
  if (error) throw error;
  addAudit(actor, "settings.updated", "app_settings", patch);
  return data;
}

// ---------------------------------------------------------------------------
// FILE UPLOADS
// ---------------------------------------------------------------------------

export async function uploadQuestionImage(file) {
  if (isDemoMode) {
    return await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
  }
  const path = `uploads/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const { error } = await supabase.storage.from("question-images").upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type || "image/png",
  });
  if (error) throw error;
  const { data } = supabase.storage.from("question-images").getPublicUrl(path);
  return data.publicUrl;
}

// ---------------------------------------------------------------------------
// INTEGRATIONS / SECRETS / WHITELIST
// ---------------------------------------------------------------------------

// Front-end-known integration slots, used to render the UI even before any
// secrets exist in the DB.
export const INTEGRATION_CATALOG = [
  {
    category: "oneroster_api",
    name: "Infinite Campus — OneRoster REST API",
    description: "OAuth 2.0 client_credentials pull of rosters, classes, and enrollments on a nightly + evening schedule.",
    fields: [
      { key: "oneroster_api_client_id",     label: "Client ID",     type: "text" },
      { key: "oneroster_api_client_secret", label: "Client secret", type: "password", secret: true },
      { key: "oneroster_api_token_url",     label: "Token URL",     type: "text",     placeholder: "https://…/campus/oauth2/token?appName=hpa" },
      { key: "oneroster_api_base_url",      label: "Base URL",      type: "text",     placeholder: "https://…/campus/api/oneroster/v1p2/…/ims/oneroster" },
    ],
    canRunNow: true,
  },
  {
    category: "email",
    name: "Email — SendGrid",
    description: "Used for staff invitation emails (v2).",
    fields: [
      { key: "sendgrid_api_key",    label: "API key",   type: "password", secret: true },
      { key: "sendgrid_from_email", label: "From email", type: "text",     placeholder: "assessments@hpa.org" },
    ],
  },
];

export async function listSecrets() {
  if (isDemoMode) {
    // Return the catalog fields as "not configured"
    return INTEGRATION_CATALOG.flatMap(it => it.fields.map(f => ({
      name: f.key, category: it.category, description: f.label,
      configured: false, updated_at: null, updated_by_email: null,
    })));
  }
  const { data, error } = await supabase.rpc("secrets_list");
  if (error) throw error;
  return data || [];
}

export async function setSecret(name, value, category, description) {
  if (isDemoMode) return { ok: true };
  const { error } = await supabase.rpc("secret_set", {
    p_name: name, p_value: value || null,
    p_category: category || null, p_description: description || null,
  });
  if (error) throw error;
  return { ok: true };
}

export async function clearSecret(name) {
  if (isDemoMode) return { ok: true };
  const { error } = await supabase.rpc("secret_clear", { p_name: name });
  if (error) throw error;
  return { ok: true };
}

export async function deleteSecret(name) {
  if (isDemoMode) return { ok: true };
  const { error } = await supabase.rpc("secret_delete", { p_name: name });
  if (error) throw error;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// WHITELIST
// ---------------------------------------------------------------------------

export async function listWhitelist() {
  if (isDemoMode) return [];
  const { data, error } = await supabase.rpc("whitelist_list");
  if (error) throw error;
  return data || [];
}

export async function upsertWhitelist(entry) {
  if (isDemoMode) return { ok: true };
  const { error } = await supabase.rpc("whitelist_upsert", {
    p_email: entry.email,
    p_role: entry.role,
    p_campus_id: entry.campus_id || null,
    p_teacher_id: entry.teacher_id || null,
    p_tenant_hint: entry.tenant_hint || null,
  });
  if (error) throw error;
  return { ok: true };
}

export async function deleteWhitelist(email) {
  if (isDemoMode) return { ok: true };
  const { error } = await supabase.rpc("whitelist_delete", { p_email: email });
  if (error) throw error;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SYNC RUNS (integration run history)
// ---------------------------------------------------------------------------

export async function recordSyncRun({ category, source, status, row_counts, error_message, details, started_at }) {
  if (isDemoMode) return { id: uid("sync") };
  const { data, error } = await supabase.rpc("record_sync_run", {
    p_category: category,
    p_source: source,
    p_status: status,
    p_row_counts: row_counts || {},
    p_error_message: error_message || null,
    p_details: details || {},
    p_started_at: started_at || null,
  });
  if (error) throw error;
  return { id: data };
}

export async function listSyncRunsLatest() {
  if (isDemoMode) return [];
  const { data, error } = await supabase.rpc("sync_runs_latest");
  if (error) throw error;
  return data || [];
}

export async function listSyncRunsRecent({ category = null, limit = 20 } = {}) {
  if (isDemoMode) return [];
  const { data, error } = await supabase.rpc("sync_runs_recent", {
    p_category: category, p_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

// Trigger the OneRoster REST API Edge Function manually. Super-admin only —
// server-side checks will reject non-super callers, we also optimistically
// gate the UI button. Returns { run_id, status, row_counts, warnings } on
// success, or throws with the server's error message on failure.
export async function invokeOneRosterApiSync() {
  if (isDemoMode) {
    return { ok: true, status: "success", row_counts: { students: 0, teachers: 0 }, simulated: true };
  }
  const { data, error } = await supabase.functions.invoke("oneroster-api-sync", {
    body: { source: "manual" },
  });
  if (error) {
    // supabase.functions.invoke wraps the body in `error.context` when the
    // function returns a non-2xx — surface that message.
    let msg = error.message || "Sync failed";
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch { /* noop */ }
    throw new Error(msg);
  }
  if (data && data.ok === false) {
    throw new Error(data.error || "Sync failed");
  }
  return data;
}
