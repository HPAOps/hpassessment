import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getStudentAttempt, getSettings } from "@/lib/api";

export default function StudentSubmitConfirm() {
  const { attemptId } = useParams();
  const { student, logoutStudent } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [attempt, setAttempt] = useState(loc.state?.submittedAttempt || null);
  const [test, setTest] = useState(loc.state?.test || null);
  const [showScore, setShowScore] = useState(false);

  useEffect(() => {
    (async () => {
      const settings = await getSettings();
      setShowScore(!!settings.show_score_to_student);
      // If we didn't get the attempt via route state (e.g. the user refreshed
      // the confirmation page), try one RPC call. This will succeed for staff
      // viewing the page, but not for students whose session_secret was cleared
      // on submit — which is the intended behaviour.
      if (!attempt) {
        try {
          const data = await getStudentAttempt(attemptId, student.id);
          if (data) { setAttempt(data.attempt); setTest(data.test); }
        } catch { /* expected for students after secret invalidation */ }
      }
    })();
  }, [attemptId, student, attempt]);

  return (
    <StudentShell footer>
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <Card className="max-w-md w-full border-2 border-[hsl(var(--success))]/40" data-testid="submit-confirmation">
          <CardContent className="p-10 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-[hsl(var(--success))]/10 flex items-center justify-center">
              <CheckCircle2 className="h-9 w-9 text-[hsl(var(--success))]" />
            </div>
            <h1 className="mt-6 font-display text-3xl font-bold tracking-tight">All done!</h1>
            <p className="mt-3 text-muted-foreground">
              Your answers have been submitted{test ? <> for <span className="font-medium text-foreground">{test.name}</span></> : null}.
            </p>

            {showScore && attempt && attempt.score_percent != null ? (
              <div className="mt-6 rounded-md border border-border p-4">
                <div className="overline">Your score</div>
                <div className="mt-2 font-display text-4xl font-bold tracking-tight">{attempt.score_percent}%</div>
                <div className="text-xs text-muted-foreground mt-1">{attempt.correct_count} of {attempt.total_count} correct</div>
              </div>
            ) : (
              <div className="mt-6 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                Your teacher will review the results. Great work!
              </div>
            )}

            <div className="mt-8 grid gap-2">
              <Button onClick={() => nav("/student/courses")} data-testid="take-another-btn">Take another assessment</Button>
              <Button variant="outline" onClick={() => { logoutStudent(); nav("/"); }} data-testid="finish-and-signout-btn">Sign out</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </StudentShell>
  );
}
