import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Hourglass, AlertTriangle, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getStudentAttempt } from "@/lib/api";

export default function StudentWaitingRoom() {
  const { attemptId } = useParams();
  const { student } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  // Poll the attempt every 3s. When status flips waiting -> in_progress
  // (because the teacher clicked Start), navigate straight to the test.
  // When attempt becomes paused or session ended, show the appropriate screen.
  useEffect(() => {
    if (!student) return;
    let alive = true;
    async function tick() {
      try {
        const d = await getStudentAttempt(attemptId, student.id);
        if (!alive) return;
        setData(d);
        if (d?.attempt?.is_paused) return; // stay on this screen
        if (d?.attempt?.status === "in_progress") {
          nav(`/student/test/${attemptId}`, { replace: true });
        } else if (d?.attempt?.status === "submitted") {
          nav(`/student/submitted/${attemptId}`, { replace: true });
        }
      } catch (e) {
        if (!alive) return;
        const msg = e?.message || JSON.stringify(e);
        setError(msg.replace(/\s*\(HTTP \d+\)\s*$/, ""));
      }
    }
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { alive = false; if (pollRef.current) clearInterval(pollRef.current); };
  }, [attemptId, student, nav]);

  if (error) {
    return (
      <StudentShell>
        <div className="max-w-md mx-auto w-full px-6 pt-16 text-center space-y-3">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
          <p className="text-sm text-muted-foreground" data-testid="waiting-error">{error}</p>
          <Button variant="outline" onClick={() => nav("/student/courses", { replace: true })}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to my courses
          </Button>
        </div>
      </StudentShell>
    );
  }

  const att = data?.attempt;
  const test = data?.test;

  if (att?.is_paused) {
    return (
      <StudentShell>
        <div className="max-w-md mx-auto w-full px-6 pt-16">
          <Card>
            <CardContent className="p-8 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-amber-700" />
              </div>
              <h1 className="font-display text-2xl font-bold tracking-tight">Test paused</h1>
              <p className="text-sm text-muted-foreground" data-testid="paused-message">
                Your teacher paused your test. To finish later, ask your teacher
                or campus admin for a make-up code.
              </p>
              {att.paused_reason && (
                <p className="text-xs italic text-muted-foreground">"{att.paused_reason}"</p>
              )}
              <Button variant="outline" onClick={() => nav("/student/courses", { replace: true })}>
                Back to my courses
              </Button>
            </CardContent>
          </Card>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell>
      <div className="max-w-md mx-auto w-full px-6 pt-16" data-testid="waiting-room">
        <Card>
          <CardContent className="p-8 sm:p-10 text-center space-y-5">
            <div className="mx-auto h-14 w-14 rounded-full bg-secondary flex items-center justify-center">
              <Hourglass className="h-7 w-7 animate-pulse" />
            </div>
            <div className="space-y-1">
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">You're in!</h1>
              <p className="text-sm text-muted-foreground">
                Waiting for your teacher to start the test.
              </p>
            </div>

            <div className="rounded-md border border-border bg-secondary/40 p-4 text-left text-sm space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Student</span>
                <span className="font-medium" data-testid="waiting-student">
                  {student?.first_name} {student?.last_name}
                </span>
              </div>
              {test && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Test</span>
                  <span className="font-medium flex items-center gap-2" data-testid="waiting-test">
                    {test.name}
                    {att?.phase && <Badge variant={att.phase === "BOC" ? "secondary" : "default"}>{att.phase}</Badge>}
                  </span>
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Stay on this screen — it'll start automatically.</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </StudentShell>
  );
}
