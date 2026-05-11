import React, { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { HpaLogo } from "@/components/common/Logo";
import { Loader2, ShieldCheck } from "lucide-react";
import { isDemoMode } from "@/lib/supabase";

export default function StaffLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msLoading, setMsLoading] = useState(false);
  const { loginStaff, loginStaffMicrosoft } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await loginStaff(email, password);
      const dest = loc.state?.from && loc.state.from.startsWith("/admin") ? loc.state.from : "/admin/dashboard";
      nav(dest, { replace: true });
    } catch (err) {
      toast.error(err.message || "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  async function onMicrosoft() {
    setMsLoading(true);
    try {
      await loginStaffMicrosoft();
      // Browser redirects to Microsoft, then back to /staff/oauth-callback
    } catch (err) {
      toast.error(err.message || "Microsoft sign-in failed.");
      setMsLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between p-12 brand-gradient grain text-[hsl(var(--primary-foreground))] relative overflow-hidden">
        <Link to="/" className="relative z-10 inline-flex"><HpaLogo showText /></Link>
        <div className="relative z-10">
          <div className="overline opacity-80 !text-white/70">Staff portal</div>
          <h2 className="mt-4 font-display text-5xl font-bold tracking-tight leading-[1.05]">
            Track growth.<br/><span className="text-[hsl(var(--accent))]">Power instruction.</span>
          </h2>
          <p className="mt-6 max-w-md text-white/75">
            Manage assessments, import OneRoster data, monitor student progress, and review BOC→EOC growth across every campus.
          </p>
        </div>
        <div className="absolute -right-32 -bottom-32 w-[480px] h-[480px] rounded-full bg-[hsl(var(--accent))]/20 blur-3xl" />
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <Card className="w-full max-w-md border-border" data-testid="staff-login-card">
          <CardContent className="p-8 lg:p-10">
            <Link to="/" className="lg:hidden block mb-6"><HpaLogo showText /></Link>
            <div className="overline inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Staff sign-in</div>
            <h1 className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight">Sign in to your dashboard</h1>
            <p className="mt-3 text-sm text-muted-foreground">For admins, district staff, and teachers.</p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4">
              <Button
                type="button"
                variant="outline"
                onClick={onMicrosoft}
                disabled={msLoading || isDemoMode}
                className="w-full h-11 gap-2"
                data-testid="staff-ms-login"
              >
                {msLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <svg viewBox="0 0 23 23" className="h-4 w-4" aria-hidden>
                    <path fill="#f35325" d="M1 1h10v10H1z"/>
                    <path fill="#81bc06" d="M12 1h10v10H12z"/>
                    <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                    <path fill="#ffba08" d="M12 12h10v10H12z"/>
                  </svg>
                )}
                Sign in with Microsoft
              </Button>

              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">or use email (break-glass)</span></div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" data-testid="staff-email-input" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" data-testid="staff-password-input" />
              </div>
              <Button type="submit" disabled={loading} className="w-full h-11" data-testid="staff-login-submit">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in
              </Button>

              <Link
                to="/staff/forgot-password"
                className="block text-center text-xs text-muted-foreground hover:text-foreground"
                data-testid="forgot-password-link"
              >
                Forgot your password?
              </Link>
            </form>

            {isDemoMode && (
              <div className="mt-6 rounded-md border border-dashed border-border p-4 text-xs space-y-1.5">
                <div className="overline mb-2">Demo accounts</div>
                <div>Password: <span className="font-mono normal-case">Hpa12345!</span></div>
                <div className="font-mono">super@hpa.test</div>
                <div className="font-mono">district@hpa.test</div>
                <div className="font-mono">madison@hpa.test</div>
                <div className="font-mono">teacher@hpa.test</div>
              </div>
            )}

            <Link to="/" className="mt-6 block text-center text-xs text-muted-foreground hover:text-foreground" data-testid="back-to-student-link">
              ← Back to student app
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
