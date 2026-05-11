import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, KeyRound, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getStudentEnrollments, getOpenTestsForCourse, redeemTestCode } from "@/lib/api";

const ALPHABET = /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/i;

// 6 single-character inputs that auto-advance, support paste, and uppercase
// on the fly. Easier for kids than one giant textbox.
function CodeBoxes({ value, onChange, disabled }) {
  const refs = useRef([]);
  const chars = (value || "").toUpperCase().split("");
  const slots = Array.from({ length: 6 }, (_, i) => chars[i] || "");

  function setChar(i, ch) {
    const upper = (ch || "").toUpperCase();
    if (upper && !ALPHABET.test(upper)) return; // ignore invalid chars
    const next = slots.slice();
    next[i] = upper;
    onChange(next.join(""));
    if (upper && refs.current[i + 1]) refs.current[i + 1].focus();
  }
  function onKey(i, e) {
    if (e.key === "Backspace" && !slots[i] && refs.current[i - 1]) {
      refs.current[i - 1].focus();
    } else if (e.key === "ArrowLeft" && refs.current[i - 1]) {
      refs.current[i - 1].focus();
    } else if (e.key === "ArrowRight" && refs.current[i + 1]) {
      refs.current[i + 1].focus();
    }
  }
  function onPaste(e) {
    const text = (e.clipboardData?.getData("text") || "").toUpperCase().replace(/\s+/g, "");
    if (!text) return;
    e.preventDefault();
    onChange(text.slice(0, 6));
    const targetIdx = Math.min(text.length, 5);
    refs.current[targetIdx]?.focus();
  }

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3">
      {slots.map((c, i) => (
        <input
          key={i}
          ref={el => (refs.current[i] = el)}
          inputMode="text"
          autoComplete="off"
          maxLength={1}
          value={c}
          onChange={e => setChar(i, e.target.value)}
          onKeyDown={e => onKey(i, e)}
          onPaste={onPaste}
          disabled={disabled}
          data-testid={`code-input-${i}`}
          className="w-12 h-16 sm:w-14 sm:h-20 text-center font-mono text-3xl sm:text-4xl font-bold rounded-md border-2 border-border bg-card focus:border-[hsl(var(--accent))] focus:outline-none uppercase disabled:opacity-60"
        />
      ))}
      {/* Automation hook: a single hidden input so Playwright / tests can
          set the whole 6-char code in one call without per-box races. */}
      <input
        type="text"
        aria-hidden="true"
        tabIndex={-1}
        value={value || ""}
        onChange={e => {
          const clean = (e.target.value || "").toUpperCase().replace(/[^A-Z2-9]/g, "");
          onChange(clean.slice(0, 6));
        }}
        disabled={disabled}
        data-testid="code-aggregated"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />
    </div>
  );
}

export default function StudentTestCode() {
  const { enrollmentId, testId, phase } = useParams();
  const { student } = useAuth();
  const nav = useNavigate();
  const [item, setItem] = useState(null);
  const [test, setTest] = useState(null);
  const [openCount, setOpenCount] = useState(null); // null=loading, 0+=loaded
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!student) return;
    let alive = true;
    (async () => {
      const items = await getStudentEnrollments(student.id);
      const it = items.find(i => i.enrollment.id === enrollmentId);
      if (!alive) return;
      if (!it) { nav("/student/courses", { replace: true }); return; }
      setItem(it);
      const open = await getOpenTestsForCourse(it.course.id);
      if (!alive) return;
      setOpenCount((open || []).length);
      const want = (phase || "").toUpperCase();
      const t = (open || []).find(x =>
        x.id === testId
        && String(x.phase || x.test_type || "").toUpperCase() === want
      );
      if (!t) {
        // Visible diagnostic in console so QA / automation can see why
        // the Continue button is disabled.
        console.warn("[StudentTestCode] No matching open test:",
          { testId, phase: want, openTests: open });
      }
      setTest(t || null);
    })();
    return () => { alive = false; };
  }, [student, enrollmentId, testId, phase, nav]);

  async function onSubmit(e) {
    e?.preventDefault();
    if (submitting) return;
    setError(null);
    if (!code || code.length < 6) {
      setError("Enter all 6 characters of your test code.");
      return;
    }
    setSubmitting(true);
    try {
      const a = await redeemTestCode(code, student.id, testId, item.section.id);
      // P2: route into the waiting room if the attempt isn't running yet.
      const next = a.status === "waiting" ? `/student/waiting/${a.id}` : `/student/test/${a.id}`;
      nav(next, { replace: true });
    } catch (err) {
      const msg = err?.message || err?.details || err?.hint || JSON.stringify(err);
      setError(msg.replace(/\s*\(HTTP \d+\)\s*$/, ""));
      setSubmitting(false);
    }
  }

  return (
    <StudentShell>
      <div className="max-w-xl mx-auto w-full px-6 pt-10 pb-6">
        <Button asChild size="sm" variant="ghost" className="mb-4" data-testid="code-back">
          <span onClick={() => nav(-1)} role="button" tabIndex={0}>
            <ArrowLeft className="h-4 w-4 mr-1 inline" /> Back
          </span>
        </Button>
        <Card>
          <CardContent className="p-8 sm:p-10 space-y-6">
            <div className="space-y-2 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                <KeyRound className="h-6 w-6" />
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Enter your test code</h1>
              <p className="text-sm text-muted-foreground">
                Your teacher will give you a 6-character code. It changes every day.
              </p>
            </div>

            {(student || test) && (
              <div className="rounded-md border border-border bg-secondary/40 p-4 space-y-1 text-sm">
                {student && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Student</span>
                    <span className="font-medium" data-testid="code-confirm-student">{student.first_name} {student.last_name}</span>
                  </div>
                )}
                {test && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Test</span>
                      <span className="font-medium flex items-center gap-2" data-testid="code-confirm-test">
                        {test.name}
                        <Badge variant={phase === "BOC" ? "secondary" : "default"}>{phase}</Badge>
                      </span>
                    </div>
                    {item?.course?.title && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Course</span>
                        <span className="font-medium">{item.course.title}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <CodeBoxes value={code} onChange={setCode} disabled={submitting || !test} />
              {!test && openCount !== null && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="code-no-test">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>This test isn't open right now. Ask your teacher to confirm you're on the right link, or go back to your courses.</span>
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="code-error">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" className="w-full h-11" disabled={submitting || !test} data-testid="code-submit">
                {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying…</> : "Continue"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                If your code doesn't work, ask your teacher to confirm or generate a new one.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </StudentShell>
  );
}
