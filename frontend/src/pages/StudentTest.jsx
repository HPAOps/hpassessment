import React, { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, ArrowRight, CheckCircle2, ZoomIn, ZoomOut, Save, Send, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getStudentAttempt, saveResponse, submitAttempt } from "@/lib/api";
import { cn } from "@/lib/utils";
import FormattedText from "@/components/common/FormattedText";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function StudentTest() {
  const { attemptId } = useParams();
  const { student } = useAuth();
  const nav = useNavigate();
  const [attempt, setAttempt] = useState(null);
  const [test, setTest] = useState(null);
  const [orderedQuestions, setOrderedQuestions] = useState([]);
  const [passages, setPassages] = useState([]); // text-mode only
  const [responses, setResponses] = useState([]);
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const lastSavedRef = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getStudentAttempt(attemptId, student.id);
        if (!alive) return;
        if (!data || !data.attempt) { nav("/student/courses", { replace: true }); return; }
        // P2: if the teacher hasn't started the session yet, send the
        // student to the waiting room. If the teacher paused them, also
        // bounce -- the waiting room renders a "test paused" message.
        if (data.attempt.status === "waiting" || data.attempt.is_paused) {
          nav(`/student/waiting/${data.attempt.id}`, { replace: true });
          return;
        }
        if (data.attempt.status === "submitted") { nav(`/student/submitted/${data.attempt.id}`, { replace: true }); return; }
        setAttempt(data.attempt);
        setTest(data.test);
        setOrderedQuestions(data.questions || []);
        setPassages(data.passages || []);
        setResponses(data.responses || []);
      } catch (e) {
        if (!alive) return;
        const msg = e?.message || e?.details || e?.hint || JSON.stringify(e);
        // Most common cause: the session_secret in localStorage was cleared
        // or never written (e.g. user reloaded the URL directly). Send them
        // back to the test selector where startTest() will rebuild it.
        if (/invalid or expired session/i.test(msg)) {
          toast.error("Your test session expired. Please reopen the test from your courses.");
          nav("/student/courses", { replace: true });
        } else {
          setLoadError(msg);
          toast.error("Could not load the test: " + msg);
        }
      }
    })();
    return () => { alive = false; };
  }, [attemptId, student, nav]);

  const currentQ = orderedQuestions[idx];
  const currentResponse = responses.find(r => r.question_id === currentQ?.id);
  const answeredCount = responses.filter(r => r.selected_answer).length;
  const remaining = (orderedQuestions.length || 0) - answeredCount;

  async function pick(letter) {
    if (!currentQ) return;
    setSaving(true);
    try {
      await saveResponse(attempt.id, currentQ.id, letter);
      setResponses(prev => {
        const others = prev.filter(r => r.question_id !== currentQ.id);
        return [...others, { question_id: currentQ.id, selected_answer: letter }];
      });
      lastSavedRef.current = Date.now();
    } catch (e) {
      const msg = e?.message || e?.details || e?.hint || JSON.stringify(e);
      // The teacher may have just paused this attempt. Bounce to the waiting
      // room which knows how to render a friendly "Your test was paused"
      // message instead of toasting a cryptic SQL error.
      if (/paused|not in progress|invalid session/i.test(msg)) {
        nav(`/student/waiting/${attempt.id}`, { replace: true });
        return;
      }
      toast.error("Could not save your answer: " + msg);
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit() {
    try {
      const res = await submitAttempt(attempt.id);
      // Server invalidates the session_secret on submit — pass the result via
      // route state so the confirmation screen doesn't need to re-fetch.
      nav(`/student/submitted/${res.id || attempt.id}`, {
        replace: true,
        state: { submittedAttempt: res, test },
      });
    } catch (e) {
      const msg = e?.message || e?.details || e?.hint || JSON.stringify(e);
      toast.error("Could not submit your test: " + msg);
    }
  }

  if (loadError) {
    return (
      <StudentShell>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-md text-center space-y-3">
            <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
            <h2 className="font-display text-2xl font-semibold">We couldn't load your test</h2>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button onClick={() => nav("/student/courses", { replace: true })} data-testid="loaderror-back">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to my courses
            </Button>
          </div>
        </div>
      </StudentShell>
    );
  }

  if (!attempt || !test) {
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
            {test.format !== "text" && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.max(0.6, z - 0.1))} aria-label="Zoom out" data-testid="zoom-out">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => setZoom(z => Math.min(2, z + 0.1))} aria-label="Zoom in" data-testid="zoom-in">
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* TEXT MODE: passage → stem → choices (passage first so students
              read the source material before the question, matching the
              standard reading-comprehension layout). */}
          {currentQ && test.format === "text" && (
            <div className="space-y-6">
              {(() => {
                const p = currentQ.passage_id
                  ? passages.find(x => x.id === currentQ.passage_id)
                  : null;
                return p ? (
                  <div
                    className="rounded-xl border border-border bg-card overflow-hidden"
                    data-testid="text-passage"
                  >
                    {p.title && (
                      <div className="px-6 py-3 bg-secondary/30 border-b border-border">
                        <FormattedText
                          text={p.title}
                          as="div"
                          className="font-display font-bold text-base whitespace-pre-wrap"
                        />
                      </div>
                    )}
                    <div className="px-6 py-5 max-h-[45vh] overflow-auto">
                      <FormattedText
                        text={p.body}
                        as="div"
                        className="prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed text-[15px]"
                      />
                    </div>
                  </div>
                ) : null;
              })()}

              <div
                className="rounded-xl border border-border bg-card px-6 py-5"
                data-testid="question-stem"
              >
                <FormattedText
                  text={currentQ.question_text}
                  as="div"
                  className="text-base leading-relaxed whitespace-pre-wrap"
                />
              </div>
            </div>
          )}

          {/* IMAGE MODE: existing image renderer */}
          {currentQ && test.format !== "text" && (
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
          )}

          {/* Answers */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {["A","B","C","D"].map(letter => {
              const selected = currentResponse?.selected_answer === letter;
              const choiceText = test.format === "text"
                ? currentQ?.[`choice_${letter.toLowerCase()}`]
                : null;
              return (
                <button
                  key={letter}
                  data-testid={`answer-${letter}`}
                  onClick={() => pick(letter)}
                  className={cn(
                    "student-answer-btn rounded-lg border-2 p-5 text-left transition-all flex items-start gap-4",
                    selected
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 shadow-md"
                      : "border-border bg-card hover:border-[hsl(var(--accent))]/50 hover:bg-secondary/30"
                  )}
                >
                  <div className={cn(
                    "h-12 w-12 rounded-md flex items-center justify-center font-display text-2xl font-bold shrink-0",
                    selected ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-secondary text-foreground"
                  )}>{letter}</div>
                  <div className="flex-1 text-base">
                    {choiceText ? (
                      <FormattedText text={choiceText} className="leading-relaxed" />
                    ) : (
                      <span>Answer choice {letter}</span>
                    )}
                  </div>
                  {selected ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--primary))] shrink-0 mt-1" /> : null}
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
              const r = responses.find(x => x.question_id === q.id);
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
