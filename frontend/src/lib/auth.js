// Auth helpers — supports BOTH staff (email+password) and students (Student ID).
// Demo mode uses the seed.staff_users list; Supabase mode would call supabase.auth.signInWithPassword.

import { isDemoMode, supabase } from "./supabase";
import { staff_users } from "./demoData";
import { lookupStudentById, addAudit } from "./api";

const STAFF_KEY = "hpa.staffSession";
const STUDENT_KEY = "hpa.studentSession";

export async function staffSignIn(email, password) {
  if (isDemoMode) {
    const u = staff_users.find(x => x.email.toLowerCase() === email.toLowerCase() && x.password === password);
    if (!u) throw new Error("Invalid email or password.");
    const session = { kind: "staff", email: u.email, role: u.role, name: u.name, campus_id: u.campus_id, teacher_id: u.teacher_id || null };
    localStorage.setItem(STAFF_KEY, JSON.stringify(session));
    addAudit(u.email, "auth.staff.login", u.email, {});
    return session;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  // Profile + role lookup
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  const session = {
    kind: "staff",
    email: data.user.email,
    role: profile?.role || "teacher",
    name: profile?.name || data.user.email,
    campus_id: profile?.campus_id || null,
    teacher_id: profile?.teacher_id || null,
  };
  localStorage.setItem(STAFF_KEY, JSON.stringify(session));
  return session;
}

export async function studentSignIn(studentId) {
  const s = await lookupStudentById(studentId);
  if (!s) throw new Error("Student ID not found. Please check the ID with your teacher.");
  const session = {
    kind: "student", id: s.id, student_id: s.student_id,
    name: `${s.first_name} ${s.last_name}`, campus_id: s.campus_id,
  };
  localStorage.setItem(STUDENT_KEY, JSON.stringify(session));
  return session;
}

export function getStaffSession() {
  try { return JSON.parse(localStorage.getItem(STAFF_KEY) || "null"); } catch { return null; }
}
export function getStudentSession() {
  try { return JSON.parse(localStorage.getItem(STUDENT_KEY) || "null"); } catch { return null; }
}
export function signOutAll() {
  localStorage.removeItem(STAFF_KEY);
  localStorage.removeItem(STUDENT_KEY);
  if (!isDemoMode && supabase) supabase.auth.signOut();
}
export function signOutStudent() { localStorage.removeItem(STUDENT_KEY); }
export function signOutStaff() {
  localStorage.removeItem(STAFF_KEY);
  if (!isDemoMode && supabase) supabase.auth.signOut();
}
