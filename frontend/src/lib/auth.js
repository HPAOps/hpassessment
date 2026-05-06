// Auth helpers — supports BOTH staff (email+password) and students (Student ID).
// Demo mode uses the seed.staff_users list; Supabase mode would call supabase.auth.signInWithPassword.

import { isDemoMode, supabase } from "./supabase";
import { staff_users } from "./demoData";
import { lookupStudentById, addAudit } from "./api";

const STAFF_KEY = "hpa.staffSession";
const STUDENT_KEY = "hpa.studentSession";

export async function staffSignInWithMicrosoft() {
  if (isDemoMode) {
    throw new Error("Microsoft sign-in is available only in live mode. Set REACT_APP_FORCE_DEMO=false.");
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      scopes: "openid email profile offline_access",
      redirectTo: `${window.location.origin}/staff/oauth-callback`,
    },
  });
  if (error) throw error;
  return data;
}

// Called by the OAuth callback page after Supabase finishes the redirect.
export async function hydrateStaffSessionFromSupabase() {
  if (isDemoMode || !supabase) return null;

  // Wait briefly for Supabase to finish parsing the URL fragment into a session.
  let user = null;
  for (let i = 0; i < 6 && !user; i++) {
    const { data } = await supabase.auth.getUser();
    user = data?.user || null;
    if (!user) await new Promise(r => setTimeout(r, 250));
  }
  if (!user) return null;

  // Prefer the already-provisioned profile.
  let { data: profile } = await supabase
    .from("profiles").select("*").eq("id", user.id).maybeSingle();

  // If the trigger didn't create a profile (timing, whitelist added after
  // first sign-in, etc.), call the self-heal RPC. It re-checks the whitelist
  // and either provisions the profile or raises a clear error.
  if (!profile) {
    const { data, error } = await supabase.rpc("ensure_profile_from_whitelist");
    if (error) {
      // Propagate the Postgres exception message verbatim so the user sees
      // exactly why they're blocked (e.g., "email not authorized …").
      throw new Error(error.message);
    }
    profile = data;
  }

  if (!profile) {
    throw new Error("Your email is not yet authorized for HPA Growth Assessments. Please contact your district admin.");
  }

  const session = {
    kind: "staff",
    email: user.email,
    role: profile.role,
    name: profile.name || user.email,
    campus_id: profile.campus_id || null,
    teacher_id: profile.teacher_id || null,
    provider: user.app_metadata?.provider || "email",
  };
  localStorage.setItem(STAFF_KEY, JSON.stringify(session));
  return session;
}

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
  // Profile + role lookup. If a profile is missing we MUST NOT silently
  // assume "teacher" — that masks whitelist/profile sync bugs and gave a
  // user the wrong sidebar in production. Self-heal from the whitelist
  // (same path the OAuth callback uses) so the role comes from a single
  // authoritative source.
  let { data: profile } = await supabase
    .from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  if (!profile) {
    const { data: healed, error: healErr } = await supabase.rpc("ensure_profile_from_whitelist");
    if (healErr) {
      await supabase.auth.signOut();
      throw new Error(healErr.message);
    }
    profile = healed;
  }
  if (!profile) {
    await supabase.auth.signOut();
    throw new Error("Your email is not yet authorized for HPA Growth Assessments. Please contact your district admin.");
  }
  const session = {
    kind: "staff",
    email: data.user.email,
    role: profile.role,
    name: profile.name || data.user.email,
    campus_id: profile.campus_id || null,
    teacher_id: profile.teacher_id || null,
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
