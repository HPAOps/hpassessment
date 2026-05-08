import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Loader2, Play, Square, Pause, Users, KeyRound, RefreshCcw,
  CircleDot, CheckCircle2, AlertTriangle, Copy,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSectionDetail, listTests, listTestCourses,
  getOrCreateDailyCode,
  teacherGetOrCreateSession, teacherSessionState,
  teacherStartSession, teacherEndSession, teacherPauseAttempt,
} from "@/lib/api";

const POLL_MS = 4000;

function statusBadge(att) {
  if (att?.is_paused) return <Badge variant="outline" className="border-amber-500 text-amber-700">Paused</Badge>;
  if (att?.status === "submitted") return <Badge variant="secondary">Submitted</Badge>;
  if (att?.status === "in_progress") return <Badge>In progress</Badge>;
  if (att?.status === "waiting") return <Badge variant="outline">Waiting</Badge>;
  return <Badge variant="outline">{att?.status || "—"}</Badge>;
}

function pct(n, d) {
  if (!d || d === 0) return 0;
  return Math.round((n / d) * 100);
}

export default function Proctor() {
  const { sectionId, testId, phase } = useParams();
  const nav = useNavigate();
  const [section, setSection] = useState(null);
  const [test, setTest] = useState(null);
  const [code, setCode] = useState(null);
  const [state, setState] = useState(null);     // { session, attempts, roster_not_joined }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);

  // 1) Initial bootstrap: fetch section, find the test, ensure session, fetch code.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, allTests, tcs] = await Promise.all([
          getSectionDetail(sectionId),
          listTests(),
          listTestCourses().catch(() => []),
        ]);
        if (!alive) return;
        if (!s) { setError("Section not found."); return; }
        setSection(s);
        const courseId = s.course?.id;
        const linkedToCourse = (allTests || []).filter(t =>
          t.course_id === courseId
          || (tcs || []).some(j => j.test_id === t.id && j.course_id === courseId)
        );
        const t = linkedToCourse.find(x => x.id === testId);
        if (!t) { setError("That test isn't linked to this section's course."); return; }
        setTest(t);

        const [session, codeRow] = await Promise.all([
          teacherGetOrCreateSession(testId, sectionId, phase),
          getOrCreateDailyCode(testId).catch(() => null),
        ]);
        if (!alive) return;
        setCode(codeRow);
        const st = await teacherSessionState(session.id);
        if (!alive) return;
        setState(st);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || String(e));
      }
    })();
    return () => { alive = false; };
  }, [sectionId, testId, phase]);

  // 2) Poll session state every 4s while session is alive.
  const refresh = useCallback(async () => {
    if (!state?.session?.id) return;
    try {
      const st = await teacherSessionState(state.session.id);
      setState(st);
    } catch (e) {
      // soft-fail polling errors
      console.warn("session poll failed:", e);
    }
  }, [state?.session?.id]);

  useEffect(() => {
    if (!state?.session?.id) return;
    if (state.session.status === "ended") return;
    pollRef.current = setInterval(refresh, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [state?.session?.id, state?.session?.status, refresh]);

  async function onStart() {
    if (busy) return;
    setBusy(true);
    try {
      await teacherStartSession(state.session.id);
      await refresh();
      toast.success("Test started");
    } catch (e) {
      toast.error(e?.message || "Could not start the test");
    } finally { setBusy(false); }
  }

  async function onEnd() {
    if (busy) return;
    setBusy(true);
    try {
      await teacherEndSession(state.session.id);
      await refresh();
      toast.success("Test ended. In-progress attempts auto-submitted.");
    } catch (e) {
      toast.error(e?.message || "Could not end the test");
    } finally { setBusy(false); }
  }

  async function onPause(att) {
    if (busy) return;
    const reason = window.prompt(
      `Pause ${att.student.first_name} ${att.student.last_name}'s test?`
      + `\nThey'll be locked out and need a make-up code to continue.`
      + `\nOptional reason (visible to the student):`,
      ""
    );
    if (reason === null) return;
    setBusy(true);
    try {
      await teacherPauseAttempt(att.id, reason || null);
      await refresh();
      toast.success(`Paused ${att.student.first_name}`);
    } catch (e) {
      toast.error(e?.message || "Could not pause attempt");
    } finally { setBusy(false); }
  }

  function copyCode() {
    if (!code?.code) return;
    navigator.clipboard?.writeText(code.code);
    toast.success("Code copied");
  }

  if (error) {
    return (
      <AppShell>
        <Button asChild size="sm" variant="ghost" className="mb-4">
          <Link to={`/admin/sections/${sectionId}`}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
        </Button>
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      </AppShell>
    );
  }

  if (!state || !section || !test) {
    return <AppShell><div className="py-16 text-center text-muted-foreground"><Loader2 className="inline h-5 w-5 animate-spin mr-2" /> Loading…</div></AppShell>;
  }

  const sess = state.session;
  const attempts = state.attempts || [];
  const notJoined = state.roster_not_joined || [];
  const total = attempts.length + notJoined.length;
  const joined = attempts.length;
  const inProgress = attempts.filter(a => a.status === "in_progress" && !a.is_paused).length;
  const submitted = attempts.filter(a => a.status === "submitted").length;
  const paused = attempts.filter(a => a.is_paused).length;
  const isWaiting = sess.status === "waiting";
  const isRunning = sess.status === "running";
  const isEnded   = sess.status === "ended";

  return (
    <AppShell>
      <Button asChild size="sm" variant="ghost" className="mb-3">
        <Link to={`/admin/sections/${sectionId}`} data-testid="proctor-back"><ArrowLeft className="h-4 w-4 mr-1" /> Back to section</Link>
      </Button>

      <PageHeader
        title={`${test.name}`}
        subtitle={`${section.course?.title} — ${section.section_code} — ${section.campus?.name || ""}`}
      />

      {/* Top bar: status + code + global actions */}
      <Card className="mb-5">
        <CardContent className="p-5 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            {isWaiting && <Badge variant="outline" data-testid="session-status">Waiting room</Badge>}
            {isRunning && <Badge data-testid="session-status">Running</Badge>}
            {isEnded   && <Badge variant="secondary" data-testid="session-status">Ended</Badge>}
            <Badge variant={phase === "BOC" ? "secondary" : "default"}>{phase}</Badge>
          </div>

          {code?.code && (
            <div className="flex items-center gap-2 ml-auto">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Today's code</span>
              <span className="font-mono font-bold tracking-[0.3em] text-xl select-all" data-testid="proctor-code">{code.code}</span>
              <Button variant="outline" size="sm" onClick={copyCode} data-testid="proctor-copy-code"><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          )}

          <div className="basis-full" />

          {isWaiting && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={busy || joined === 0} data-testid="proctor-start">
                  <Play className="h-4 w-4 mr-2" /> Start test
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Start the test for {joined} student{joined === 1 ? "" : "s"}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All students who have joined the waiting room will see Question 1 as soon as you confirm. Students who haven't joined yet can still join after start.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onStart} data-testid="proctor-start-confirm">Start now</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {isRunning && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy} data-testid="proctor-end">
                  <Square className="h-4 w-4 mr-2" /> End test
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End the test session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every student still working will be auto-submitted with whatever they've answered so far. Students still in the waiting room will be locked out (they'll need a make-up code).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onEnd} data-testid="proctor-end-confirm">End test</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {isEnded && (
            <Button variant="outline" disabled className="ml-auto"><CheckCircle2 className="h-4 w-4 mr-2" /> Test ended</Button>
          )}
        </CardContent>
      </Card>

      {/* Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <CountCard icon={<Users className="h-4 w-4" />} label="Roster" value={total} testid="count-total" />
        <CountCard icon={<CircleDot className="h-4 w-4" />} label="Joined" value={joined} testid="count-joined" />
        <CountCard icon={<Play className="h-4 w-4" />} label="Working" value={inProgress} testid="count-in-progress" />
        <CountCard icon={<CheckCircle2 className="h-4 w-4" />} label="Submitted" value={submitted} testid="count-submitted" />
        <CountCard icon={<AlertTriangle className="h-4 w-4" />} label="Paused" value={paused} testid="count-paused" />
      </div>

      {/* Roster table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Score</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map(a => {
                const progress = `${a.current_question_index ?? 0} / ${a.total_count ?? 0}`;
                const progressPct = pct(a.current_question_index ?? 0, a.total_count ?? 0);
                const score = a.status === "submitted" ? `${a.score_percent ?? 0}%` : "—";
                const canPause = !a.is_paused && a.status !== "submitted";
                return (
                  <TableRow key={a.id} data-testid={`proctor-row-${a.student.id}`}>
                    <TableCell>
                      <div className="font-medium">{a.student.last_name}, {a.student.first_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{a.student.student_id}</div>
                    </TableCell>
                    <TableCell>{statusBadge(a)}</TableCell>
                    <TableCell>
                      <div className="w-32">
                        <div className="text-xs mb-1" data-testid={`progress-text-${a.student.id}`}>{progress} ({progressPct}%)</div>
                        <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-foreground" style={{ width: `${progressPct}%` }} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm" data-testid={`score-${a.student.id}`}>{score}</TableCell>
                    <TableCell className="text-right">
                      {canPause && isRunning && (
                        <Button variant="ghost" size="sm" onClick={() => onPause(a)} data-testid={`pause-${a.student.id}`}>
                          <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {notJoined.map(s => (
                <TableRow key={s.id} className="opacity-60" data-testid={`proctor-not-joined-${s.id}`}>
                  <TableCell>
                    <div className="font-medium">{s.last_name}, {s.first_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{s.student_id}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">Not joined</Badge></TableCell>
                  <TableCell colSpan={3} className="text-xs text-muted-foreground">Hasn't entered the code yet.</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Updates every 4 seconds. <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={refresh}><RefreshCcw className="h-3 w-3 mr-1" /> Refresh now</Button></span>
        {isEnded && <Button variant="outline" size="sm" onClick={() => nav(`/admin/sections/${sectionId}`)}>Done</Button>}
      </div>
    </AppShell>
  );
}

function CountCard({ icon, label, value, testid }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {label}</div>
        <div className="font-display text-2xl font-bold mt-1" data-testid={testid}>{value}</div>
      </CardContent>
    </Card>
  );
}
