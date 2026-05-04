import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, ArrowRight, CheckCircle2, ZoomIn, ZoomOut, Save, Send, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { listAttempts, listQuestionsForTest, listTests, saveResponse, submitAttempt } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function StudentTest() {
  const { attemptId } = useParams();
  const { student } = useAuth();
  const nav = useNavigate();
  const [attempt, setAttempt] = useState(null);
  const [test, setTest] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const lastSavedRef = useRef(Date.now());

  useEffect(() => {
    (async () => {
      const all = await listAttempts({ student_id: student.id });
      const a = all.find(x => x.id === attemptId);
      if (!a) { nav("/student/courses", { replace: true }); return; }
      setAttempt(a);
      if (a.status === "submitted") { nav(`/student/submitted/${a.id}`, { replace: true }); return; }
      const tests = await listTests();
      setTest(tests.find(t => t.id === a.test_id));
      const qs = await listQuestionsForTest(a.test_id);
      setQuestions(qs);
    })();
  }, [attemptId, student, nav]);

  const orderedQuestions = useMemo(() => {
    if (!attempt || !questions) return [];
    return attempt.question_order.map(qid => questions.find(q => q.id === qid)).filter(Boolean);
  }, [attempt, questions]);

  const currentQ = orderedQuestions[idx];
  const currentResponse = attempt?.responses?.find(r => r.question_id === currentQ?.id);
  const answeredCount = attempt?.responses?.filter(r => r.selected_answer).length || 0;
  const remaining = (orderedQuestions.length || 0) - answeredCount;

  async function pick(letter) {
    if (!currentQ) return;
    setSaving(true);
    const updated = await saveResponse(attempt.id, currentQ.id, letter);
    setAttempt({ ...updated });
    lastSavedRef.current = Date.now();
    setSaving(false);
  }

  async function onSubmit() {
    const res = await submitAttempt(attempt.id);
    setAttempt(res);
    nav(`/student/submitted/${res.id}`, { replace: true });
  }

  if (!attempt || !test || !questions) {
    return <StudentShell><div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></StudentShell>;
  }

  return (
    <StudentShell hideLogout footer={false}>
      {/* Test top bar */}
      <div className="border-b border-border bg-card/70 backdrop-blur-md px-6 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="min-w-0">
          <div className="overline">{test.test_type} · {test.name}</div>
          <div className="text-sm font-medium truncate">Question {idx + 1} of {orderedQuestions.length}</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1.5" data-testid="autosave-indicator">
            <Save className={cn("h-3.5 w-3.5", saving && "animate-pulse text-[hsl(var(--accent))]")} />
            {saving ? "Saving…" : "All changes saved"}
          </span>
          <Badge variant="outline" data-testid="remaining-indicator">{remaining} unanswered</Badge>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-0 flex-1">
        {/* Question + answers */}
        <div className="px-6 py-8 lg:px-12 lg:py-12 max-w-5xl">
          <div className="flex items-center justify-between mb-4">
            <div className="overline">Question {idx + 1}</div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.max(0.6, z - 0.1))} aria-label="Zoom out" data-testid="zoom-out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.min(2, z + 0.1))} aria-label="Zoom in" data-testid="zoom-in">
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-auto max-h-[60vh] flex items-center justify-center bg-secondary/30 p-4">
              <img
                src={currentQ.image_url}
                alt={`Question ${idx + 1}`}
                style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
                className="max-w-full transition-transform"
                data-testid="question-image"
              />
            </div>
          </div>

          {/* Answers */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {["A","B","C","D"].map(letter => {
              const selected = currentResponse?.selected_answer === letter;
              return (
                <button
                  key={letter}
                  data-testid={`answer-${letter}`}
                  onClick={() => pick(letter)}
                  className={cn(
                    "student-answer-btn rounded-lg border-2 p-5 text-left transition-all flex items-center gap-4",
                    selected
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 shadow-md"
                      : "border-border bg-card hover:border-[hsl(var(--accent))]/50 hover:bg-secondary/30"
                  )}
                >
                  <div className={cn(
                    "h-12 w-12 rounded-md flex items-center justify-center font-display text-2xl font-bold shrink-0",
                    selected ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-secondary text-foreground"
                  )}>{letter}</div>
                  <div className="flex-1 text-base">Answer choice {letter}</div>
                  {selected ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--primary))]" /> : null}
                </button>
              );
            })}
          </div>

          {/* Prev / Next */}
          <div className="mt-8 flex items-center justify-between">
            <Button variant="outline" disabled={idx === 0} onClick={() => setIdx(i => i - 1)} data-testid="prev-question">
              <ArrowLeft className="h-4 w-4" /> Previous
            </Button>
            {idx < orderedQuestions.length - 1 ? (
              <Button onClick={() => setIdx(i => i + 1)} data-testid="next-question">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <SubmitConfirm remaining={remaining} onConfirm={onSubmit} />
            )}
          </div>
        </div>

        {/* Question navigator */}
        <aside className="border-t lg:border-t-0 lg:border-l border-border bg-card/30 p-6">
          <div className="overline mb-3">Question Navigator</div>
          <div className="grid grid-cols-5 gap-2" data-testid="question-navigator">
            {orderedQuestions.map((q, i) => {
              const r = attempt.responses.find(x => x.question_id === q.id);
              const answered = !!r?.selected_answer;
              const isCurrent = i === idx;
              return (
                <button
                  key={q.id}
                  data-testid={`nav-q-${i+1}`}
                  onClick={() => setIdx(i)}
                  className={cn(
                    "h-10 rounded-md text-sm font-medium border transition-all",
                    isCurrent && "ring-2 ring-[hsl(var(--accent))]",
                    answered ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]" : "bg-card border-border hover:border-foreground/40"
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-6 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm bg-[hsl(var(--primary))]" /> Answered</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-border" /> Not answered</div>
            <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm border-2 border-[hsl(var(--accent))]" /> Current</div>
          </div>
          <div className="mt-6 pt-6 border-t border-border">
            <SubmitConfirm remaining={remaining} onConfirm={onSubmit} fullWidth />
          </div>
        </aside>
      </div>
    </StudentShell>
  );
}

function SubmitConfirm({ remaining, onConfirm, fullWidth = false }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button data-testid="submit-test-btn" className={cn(fullWidth && "w-full", "h-12")}>
          <Send className="h-4 w-4" /> Submit test
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display">Submit your test?</AlertDialogTitle>
          <AlertDialogDescription>
            {remaining > 0 ? (
              <span className="inline-flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-[hsl(var(--warning))]" />
                You still have <strong>{remaining}</strong> unanswered {remaining === 1 ? "question" : "questions"}. Once submitted, you can't change your answers.
              </span>
            ) : "All questions are answered. Once submitted, you can't change your answers."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="submit-cancel">Keep working</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} data-testid="submit-confirm">Yes, submit final answers</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
