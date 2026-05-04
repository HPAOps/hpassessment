// In-memory demo dataset. Mirrors the Supabase schema closely so the same
// API surface (lib/api.js) can swap to real Supabase later.

const now = () => new Date().toISOString();

// --- Campuses --------------------------------------------------------------
export const campuses = [
  { id: "c-mhp", name: "Madison Highland Prep", code: "MHP", oneroster_org_sourced_id: "ORG-MHP", is_active: true },
  { id: "c-hp",  name: "Highland Prep",         code: "HP",  oneroster_org_sourced_id: "ORG-HP",  is_active: true },
  { id: "c-hpw", name: "Highland Prep West",    code: "HPW", oneroster_org_sourced_id: "ORG-HPW", is_active: true },
];

// --- School Years / Terms ---------------------------------------------------
export const school_years = [
  { id: "sy-2526", name: "2025-2026", start_date: "2025-08-04", end_date: "2026-05-22", is_active: false, oneroster_academic_session_sourced_id: "AS-2526" },
  { id: "sy-2627", name: "2026-2027", start_date: "2026-08-03", end_date: "2027-05-21", is_active: true,  oneroster_academic_session_sourced_id: "AS-2627" },
];
export const terms = [
  { id: "t-2627-s1", name: "Semester 1", school_year_id: "sy-2627", start_date: "2026-08-03", end_date: "2026-12-18", oneroster_academic_session_sourced_id: "AS-2627-S1" },
  { id: "t-2627-s2", name: "Semester 2", school_year_id: "sy-2627", start_date: "2027-01-05", end_date: "2027-05-21", oneroster_academic_session_sourced_id: "AS-2627-S2" },
];

// --- Courses (full 22-course placeholder set) ------------------------------
const courseTitles = [
  "Algebra 1A","Algebra 1B","Algebra 2A","Algebra 2B",
  "Geometry A","Geometry B","Pre-Calculus A","Pre-Calculus B",
  "Biology A","Biology B","Chemistry A","Chemistry B",
  "Physics A","Physics B","English 9A","English 9B",
  "English 10A","English 10B","World History A","World History B",
  "US History A","US History B",
];
export const courses = courseTitles.map((title, i) => ({
  id: `course-${i + 1}`,
  code: title.toUpperCase().replace(/[^A-Z0-9]+/g, "-"),
  title,
  oneroster_course_sourced_id: `OR-COURSE-${i + 1}`,
  school_year_id: "sy-2627",
  is_active: true,
}));

// --- Course Sections (classes) ---------------------------------------------
// Section IDs are stable for selected courses (Algebra 1A/1B) so we can wire
// teacher assignments + enrollments deterministically.
export const course_sections = [
  // Algebra 1A across 3 campuses
  { id: "cs-alg1a-mhp",  course_id: "course-1", campus_id: "c-mhp", term_id: "t-2627-s1", section_code: "ALG1A-101", oneroster_class_sourced_id: "OR-CLS-ALG1A-MHP" },
  { id: "cs-alg1a-hp",   course_id: "course-1", campus_id: "c-hp",  term_id: "t-2627-s1", section_code: "ALG1A-201", oneroster_class_sourced_id: "OR-CLS-ALG1A-HP" },
  { id: "cs-alg1a-hpw",  course_id: "course-1", campus_id: "c-hpw", term_id: "t-2627-s1", section_code: "ALG1A-301", oneroster_class_sourced_id: "OR-CLS-ALG1A-HPW" },
  // Algebra 1B across 3 campuses
  { id: "cs-alg1b-mhp",  course_id: "course-2", campus_id: "c-mhp", term_id: "t-2627-s2", section_code: "ALG1B-101", oneroster_class_sourced_id: "OR-CLS-ALG1B-MHP" },
  { id: "cs-alg1b-hp",   course_id: "course-2", campus_id: "c-hp",  term_id: "t-2627-s2", section_code: "ALG1B-201", oneroster_class_sourced_id: "OR-CLS-ALG1B-HP" },
  // Biology A
  { id: "cs-biola-mhp",  course_id: "course-9", campus_id: "c-mhp", term_id: "t-2627-s1", section_code: "BIOA-101", oneroster_class_sourced_id: "OR-CLS-BIOA-MHP" },
];

// --- Teachers ---------------------------------------------------------------
export const teachers = [
  { id: "t-1", first_name: "Alicia",   last_name: "Reyes",     email: "areyes@hpa.test",    campus_id: "c-mhp", oneroster_user_sourced_id: "OR-T-1", is_active: true },
  { id: "t-2", first_name: "Marcus",   last_name: "Tran",      email: "mtran@hpa.test",     campus_id: "c-hp",  oneroster_user_sourced_id: "OR-T-2", is_active: true },
  { id: "t-3", first_name: "Priya",    last_name: "Iyer",      email: "piyer@hpa.test",     campus_id: "c-hpw", oneroster_user_sourced_id: "OR-T-3", is_active: true },
  { id: "t-4", first_name: "Jordan",   last_name: "Whitfield", email: "jwhitfield@hpa.test",campus_id: "c-mhp", oneroster_user_sourced_id: "OR-T-4", is_active: true },
  { id: "t-5", first_name: "Sofia",    last_name: "Becerra",   email: "sbecerra@hpa.test",  campus_id: "c-hp",  oneroster_user_sourced_id: "OR-T-5", is_active: true },
];

// --- Teacher → Class Assignments -------------------------------------------
export const teacher_class_assignments = [
  { id: "tca-1", teacher_id: "t-1", course_section_id: "cs-alg1a-mhp", oneroster_enrollment_sourced_id: "OR-E-T-1" },
  { id: "tca-2", teacher_id: "t-2", course_section_id: "cs-alg1a-hp",  oneroster_enrollment_sourced_id: "OR-E-T-2" },
  { id: "tca-3", teacher_id: "t-3", course_section_id: "cs-alg1a-hpw", oneroster_enrollment_sourced_id: "OR-E-T-3" },
  { id: "tca-4", teacher_id: "t-1", course_section_id: "cs-alg1b-mhp", oneroster_enrollment_sourced_id: "OR-E-T-4" },
  { id: "tca-5", teacher_id: "t-2", course_section_id: "cs-alg1b-hp",  oneroster_enrollment_sourced_id: "OR-E-T-5" },
  { id: "tca-6", teacher_id: "t-4", course_section_id: "cs-biola-mhp", oneroster_enrollment_sourced_id: "OR-E-T-6" },
];

// --- Students (30) ---------------------------------------------------------
const firstNames = ["Liam","Ava","Noah","Mia","Ethan","Sophia","Mason","Isabella","Lucas","Olivia","Logan","Emma","Aiden","Harper","Caleb","Charlotte","Jackson","Amelia","Carter","Evelyn","Wyatt","Abigail","Elijah","Ella","Henry","Scarlett","Owen","Aria","Daniel","Layla"];
const lastNames  = ["Garcia","Smith","Johnson","Lee","Brown","Davis","Martinez","Wilson","Anderson","Taylor","Thomas","Hernandez","Moore","White","Clark","Lewis","Walker","Young","Allen","King","Scott","Green","Baker","Hill","Adams","Nelson","Carter","Mitchell","Roberts","Turner"];

export const students = Array.from({ length: 30 }).map((_, i) => {
  const id = String(100001 + i);
  const campusId = ["c-mhp","c-hp","c-hpw"][i % 3];
  return {
    id: `s-${id}`,
    student_id: id,
    first_name: firstNames[i],
    last_name: lastNames[i],
    grade_level: 9 + (i % 4),
    campus_id: campusId,
    email: `${firstNames[i].toLowerCase()}.${lastNames[i].toLowerCase()}@students.hpa.test`,
    oneroster_user_sourced_id: `OR-S-${id}`,
    is_active: true,
  };
});

// --- Student → Class Enrollments -------------------------------------------
// Map every student to their campus's Algebra 1A section + half also to 1B.
export const student_enrollments = students.flatMap((s, idx) => {
  const campusToAlg1a = { "c-mhp": "cs-alg1a-mhp", "c-hp": "cs-alg1a-hp", "c-hpw": "cs-alg1a-hpw" };
  const campusToAlg1b = { "c-mhp": "cs-alg1b-mhp", "c-hp": "cs-alg1b-hp" };
  const enrolls = [{
    id: `e-${s.id}-alg1a`,
    student_id: s.id,
    course_section_id: campusToAlg1a[s.campus_id],
    oneroster_enrollment_sourced_id: `OR-E-${s.student_id}-A`,
    status: "active",
  }];
  if (idx % 2 === 0 && campusToAlg1b[s.campus_id]) {
    enrolls.push({
      id: `e-${s.id}-alg1b`,
      student_id: s.id,
      course_section_id: campusToAlg1b[s.campus_id],
      oneroster_enrollment_sourced_id: `OR-E-${s.student_id}-B`,
      status: "active",
    });
  }
  // Some students also in Biology A at MHP
  if (s.campus_id === "c-mhp" && idx % 3 === 0) {
    enrolls.push({
      id: `e-${s.id}-biola`,
      student_id: s.id,
      course_section_id: "cs-biola-mhp",
      oneroster_enrollment_sourced_id: `OR-E-${s.student_id}-BIO`,
      status: "active",
    });
  }
  return enrolls;
});

// --- Tests -----------------------------------------------------------------
export const tests = [
  { id: "test-alg1a-boc", name: "Algebra 1A Beginning of Course", course_id: "course-1", test_type: "BOC", school_year_id: "sy-2627", scope: "district", question_count: 10, is_published: true, opens_at: "2026-08-03", closes_at: "2026-08-31" },
  { id: "test-alg1a-eoc", name: "Algebra 1A End of Course",       course_id: "course-1", test_type: "EOC", school_year_id: "sy-2627", scope: "district", question_count: 10, is_published: true, opens_at: "2026-12-01", closes_at: "2026-12-19" },
  { id: "test-alg1b-boc", name: "Algebra 1B Beginning of Course", course_id: "course-2", test_type: "BOC", school_year_id: "sy-2627", scope: "district", question_count: 8,  is_published: true, opens_at: "2027-01-05", closes_at: "2027-01-31" },
  { id: "test-alg1b-eoc", name: "Algebra 1B End of Course",       course_id: "course-2", test_type: "EOC", school_year_id: "sy-2627", scope: "district", question_count: 8,  is_published: true, opens_at: "2027-04-15", closes_at: "2027-05-22" },
  { id: "test-biola-boc", name: "Biology A Beginning of Course",  course_id: "course-9", test_type: "BOC", school_year_id: "sy-2627", scope: "district", question_count: 6,  is_published: true, opens_at: "2026-08-03", closes_at: "2026-08-31" },
];

// --- Questions --------------------------------------------------------------
// Use picsum.photos as deterministic placeholder question images.
function buildQuestions(testId, count, seedOffset) {
  return Array.from({ length: count }).map((_, i) => {
    const qn = i + 1;
    const correct = ["A","B","C","D"][(seedOffset + i) % 4];
    return {
      id: `${testId}-q${qn}`,
      test_id: testId,
      question_number: qn,
      image_url: `https://picsum.photos/seed/${testId}-q${qn}/1000/640`,
      correct_answer: correct,
      standard_tag: ["A.SSE.1","A.REI.3","F.LE.1","S.ID.6","N.RN.2"][i % 5],
      difficulty: ["easy","medium","hard"][i % 3],
      is_active: true,
    };
  });
}
export const questions = [
  ...buildQuestions("test-alg1a-boc", 10, 0),
  ...buildQuestions("test-alg1a-eoc", 10, 1),
  ...buildQuestions("test-alg1b-boc", 8, 2),
  ...buildQuestions("test-alg1b-eoc", 8, 3),
  ...buildQuestions("test-biola-boc", 6, 1),
];

// --- Test Attempts (some pre-seeded so dashboards show data) ---------------
function pickAnswer(correct, accuracy) {
  if (Math.random() < accuracy) return correct;
  const choices = ["A","B","C","D"].filter(c => c !== correct);
  return choices[Math.floor(Math.random() * choices.length)];
}
function buildAttempt(student, testId, accuracy, completedAt) {
  const qs = questions.filter(q => q.test_id === testId);
  const order = [...qs].sort(() => Math.random() - 0.5).map(q => q.id);
  const responses = qs.map(q => ({
    question_id: q.id,
    selected_answer: pickAnswer(q.correct_answer, accuracy),
  }));
  const correct = responses.filter(r => {
    const q = qs.find(x => x.id === r.question_id);
    return q && q.correct_answer === r.selected_answer;
  }).length;
  const score_percent = Math.round((correct / qs.length) * 100);
  return {
    id: `att-${student.id}-${testId}`,
    student_id: student.id,
    test_id: testId,
    course_section_id: student_enrollments.find(e => e.student_id === student.id && course_sections.find(cs => cs.id === e.course_section_id && cs.course_id === tests.find(t => t.id === testId)?.course_id))?.course_section_id,
    question_order: order,
    responses,
    score_percent,
    correct_count: correct,
    total_count: qs.length,
    status: "submitted",
    started_at: completedAt,
    submitted_at: completedAt,
  };
}

export let test_attempts = [];
// Seed roughly: 24 students completed Alg1A BOC (avg ~45%), 18 completed Alg1A EOC (avg ~70%)
students.slice(0, 24).forEach((s, i) => {
  test_attempts.push(buildAttempt(s, "test-alg1a-boc", 0.40 + (i % 6) * 0.04, "2026-08-15T10:00:00Z"));
});
students.slice(0, 18).forEach((s, i) => {
  test_attempts.push(buildAttempt(s, "test-alg1a-eoc", 0.65 + (i % 6) * 0.04, "2026-12-12T10:00:00Z"));
});
// A few Alg1B BOC
students.slice(0, 12).filter((_, i) => i % 2 === 0).forEach((s, i) => {
  test_attempts.push(buildAttempt(s, "test-alg1b-boc", 0.50 + (i % 5) * 0.04, "2027-01-15T10:00:00Z"));
});

// --- Growth Results (computed from attempts) -------------------------------
export const growth_results = (() => {
  const out = [];
  const courseToTests = {};
  tests.forEach(t => {
    courseToTests[t.course_id] = courseToTests[t.course_id] || {};
    courseToTests[t.course_id][t.test_type] = t.id;
  });
  Object.entries(courseToTests).forEach(([courseId, byType]) => {
    if (!byType.BOC || !byType.EOC) return;
    students.forEach(s => {
      const boc = test_attempts.find(a => a.student_id === s.id && a.test_id === byType.BOC);
      const eoc = test_attempts.find(a => a.student_id === s.id && a.test_id === byType.EOC);
      if (boc && eoc) {
        const point_diff = eoc.score_percent - boc.score_percent;
        const available = 100 - boc.score_percent;
        const growth_pct = available <= 0 ? null : Math.round((point_diff / available) * 100);
        out.push({
          id: `gr-${s.id}-${courseId}`,
          student_id: s.id,
          course_id: courseId,
          school_year_id: "sy-2627",
          boc_score: boc.score_percent,
          eoc_score: eoc.score_percent,
          point_difference: point_diff,
          growth_percentage: growth_pct,
        });
      }
    });
  });
  return out;
})();

// --- Audit Log seed --------------------------------------------------------
export const audit_logs = [
  { id: "al-1", actor: "super@hpa.test", action: "oneroster.import.completed", target: "import-2026-08-01", details: { users: 122, enrollments: 305 }, created_at: now() },
  { id: "al-2", actor: "super@hpa.test", action: "test.published",            target: "test-alg1a-boc",   details: { course: "Algebra 1A" }, created_at: now() },
  { id: "al-3", actor: "district@hpa.test", action: "answer_key.updated",      target: "test-alg1a-eoc",   details: { question_number: 7, from: "B", to: "C" }, created_at: now() },
];

// --- App Settings -----------------------------------------------------------
export const app_settings = {
  show_score_to_student: false,
  enable_timer: false,
  default_test_minutes: 60,
  allow_test_retakes: false,
  require_teacher_verification: true,
  random_question_order: true,
  campus_specific_windows: false,
  test_locked_message: "This test is currently closed. Please see your teacher.",
  maintenance_mode: false,
  show_question_analysis_to_teachers: true,
  campus_admins_can_reset_attempts: true,
  teachers_can_view_scores: true,
  teachers_can_export_results: false,
};

// --- Staff users (demo) ----------------------------------------------------
export const staff_users = [
  { email: "super@hpa.test",    password: "Hpa12345!", role: "super_admin",    name: "Sam Powell",      campus_id: null },
  { email: "district@hpa.test", password: "Hpa12345!", role: "district_admin", name: "Diana Reyes",     campus_id: null },
  { email: "madison@hpa.test",  password: "Hpa12345!", role: "campus_admin",   name: "Marcus Cole",     campus_id: "c-mhp" },
  { email: "teacher@hpa.test",  password: "Hpa12345!", role: "teacher",        name: "Alicia Reyes",    campus_id: "c-mhp", teacher_id: "t-1" },
];

// --- OneRoster import history (seeded) -------------------------------------
export const oneroster_imports = [
  {
    id: "imp-2026-08-01",
    uploaded_by: "super@hpa.test",
    uploaded_at: "2026-08-01T15:30:00Z",
    filename: "oneroster_2026_08_01.zip",
    files_seen: ["manifest.csv","academicSessions.csv","classes.csv","courses.csv","demographics.csv","enrollments.csv","orgs.csv","users.csv"],
    counts: { users: 122, students: 86, teachers: 36, orgs: 3, courses: 22, classes: 41, enrollments: 305, demographics: 86 },
    errors: [],
    status: "completed",
  },
];

// --- Test imports (seeded) -------------------------------------------------
export const test_imports = [
  {
    id: "ti-1",
    course_id: "course-1",
    test_id: "test-alg1a-boc",
    uploaded_by: "super@hpa.test",
    uploaded_at: "2026-08-02T11:12:00Z",
    booklet_filename: "algebra_1a_boc_booklet.docx",
    answer_key_filename: "algebra_1a_boc_key.docx",
    detected_questions: 10,
    uploaded_images: 10,
    status: "completed",
  },
];
