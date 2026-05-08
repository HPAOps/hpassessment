import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getSectionDetail, getSectionRoster, listTests, listTestCourses, createMakeupCode } from "@/lib/api";
import { ArrowLeft, Search, Loader2, Users, KeyRound, Copy, Play } from "lucide-react";
import { toast } from "sonner";

function fullName(s) {
  return `${s?.first_name ?? ""} ${s?.last_name ?? ""}`.trim() || "—";
}

export default function SectionRoster() {
  const { sectionId } = useParams();
  const [section, setSection] = useState(null);
  const [roster, setRoster] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [makeupFor, setMakeupFor] = useState(null); // student row
  const [tests, setTests] = useState([]);

  useEffect(() => {
    let alive = true;
    setSection(null); setRoster(null); setError(null);
    Promise.all([
      getSectionDetail(sectionId),
      getSectionRoster(sectionId),
      // Tests linked to this section's course (so the makeup dialog can offer
      // only relevant tests). Cheap to fetch all + filter client-side.
      listTests().catch(() => []),
      listTestCourses().catch(() => []),
    ]).then(([s, r, ts, tcs]) => {
      if (!alive) return;
      setSection(s); setRoster(r);
      const courseId = s?.course?.id;
      // Tests linked to this course either via legacy `course_id` or via
      // the `test_courses` join.
      const linked = (ts || []).filter(t => {
        if (t.course_id === courseId) return true;
        return (tcs || []).some(j => j.test_id === t.id && j.course_id === courseId);
      });
      setTests(linked);
    }).catch(e => { if (alive) { setError(e.message || String(e)); setRoster([]); } });
    return () => { alive = false; };
  }, [sectionId]);

  const filtered = useMemo(() => {
    if (!roster) return [];
    const term = q.trim().toLowerCase();
    if (!term) return roster;
    return roster.filter(r =>
      `${r.student.first_name ?? ""} ${r.student.last_name ?? ""}`.toLowerCase().includes(term) ||
      (r.student.student_id || "").toLowerCase().includes(term)
    );
  }, [roster, q]);

  const teacherNames = (section?.teachers || []).map(t => fullName(t)).filter(Boolean).join(", ");

  return (
    <AppShell>
      <div className="mb-4">
        <Button asChild size="sm" variant="ghost" data-testid="roster-back">
          <Link to="/admin/sections"><ArrowLeft className="h-4 w-4 mr-1" /> Back to sections</Link>
        </Button>
      </div>

      <PageHeader
        title={section ? (section.course?.title || "Section") : "Loading…"}
        subtitle={section
          ? `${section.section_code}${section.campus?.name ? ` — ${section.campus.name}` : ""}${teacherNames ? ` — ${teacherNames}` : ""}`
          : null}
      />

      {error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="roster-error">{error}</div>}

      {section === null && !error && (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading section…
        </div>
      )}

      {section && !error && (
        <>
          {/* P2: proctor launcher per available test */}
          {tests.length > 0 && (
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="text-sm">
                    <div className="font-medium flex items-center gap-2"><Play className="h-4 w-4" /> Proctor a test</div>
                    <div className="text-xs text-muted-foreground">Launch a live test session for this class.</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {tests.map(t => {
                      const phases = [];
                      if (t.boc_opens_at) phases.push("BOC");
                      if (t.eoc_opens_at) phases.push("EOC");
                      if (phases.length === 0) phases.push("BOC");
                      return phases.map(ph => (
                        <Button key={`${t.id}-${ph}`} asChild size="sm" variant="outline" data-testid={`proctor-launch-${t.id}-${ph}`}>
                          <Link to={`/admin/sections/${section.id}/proctor/${t.id}/${ph}`}>
                            <Play className="h-3.5 w-3.5 mr-1" /> {t.name} <Badge variant="secondary" className="ml-2">{ph}</Badge>
                          </Link>
                        </Button>
                      ));
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              <span data-testid="roster-total">{roster ? roster.length : "…"}</span>
              <span className="opacity-70">{roster?.length === 1 ? "student" : "students"}</span>
            </Badge>
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="roster-search"
                placeholder="Search by name or Student ID…"
                value={q}
                onChange={e => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Last name</TableHead>
                    <TableHead>First name</TableHead>
                    <TableHead>Student ID</TableHead>
                    <TableHead className="text-center">Grade</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster === null && (
                    <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading roster…
                    </TableCell></TableRow>
                  )}
                  {roster && filtered.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground" data-testid="roster-empty">
                      {roster.length === 0 ? "No students enrolled in this section." : "No students match your search."}
                    </TableCell></TableRow>
                  )}
                  {filtered.map(r => (
                    <TableRow key={r.enrollment_id} data-testid={`roster-row-${r.student.id}`}>
                      <TableCell className="font-medium">{r.student.last_name || "—"}</TableCell>
                      <TableCell>{r.student.first_name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.student.student_id || "—"}</TableCell>
                      <TableCell className="text-center">{r.student.grade_level ?? "—"}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => setMakeupFor(r.student)} disabled={!tests.length} data-testid={`makeup-${r.student.id}`}>
                          <KeyRound className="h-3.5 w-3.5 mr-1" /> Make-up code
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!makeupFor} onOpenChange={o => { if (!o) setMakeupFor(null); }}>
        {makeupFor && (
          <MakeupDialog
            student={makeupFor}
            tests={tests}
            onClose={() => setMakeupFor(null)}
          />
        )}
      </Dialog>
    </AppShell>
  );
}

function MakeupDialog({ student, tests, onClose }) {
  const [testId, setTestId] = useState(tests[0]?.id || "");
  const [bypass, setBypass] = useState(true);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);

  async function onCreate() {
    if (!testId || busy) return;
    setBusy(true);
    try {
      const row = await createMakeupCode(testId, student.id, bypass);
      setIssued(row);
      toast.success("Make-up code created");
    } catch (e) {
      toast.error(e?.message || "Could not create make-up code");
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    if (!issued?.code) return;
    navigator.clipboard?.writeText(issued.code);
    toast.success("Code copied");
  }

  if (issued) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Make-up code created</DialogTitle>
          <DialogDescription>
            Give this code to {student.first_name} {student.last_name}. It can only be used once and only by this student.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border-2 border-border bg-secondary/40 py-8 px-4 text-center">
          <div className="font-mono font-bold tracking-[0.4em] text-4xl sm:text-5xl select-all" data-testid="makeup-code-display">
            {issued.code}
          </div>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={copyCode}><Copy className="h-3.5 w-3.5 mr-1" /> Copy</Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="makeup-close">Done</Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="font-display">Issue a make-up code</DialogTitle>
        <DialogDescription>
          For {student.first_name} {student.last_name} ({student.student_id}). The code is valid for the rest of today and can be used once.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Test</label>
          <Select value={testId} onValueChange={setTestId}>
            <SelectTrigger data-testid="makeup-test-select"><SelectValue placeholder="Choose a test" /></SelectTrigger>
            <SelectContent>
              {tests.map(t => (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
            </SelectContent>
          </Select>
          {!tests.length && <p className="text-xs text-muted-foreground">No tests are linked to this section's course yet.</p>}
        </div>
        <div className="flex items-start gap-3 rounded-md border border-border p-3">
          <input
            type="checkbox" id="bypass" checked={bypass} onChange={e => setBypass(e.target.checked)}
            className="mt-1" data-testid="makeup-bypass"
          />
          <label htmlFor="bypass" className="text-sm">
            <span className="font-medium">Skip the waiting room.</span>
            <span className="block text-muted-foreground">
              Student starts immediately when they enter the code (recommended for 1:1 make-ups). Uncheck to require a teacher to start the test.
            </span>
          </label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} data-testid="makeup-cancel">Cancel</Button>
        <Button onClick={onCreate} disabled={!testId || busy} data-testid="makeup-create">
          {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…</> : "Create code"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
