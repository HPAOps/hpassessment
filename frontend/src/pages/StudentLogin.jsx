import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { GraduationCap, Loader2, ShieldCheck, BookOpenCheck } from "lucide-react";
import { isDemoMode } from "@/lib/supabase";

export default function StudentLogin() {
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const { loginStudent } = useAuth();
  const nav = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    if (!studentId.trim()) return;
    setLoading(true);
    try {
      await loginStudent(studentId.trim());
      nav("/student/courses", { replace: true });
    } catch (err) {
      toast.error(err.message || "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <StudentShell hideLogout footer>
      <div className="flex-1 grid lg:grid-cols-2">
        {/* Left brand panel */}
        <div className="hidden lg:flex flex-col justify-between p-12 brand-gradient grain text-[hsl(var(--primary-foreground))] relative overflow-hidden">
          <div className="relative z-10">
            <div className="overline opacity-80 !text-white/70">Course Growth Assessments</div>
            <h2 className="mt-6 font-display text-5xl font-bold tracking-tight leading-[1.05]">
              Show what you've learned.<br/>
              <span className="text-[hsl(var(--accent))]">Discover how far you've grown.</span>
            </h2>
            <p className="mt-6 max-w-md text-white/75 text-base">
              Take your Beginning of Course or End of Course assessment. Highland Prep tracks your growth so your teachers can support you better.
            </p>
          </div>
          <div className="relative z-10 grid grid-cols-2 gap-3 max-w-sm">
            <div className="rounded-lg border border-white/15 p-4 bg-white/5 backdrop-blur">
              <BookOpenCheck className="h-5 w-5 text-[hsl(var(--accent))]" />
              <div className="mt-2 text-sm font-medium">Image-based questions</div>
              <div className="text-xs text-white/60">Read carefully, take your time.</div>
            </div>
            <div className="rounded-lg border border-white/15 p-4 bg-white/5 backdrop-blur">
              <ShieldCheck className="h-5 w-5 text-[hsl(var(--accent))]" />
              <div className="mt-2 text-sm font-medium">Auto-saved</div>
              <div className="text-xs text-white/60">Your answers save as you go.</div>
            </div>
          </div>
          <div className="absolute -right-32 -bottom-32 w-[480px] h-[480px] rounded-full bg-[hsl(var(--accent))]/20 blur-3xl" />
        </div>

        {/* Right login panel */}
        <div className="flex items-center justify-center p-6 lg:p-12">
          <Card className="w-full max-w-md border-border" data-testid="student-login-card">
            <CardContent className="p-8 lg:p-10">
              <div className="flex items-center gap-2 overline">
                <GraduationCap className="h-3.5 w-3.5" /> Student sign-in
              </div>
              <h1 className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight">Enter your Student ID</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Use the ID printed on your school badge or provided by your teacher.
              </p>

              <form onSubmit={onSubmit} className="mt-8 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="student-id">Student ID</Label>
                  <Input
                    id="student-id"
                    autoFocus
                    inputMode="numeric"
                    placeholder="e.g. 100001"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    className="h-14 text-lg tracking-wide"
                    data-testid="student-id-input"
                  />
                </div>
                <Button type="submit" disabled={loading || !studentId.trim()} className="w-full h-14 text-base" data-testid="student-id-submit">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Continue
                </Button>
              </form>

              {isDemoMode && (
                <div className="mt-6 rounded-md border border-dashed border-border p-4 text-xs">
                  <div className="overline mb-2">Demo IDs</div>
                  <div className="text-muted-foreground">Try <span className="font-mono text-foreground">100001</span> through <span className="font-mono text-foreground">100030</span></div>
                </div>
              )}

              <Link to="/staff/login" className="mt-6 block text-center text-xs text-muted-foreground hover:text-foreground" data-testid="staff-login-link">
                Are you a teacher or admin? <span className="underline underline-offset-4">Sign in here</span>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </StudentShell>
  );
}
