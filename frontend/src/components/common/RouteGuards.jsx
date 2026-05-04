import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, hasRole } from "@/contexts/AuthContext";

export function RequireStaff({ roles, children }) {
  const { staff } = useAuth();
  const loc = useLocation();
  if (!staff) return <Navigate to="/staff/login" state={{ from: loc.pathname }} replace />;
  if (roles && !hasRole(staff, ...roles)) return <Navigate to="/admin/dashboard" replace />;
  return children;
}

export function RequireStudent({ children }) {
  const { student } = useAuth();
  const loc = useLocation();
  if (!student) return <Navigate to="/" state={{ from: loc.pathname }} replace />;
  return children;
}
