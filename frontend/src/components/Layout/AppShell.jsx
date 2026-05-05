import React, { useState } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth, hasRole } from "@/contexts/AuthContext";
import { HpaLogo } from "@/components/common/Logo";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Building2, BookMarked, FileText, KeyRound, Upload, FolderUp, Image as ImageIcon, Settings as SettingsIcon, ScrollText, LogOut, Users as UsersIcon, GraduationCap, Menu, X, Plug } from "lucide-react";
import { isDemoMode } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Dashboard",           to: "/admin/dashboard",      icon: LayoutDashboard, roles: ["super_admin","district_admin","campus_admin","teacher"] },
  { label: "Tests",               to: "/admin/tests",          icon: FileText,        roles: ["super_admin","district_admin","campus_admin"] },
  { label: "Question Bank",       to: "/admin/questions",      icon: ImageIcon,       roles: ["super_admin","district_admin"] },
  { label: "Answer Keys",         to: "/admin/answer-keys",    icon: KeyRound,        roles: ["super_admin","district_admin"] },
  { label: "Test Import",         to: "/admin/test-import",    icon: FolderUp,        roles: ["super_admin","district_admin"] },
  { label: "OneRoster Import",    to: "/admin/oneroster",      icon: Upload,          roles: ["super_admin","district_admin"] },
  { label: "Reports",             to: "/admin/reports",        icon: BookMarked,      roles: ["super_admin","district_admin","campus_admin","teacher"] },
  { label: "Campuses",            to: "/admin/campuses",       icon: Building2,       roles: ["super_admin","district_admin"] },
  { label: "Users",               to: "/admin/users",          icon: UsersIcon,       roles: ["super_admin","district_admin","campus_admin"] },
  { label: "Audit Log",           to: "/admin/audit",          icon: ScrollText,      roles: ["super_admin","district_admin"] },
  { label: "Integrations",        to: "/admin/integrations",   icon: Plug,            roles: ["super_admin","district_admin"] },
  { label: "Settings",            to: "/admin/settings",       icon: SettingsIcon,    roles: ["super_admin"] },
];

export default function AppShell({ children }) {
  const { staff, logoutStaff } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const items = NAV.filter(n => n.roles.includes(staff?.role));

  function handleLogout() {
    logoutStaff();
    nav("/staff/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-background flex" data-testid="admin-shell">
      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-40 w-72 border-r border-border bg-card transition-transform",
        open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <div className="flex h-16 items-center justify-between px-5 border-b border-border">
          <Link to="/admin/dashboard" className="flex items-center gap-3">
            <HpaLogo showText />
          </Link>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="p-3 space-y-1">
          {items.map(it => (
            <NavLink
              key={it.to}
              to={it.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "text-foreground hover:bg-secondary"
              )}
              data-testid={`nav-${it.to.split("/").pop()}`}
            >
              <it.icon className="h-4 w-4" />
              <span>{it.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-border">
          <div className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-8 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] flex items-center justify-center text-xs font-bold">
                {(staff?.name || "").split(" ").map(p=>p[0]).slice(0,2).join("")}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{staff?.name}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{staff?.role?.replace("_", " ")}</div>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} data-testid="staff-logout-btn" aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-card/70 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="overline hidden md:block">{loc.pathname}</div>
          </div>
          <div className="flex items-center gap-3">
            {isDemoMode && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--accent))]/15 px-3 py-1 text-xs font-medium text-[hsl(var(--accent-foreground))] border border-[hsl(var(--accent))]/30">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
                Demo Mode
              </span>
            )}
            <Button asChild variant="outline" size="sm" data-testid="visit-student-app-btn">
              <Link to="/"><GraduationCap className="h-4 w-4" /> Student App</Link>
            </Button>
          </div>
        </header>
        <main className="p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight gold-underline">{title}</h1>
        {subtitle ? <p className="mt-3 text-sm text-muted-foreground max-w-2xl">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
