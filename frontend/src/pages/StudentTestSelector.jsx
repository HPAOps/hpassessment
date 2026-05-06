import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, FileText, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getStudentEnrollments, getOpenTestsForCourse, listStudentAttempts, findOrCreateAttempt } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { toast } from "sonner";

export default function StudentTestSelector() {
  const { enrollmentId } = useParams();
  const { student } = useAuth();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [tests, setTests] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [starting, setStarting] = useState(null);

  useEffect(() => {
    if (!student) return;
    (async () => {
      const items = await getStudentEnrollments(student.id);
      const it = items.find(i => i.enrollment.id === enrollmentId);
      setItem(it);
      if (it) {
        const open = await getOpenTestsForCourse(it.course.id);
        setTests(open);
        const ats = await listStudentAttempts(student.id);
        setAttempts(ats);
      }
    })();
  }, [student, enrollmentId]);

  async function startTest(t) {
    setStarting(t.id);
    try {
      const a = await findOrCreateAttempt(student.id, t.id, item.section.id);
      nav(`/student/test/${a.id}`);
    } catch (e) {
      // Supabase errors come back as plain objects with `.message`/`.details`/
      // `.hint`. Surface a useful string instead of letting the React error
      // boundary blow up with `[object Object]`.
      const msg = e?.message || e?.details || e?.hint || e?.error_description || JSON.stringify(e);
      toast.error("Could not start the test: " + msg);
      setStarting(null);
    }
  }

  if (!item || tests === null) return <StudentShell><div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></StudentShell>;

  return (
    <StudentShell>
      <div className="max-w-3xl mx-auto px-6 py-12 w-full">
        <button onClick={() => nav(-1)} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6" data-testid="back-btn">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="overline">Step 3 of 3</div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Choose your assessment</h1>
        <p className="mt-3 text-muted-foreground"><span className="font-medium text-foreground">{item.course.title}</span> · Teacher {item.teacher ? `${item.teacher.first_name} ${item.teacher.last_name}` : "TBD"}</p>

        <div className="mt-8 space-y-3">
          {tests.length === 0 && (
            <EmptyState icon={Lock} title="No open tests right now" description="Tests will appear here when the test window opens. Please check back later or ask your teacher." />
          )}
          {tests.map(t => {
            const phase = t.phase || t.test_type;
            const att = attempts.find(a => a.test_id === t.id && (a.phase || "BOC") === phase);
            const submitted = att && att.status === "submitted";
            return (
              <button
                key={`${t.id}-${phase}`}
                disabled={submitted}
                data-testid={`test-pick-${t.id}-${phase}`}
                onClick={() => startTest(t)}
                className="w-full text-left rounded-lg border border-border bg-card p-5 hover:border-[hsl(var(--accent))]/50 hover:shadow-md transition-all flex items-center gap-4 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <div className="h-12 w-12 rounded-md bg-secondary flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={phase === "BOC" ? "secondary" : "default"}>{phase}</Badge>
                    {submitted && <Badge variant="outline">Already submitted</Badge>}
                    {att && !submitted && <Badge variant="outline">In progress</Badge>}
                  </div>
                  <div className="font-display text-lg font-semibold tracking-tight mt-1">{t.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t.question_count} questions · Window {t.opens_at} → {t.closes_at}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </StudentShell>
  );
}
