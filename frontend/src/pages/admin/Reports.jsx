import React, { useEffect, useMemo, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { listAttempts, listCampuses, listCourses, listGrowthResults, listStudents, listTeachers, listTests, listQuestionsForTest, resetAttempt } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, Legend } from "recharts";
import { toast } from "sonner";

export default function Reports() {
  const { staff } = useAuth();
  const [data, setData] = useState(null);
  const [activeTest, setActiveTest] = useState("");
  const [questions, setQuestions] = useState([]);

  useEffect(() => {
    (async () => {
      const [campuses, courses, students, teachers, tests, attempts, growth] = await Promise.all([
        listCampuses(), listCourses(), listStudents(), listTeachers(), listTests(), listAttempts(), listGrowthResults(),
      ]);
      setData({ campuses, courses, students, teachers, tests, attempts, growth });
      if (tests[0]) setActiveTest(tests[0].id);
    })();
  }, []);

  useEffect(() => { if (activeTest) listQuestionsForTest(activeTest).then(setQuestions); }, [activeTest]);

  // Question analysis for selected test (must be declared before any early return).
  const qAnalysis = useMemo(() => {
    if (!data || !activeTest || questions.length === 0) return [];
    const testAttempts = data.attempts.filter(a => a.test_id === activeTest && a.status === "submitted");
    return [...questions].sort((a,b)=>a.question_number-b.question_number).map(q => {
      const responses = testAttempts.map(a => a.responses.find(r => r.question_id === q.id)?.selected_answer).filter(Boolean);
      const counts = { A:0, B:0, C:0, D:0 };
      responses.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
      const correctCount = counts[q.correct_answer] || 0;
      const pct = responses.length ? Math.round((correctCount / responses.length) * 100) : 0;
      const wrongLetters = ["A","B","C","D"].filter(l => l !== q.correct_answer);
      const mostWrong = wrongLetters.sort((a,b) => counts[b] - counts[a])[0];
      return { q, total: responses.length, correctCount, percent: pct, counts, mostWrong };
    });
  }, [activeTest, questions, data]);

  if (!data) return <AppShell><div className="text-sm text-muted-foreground">Loading…</div></AppShell>;

  // Per-student rows
  const studentRows = data.students.map(s => {
    const sa = data.attempts.filter(a => a.student_id === s.id && a.status === "submitted");
    const boc = sa.find(a => data.tests.find(t => t.id === a.test_id)?.test_type === "BOC");
    const eoc = sa.find(a => data.tests.find(t => t.id === a.test_id)?.test_type === "EOC");
    const g = data.growth.find(g => g.student_id === s.id);
    return { s, boc, eoc, growth: g };
  });

  async function onReset(att) {
    if (!confirm(`Reset attempt for student? They'll be able to re-take.`)) return;
    await resetAttempt(att.id, staff?.email);
    toast.success("Attempt reset");
    const next = await listAttempts();
    setData(d => ({ ...d, attempts: next }));
  }

  return (
    <AppShell>
      <PageHeader title="Reports" subtitle="Drill into students, courses, teachers, and question-level analysis." />
      <Tabs defaultValue="students">
        <TabsList>
          <TabsTrigger value="students" data-testid="tab-students">By student</TabsTrigger>
          <TabsTrigger value="courses" data-testid="tab-courses">By course</TabsTrigger>
          <TabsTrigger value="teachers" data-testid="tab-teachers">By teacher</TabsTrigger>
          <TabsTrigger value="questions" data-testid="tab-questions">Question analysis</TabsTrigger>
          <TabsTrigger value="missing" data-testid="tab-missing">Missing</TabsTrigger>
        </TabsList>

        <TabsContent value="students" className="mt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Student</TableHead><TableHead>ID</TableHead><TableHead>Campus</TableHead>
                <TableHead className="text-center">BOC</TableHead><TableHead className="text-center">EOC</TableHead>
                <TableHead className="text-center">Growth %</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {studentRows.map(({s, boc, eoc, growth}) => (
                  <TableRow key={s.id} data-testid={`report-row-${s.id}`}>
                    <TableCell className="font-medium">{s.first_name} {s.last_name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.student_id}</TableCell>
                    <TableCell className="text-xs">{data.campuses.find(c => c.id === s.campus_id)?.name}</TableCell>
                    <TableCell className="text-center">{boc?.score_percent != null ? `${boc.score_percent}%` : "—"}</TableCell>
                    <TableCell className="text-center">{eoc?.score_percent != null ? `${eoc.score_percent}%` : "—"}</TableCell>
                    <TableCell className="text-center font-mono">{growth?.growth_percentage != null ? `${growth.growth_percentage}%` : "—"}</TableCell>
                    <TableCell className="text-right">
                      {boc && <Button variant="ghost" size="sm" onClick={() => onReset(boc)} data-testid={`reset-${boc.id}`}>Reset BOC</Button>}
                      {eoc && <Button variant="ghost" size="sm" onClick={() => onReset(eoc)} data-testid={`reset-${eoc.id}`}>Reset EOC</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="courses" className="mt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Course</TableHead><TableHead className="text-center">Tested</TableHead><TableHead className="text-center">Avg BOC</TableHead><TableHead className="text-center">Avg EOC</TableHead><TableHead className="text-center">Avg growth %</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.courses.map(c => {
                  const cTests = data.tests.filter(t => t.course_id === c.id);
                  const cAttempts = data.attempts.filter(a => cTests.find(t => t.id === a.test_id) && a.status === "submitted");
                  const studentSet = new Set(cAttempts.map(a => a.student_id));
                  const bocAvg = avg(cAttempts.filter(a => cTests.find(t => t.id === a.test_id)?.test_type === "BOC").map(a => a.score_percent));
                  const eocAvg = avg(cAttempts.filter(a => cTests.find(t => t.id === a.test_id)?.test_type === "EOC").map(a => a.score_percent));
                  const growthAvg = avg(data.growth.filter(g => g.course_id === c.id).map(g => g.growth_percentage));
                  return (
                    <TableRow key={c.id}>
                      <TableCell>{c.title}</TableCell>
                      <TableCell className="text-center">{studentSet.size}</TableCell>
                      <TableCell className="text-center">{bocAvg ? `${bocAvg}%` : "—"}</TableCell>
                      <TableCell className="text-center">{eocAvg ? `${eocAvg}%` : "—"}</TableCell>
                      <TableCell className="text-center font-mono">{growthAvg ? `${growthAvg}%` : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="teachers" className="mt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Teacher</TableHead><TableHead>Campus</TableHead><TableHead className="text-center">Sections</TableHead><TableHead className="text-center">Students</TableHead><TableHead className="text-center">Avg BOC</TableHead><TableHead className="text-center">Avg EOC</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.teachers.map(t => {
                  const camp = data.campuses.find(c => c.id === t.campus_id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>{t.first_name} {t.last_name}</TableCell>
                      <TableCell>{camp?.name}</TableCell>
                      <TableCell className="text-center">—</TableCell>
                      <TableCell className="text-center">—</TableCell>
                      <TableCell className="text-center">—</TableCell>
                      <TableCell className="text-center">—</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="questions" className="mt-4">
          <Card className="mb-4"><CardContent className="p-4 flex items-center gap-3">
            <span className="text-sm font-medium">Test:</span>
            <Select value={activeTest} onValueChange={setActiveTest}>
              <SelectTrigger className="max-w-md" data-testid="qa-test-select"><SelectValue /></SelectTrigger>
              <SelectContent>{data.tests.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </CardContent></Card>
          <Card><CardContent className="p-6">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={qAnalysis.map(x => ({ name: `Q${x.q.question_number}`, percent: x.percent, mostWrong: x.mostWrong }))}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} domain={[0,100]} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="percent" radius={[6,6,0,0]}>
                    {qAnalysis.map((x, i) => <Cell key={i} fill={x.percent >= 70 ? "hsl(var(--success))" : x.percent >= 50 ? "hsl(var(--chart-2))" : "hsl(var(--destructive))"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-6">
              <Table>
                <TableHeader><TableRow><TableHead>Q#</TableHead><TableHead className="text-center">% Correct</TableHead><TableHead className="text-center">A</TableHead><TableHead className="text-center">B</TableHead><TableHead className="text-center">C</TableHead><TableHead className="text-center">D</TableHead><TableHead>Most-picked wrong</TableHead></TableRow></TableHeader>
                <TableBody>
                  {qAnalysis.map(x => (
                    <TableRow key={x.q.id} data-testid={`qa-row-${x.q.id}`}>
                      <TableCell className="font-mono">Q{x.q.question_number}</TableCell>
                      <TableCell className="text-center font-mono">{x.percent}%</TableCell>
                      {["A","B","C","D"].map(L => (
                        <TableCell key={L} className={`text-center font-mono ${x.q.correct_answer === L ? "text-[hsl(var(--success))] font-bold" : ""}`}>{x.counts[L] || 0}</TableCell>
                      ))}
                      <TableCell><Badge variant="outline">{x.mostWrong}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="missing" className="mt-4">
          <Card><CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <MissingList title="Students missing BOC" rows={studentRows.filter(x => !x.boc).map(x => x.s)} />
            <MissingList title="Students missing EOC" rows={studentRows.filter(x => !x.eoc).map(x => x.s)} />
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function MissingList({ title, rows }) {
  return (
    <div>
      <div className="overline mb-2">{title} ({rows.length})</div>
      <ul className="space-y-1 max-h-80 overflow-auto">
        {rows.map(s => (
          <li key={s.id} className="text-sm flex items-center justify-between border-b border-border pb-1">
            <span>{s.first_name} {s.last_name}</span>
            <span className="font-mono text-xs text-muted-foreground">{s.student_id}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-muted-foreground">All students completed.</li>}
      </ul>
    </div>
  );
}

function avg(arr) {
  const c = arr.filter(x => x != null);
  if (!c.length) return 0;
  return Math.round(c.reduce((a,b)=>a+b,0)/c.length);
}
