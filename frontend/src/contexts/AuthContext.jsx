import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getStaffSession, getStudentSession, staffSignIn, studentSignIn, signOutStaff, signOutStudent, signOutAll, staffSignInWithMicrosoft } from "@/lib/auth";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [staff, setStaff] = useState(() => getStaffSession());
  const [student, setStudent] = useState(() => getStudentSession());

  useEffect(() => {
    function onStorage() {
      setStaff(getStaffSession());
      setStudent(getStudentSession());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const loginStaff = useCallback(async (email, password) => {
    const s = await staffSignIn(email, password);
    setStaff(s);
    return s;
  }, []);
  const loginStaffMicrosoft = useCallback(async () => {
    return await staffSignInWithMicrosoft();
  }, []);
  const refreshStaff = useCallback((session) => {
    setStaff(session || getStaffSession());
  }, []);
  const loginStudent = useCallback(async (studentId) => {
    const s = await studentSignIn(studentId);
    setStudent(s);
    return s;
  }, []);
  const logoutStaff = useCallback(() => { signOutStaff(); setStaff(null); }, []);
  const logoutStudent = useCallback(() => { signOutStudent(); setStudent(null); }, []);
  const logoutAll = useCallback(() => { signOutAll(); setStaff(null); setStudent(null); }, []);

  const value = { staff, student, loginStaff, loginStaffMicrosoft, refreshStaff, loginStudent, logoutStaff, logoutStudent, logoutAll };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function hasRole(staff, ...roles) {
  if (!staff) return false;
  return roles.includes(staff.role);
}
