// Unified data-access layer.
// In demo mode it uses a localStorage-backed snapshot of demoData.js.
// When Supabase env vars are configured (see lib/supabase.js), each function
// can be swapped to call supabase.from(...).select() with equivalent shapes.
// All write paths in demo mode persist to localStorage so refreshes survive.

import * as seed from "./demoData";
import { supabase, isDemoMode } from "./supabase";
import { scoreAttempt, computeGrowth, shuffleSeeded } from "./scoring";

const STORAGE_KEY = "hpa.demo.v1";

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
  if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
  _store = null;
  return store();
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
  const all = isDemoMode
    ? store().teachers
    : (await supabase.from("teachers").select("*")).data || [];
  return campusId ? all.filter(t => t.campus_id === campusId) : all;
}

export async function listStudents(campusId = null) {
  const all = isDemoMode
    ? store().students
    : (await supabase.from("students").select("*")).data || [];
  return campusId ? all.filter(s => s.campus_id === campusId) : all;
}

export async function listTests() {
  if (isDemoMode) return store().tests;
  const { data, error } = await supabase.from("tests").select("*");
  if (error) throw error;
  return data || [];
}

export async function listQuestionsForTest(testId) {
  if (isDemoMode) return store().questions.filter(q => q.test_id === testId);
  const { data, error } = await supabase.from("questions").select("*").eq("test_id", testId);
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
  return data || [];
}

export async function listGrowthResults() {
  if (isDemoMode) return store().growth_results;
  const { data, error } = await supabase.from("growth_results").select("*");
  if (error) throw error;
  return data || [];
}

export async function getSettings() {
  if (isDemoMode) return store().app_settings;
  const { data } = await supabase.from("app_settings").select("*").maybeSingle();
  return data || {};
}

export async function listAuditLogs(limit = 200) {
  if (isDemoMode) return [...store().audit_logs].sort((a,b)=> (b.created_at||"").localeCompare(a.created_at||"")).slice(0, limit);
  const { data } = await supabase.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(limit);
  return data || [];
}

export async function listOneRosterImports() {
  return isDemoMode ? store().oneroster_imports : ((await supabase.from("oneroster_imports").select("*").order("uploaded_at",{ascending:false})).data || []);
}

export async function listTestImports() {
  return isDemoMode ? store().test_imports : ((await supabase.from("test_imports").select("*").order("uploaded_at",{ascending:false})).data || []);
}

// ---------------------------------------------------------------------------
// STUDENT FLOW
// ---------------------------------------------------------------------------

export async function lookupStudentById(studentId) {
  if (isDemoMode) return store().students.find(s => s.student_id === studentId && s.is_active) || null;
  const { data } = await supabase.from("students").select("*").eq("student_id", studentId).eq("is_active", true).maybeSingle();
  return data || null;
}

// Returns the courses the student is currently enrolled in, with section + teacher.
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
  // Supabase equivalent left as nested select pattern
  return [];
}

export async function getOpenTestsForCourse(courseId) {
  const tests = await listTests();
  const today = new Date();
  return tests.filter(t => t.course_id === courseId && t.is_published &&
    (!t.opens_at || new Date(t.opens_at) <= today) &&
    (!t.closes_at || new Date(t.closes_at) >= today));
}

export async function findOrCreateAttempt(studentDbId, testId, courseSectionId) {
  const s = store();
  if (isDemoMode) {
    let existing = s.test_attempts.find(a => a.student_id === studentDbId && a.test_id === testId && a.status !== "submitted");
    if (existing) return existing;
    const submitted = s.test_attempts.find(a => a.student_id === studentDbId && a.test_id === testId && a.status === "submitted");
    if (submitted) return submitted;
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
  // Supabase: would call an RPC create_or_get_attempt(student_id, test_id, section_id)
  return null;
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
  // Supabase: upsert into student_responses
  return null;
}

export async function submitAttempt(attemptId) {
  const s = store();
  if (isDemoMode) {
    const att = s.test_attempts.find(a => a.id === attemptId);
    if (!att) throw new Error("Attempt not found");
    const qs = s.questions.filter(q => q.test_id === att.test_id);
    const result = scoreAttempt(att.responses, qs);
    Object.assign(att, result, { status: "submitted", submitted_at: new Date().toISOString() });
    // Update growth_results
    upsertGrowthForStudentCourse(att.student_id, qs[0]?.test_id ? s.tests.find(t=>t.id===att.test_id)?.course_id : null);
    addAudit("system", "test.submitted", att.id, { test_id: att.test_id, score: att.score_percent });
    persist();
    return att;
  }
  return null;
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
  return null;
}

// ---------------------------------------------------------------------------
// ADMIN: TESTS / QUESTIONS / ANSWER KEY
// ---------------------------------------------------------------------------

export async function createTest(test, actor) {
  const s = store();
  if (isDemoMode) {
    const row = { id: uid("test"), is_published: false, scope: "district", question_count: 0, ...test };
    s.tests.push(row);
    addAudit(actor, "test.created", row.id, { name: row.name });
    persist();
    return row;
  }
  return null;
}

export async function updateTest(testId, patch, actor) {
  const s = store();
  if (isDemoMode) {
    const t = s.tests.find(x => x.id === testId);
    if (!t) throw new Error("Test not found");
    Object.assign(t, patch);
    addAudit(actor, "test.updated", testId, patch);
    persist();
    return t;
  }
  return null;
}

export async function upsertQuestion(q, actor) {
  const s = store();
  if (isDemoMode) {
    let row = s.questions.find(x => x.id === q.id);
    if (!row) {
      row = { id: q.id || uid("q"), is_active: true, ...q };
      s.questions.push(row);
    } else {
      Object.assign(row, q);
    }
    // Update parent test count
    const t = s.tests.find(t => t.id === row.test_id);
    if (t) t.question_count = s.questions.filter(qq => qq.test_id === t.id).length;
    addAudit(actor, "question.upserted", row.id, { test_id: row.test_id, qn: row.question_number });
    persist();
    return row;
  }
  return null;
}

export async function deleteQuestion(questionId, actor) {
  const s = store();
  if (isDemoMode) {
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
  return null;
}

export async function recordOneRosterImport(meta, actor) {
  const s = store();
  if (isDemoMode) {
    const row = { id: uid("imp"), uploaded_at: new Date().toISOString(), uploaded_by: actor, ...meta };
    s.oneroster_imports.unshift(row);
    addAudit(actor, "oneroster.import.completed", row.id, meta.counts || {});
    persist();
    return row;
  }
  return null;
}

export async function applyOneRosterMapping(records, actor) {
  // Upsert by sourcedId across operational tables.
  if (!isDemoMode) return null;
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

export async function recordTestImport(meta, actor) {
  const s = store();
  if (isDemoMode) {
    const row = { id: uid("ti"), uploaded_at: new Date().toISOString(), uploaded_by: actor, ...meta };
    s.test_imports.unshift(row);
    addAudit(actor, "test.import.completed", row.id, meta);
    persist();
    return row;
  }
  return null;
}

export async function updateSettings(patch, actor) {
  const s = store();
  if (isDemoMode) {
    Object.assign(s.app_settings, patch);
    addAudit(actor, "settings.updated", "app_settings", patch);
    persist();
    return s.app_settings;
  }
  return null;
}

// ---------------------------------------------------------------------------
// AUDIT
// ---------------------------------------------------------------------------

export function addAudit(actor, action, target, details) {
  const s = store();
  s.audit_logs.unshift({
    id: uid("al"), actor: actor || "system", action, target,
    details: details || {}, created_at: new Date().toISOString(),
  });
  persist();
}

// ---------------------------------------------------------------------------
// FILE UPLOADS (demo: data URLs only). In Supabase mode would use storage.
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
  // Supabase storage upload to "question-images" bucket would go here.
  return null;
}
