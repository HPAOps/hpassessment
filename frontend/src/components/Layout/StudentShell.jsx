import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { HpaLogo } from "@/components/common/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { LogOut } from "lucide-react";

export default function StudentShell({ children, hideLogout = false, footer = true }) {
  const { student, logoutStudent } = useAuth();
  const nav = useNavigate();

  function handleLogout() {
    logoutStudent();
    nav("/", { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background" data-testid="student-shell">
      <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-3">
          <HpaLogo showText />
        </Link>
        <div className="flex items-center gap-3">
          {student ? (
            <>
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium">{student.name}</div>
                <div className="overline">ID {student.student_id}</div>
              </div>
              {!hideLogout && (
                <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Sign out" data-testid="student-logout-btn">
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </>
          ) : (
            <Button asChild variant="ghost" size="sm" data-testid="staff-portal-link">
              <Link to="/staff/login">Staff sign in</Link>
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col">{children}</main>

      {footer && (
        <footer className="px-6 py-4 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
          <div>Highland Prep Academies — Growth Assessments</div>
          <div className="hidden sm:block">FERPA-conscious • Powered by Supabase</div>
        </footer>
      )}
    </div>
  );
}
