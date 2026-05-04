import JSZip from "jszip";
import Papa from "papaparse";

export const ONEROSTER_FILES = [
  "manifest.csv",
  "academicSessions.csv",
  "classes.csv",
  "courses.csv",
  "demographics.csv",
  "enrollments.csv",
  "orgs.csv",
  "users.csv",
];

function parseCsv(text) {
  const result = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
  return { rows: result.data, errors: result.errors };
}

export async function parseOneRosterZip(file) {
  const zip = await JSZip.loadAsync(file);
  const filesSeen = [];
  const missing = [];
  const data = {};
  const errors = [];

  for (const name of ONEROSTER_FILES) {
    const entry = zip.file(name) || zip.file(name.toLowerCase());
    if (!entry) {
      missing.push(name);
      continue;
    }
    filesSeen.push(name);
    const text = await entry.async("string");
    const { rows, errors: parseErrors } = parseCsv(text);
    data[name.replace(".csv", "")] = rows;
    parseErrors.forEach(e => errors.push({ file: name, message: e.message, row: e.row }));
  }

  return { filesSeen, missing, data, errors };
}

// Map raw OneRoster rows to operational records used by the app.
// Returns counts + the mapped records so the UI can display a preview.
export function mapOneRosterToOperational(parsed) {
  const out = {
    campuses: [], school_years: [], terms: [], students: [], teachers: [],
    courses: [], course_sections: [], student_enrollments: [], teacher_class_assignments: [],
  };
  const counts = { users: 0, students: 0, teachers: 0, orgs: 0, courses: 0, classes: 0, enrollments: 0, demographics: 0 };

  // ORGs → campuses (orgType school)
  const orgs = parsed.data.orgs || [];
  counts.orgs = orgs.length;
  orgs.forEach(o => {
    if ((o.type || "").toLowerCase().includes("school") || (o.orgType || "").toLowerCase().includes("school") || !o.type) {
      out.campuses.push({
        id: o.sourcedId,
        oneroster_org_sourced_id: o.sourcedId,
        name: o.name,
        code: o.identifier || (o.name ? o.name.replace(/[^A-Z0-9]+/gi, "").slice(0, 6).toUpperCase() : ""),
        is_active: (o.status || "active").toLowerCase() === "active",
      });
    }
  });

  // Academic sessions → school years/terms
  const sessions = parsed.data.academicSessions || [];
  sessions.forEach(s => {
    const type = (s.type || "").toLowerCase();
    if (type === "schoolyear" || type === "school_year") {
      out.school_years.push({
        id: s.sourcedId, oneroster_academic_session_sourced_id: s.sourcedId,
        name: s.title || s.name || s.sourcedId,
        start_date: s.startDate, end_date: s.endDate, is_active: true,
      });
    } else {
      out.terms.push({
        id: s.sourcedId, oneroster_academic_session_sourced_id: s.sourcedId,
        name: s.title || s.name || s.sourcedId,
        start_date: s.startDate, end_date: s.endDate,
        school_year_id: s.parentSourcedId || null,
      });
    }
  });

  // Courses
  const courses = parsed.data.courses || [];
  counts.courses = courses.length;
  courses.forEach(c => out.courses.push({
    id: c.sourcedId, oneroster_course_sourced_id: c.sourcedId,
    code: c.courseCode || c.identifier || c.sourcedId,
    title: c.title, school_year_id: c.schoolYearSourcedId || c.orgSourcedId || null,
    is_active: (c.status || "active").toLowerCase() === "active",
  }));

  // Classes
  const classes = parsed.data.classes || [];
  counts.classes = classes.length;
  classes.forEach(cl => out.course_sections.push({
    id: cl.sourcedId, oneroster_class_sourced_id: cl.sourcedId,
    course_id: cl.courseSourcedId, campus_id: cl.schoolSourcedId,
    term_id: cl.termSourcedIds || cl.termSourcedId || null,
    section_code: cl.classCode || cl.title || cl.sourcedId,
  }));

  // Users → teachers/students
  const users = parsed.data.users || [];
  counts.users = users.length;
  users.forEach(u => {
    const role = (u.role || "").toLowerCase();
    if (role === "student") {
      counts.students += 1;
      out.students.push({
        id: u.sourcedId, oneroster_user_sourced_id: u.sourcedId,
        student_id: u.identifier || u.username || u.sourcedId,
        first_name: u.givenName, last_name: u.familyName,
        email: u.email, grade_level: parseInt(u.grades || "9", 10) || null,
        campus_id: (u.orgSourcedIds || u.primaryOrgSourcedId || "").split(",")[0] || null,
        is_active: (u.status || "active").toLowerCase() === "active",
      });
    } else if (role === "teacher" || role === "aide") {
      counts.teachers += 1;
      out.teachers.push({
        id: u.sourcedId, oneroster_user_sourced_id: u.sourcedId,
        first_name: u.givenName, last_name: u.familyName, email: u.email,
        campus_id: (u.orgSourcedIds || u.primaryOrgSourcedId || "").split(",")[0] || null,
        is_active: (u.status || "active").toLowerCase() === "active",
      });
    }
  });

  // Enrollments
  const enr = parsed.data.enrollments || [];
  counts.enrollments = enr.length;
  enr.forEach(e => {
    const role = (e.role || "").toLowerCase();
    if (role === "student") {
      out.student_enrollments.push({
        id: e.sourcedId, oneroster_enrollment_sourced_id: e.sourcedId,
        student_id: e.userSourcedId, course_section_id: e.classSourcedId,
        status: (e.status || "active").toLowerCase(),
      });
    } else if (role === "teacher" || role === "aide") {
      out.teacher_class_assignments.push({
        id: e.sourcedId, oneroster_enrollment_sourced_id: e.sourcedId,
        teacher_id: e.userSourcedId, course_section_id: e.classSourcedId,
      });
    }
  });

  counts.demographics = (parsed.data.demographics || []).length;
  return { records: out, counts };
}
