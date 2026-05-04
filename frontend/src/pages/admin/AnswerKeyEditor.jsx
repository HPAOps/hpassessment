import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listTests, listQuestionsForTest, upsertQuestion } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export default function AnswerKeyEditor() {
  const { staff } = useAuth();
  const [params] = useSearchParams();
  const [tests, setTests] = useState([]);
  const [activeTest, setActiveTest] = useState("");
  const [questions, setQuestions] = useState([]);

  useEffect(() => {
    (async () => {
      const t = await listTests();
      setTests(t);
      const initial = params.get("test") || t[0]?.id || "";
      setActiveTest(initial);
    })();
  }, [params]);

  useEffect(() => { if (activeTest) listQuestionsForTest(activeTest).then(setQuestions); }, [activeTest]);

  async function setKey(q, ans) {
    await upsertQuestion({ ...q, correct_answer: ans }, staff?.email);
    setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, correct_answer: ans } : x));
  }

  const missingImages = questions.filter(q => !q.image_url).length;
  const missingKey = questions.filter(q => !["A","B","C","D"].includes(q.correct_answer)).length;

  async function pasteBulk(text) {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    let updated = 0;
    for (const line of lines) {
      const m = line.match(/^(\d+)\D+([ABCD])$/i);
      if (!m) continue;
      const qn = parseInt(m[1], 10);
      const ans = m[2].toUpperCase();
      const q = questions.find(qq => qq.question_number === qn);
      if (q) {
        await upsertQuestion({ ...q, correct_answer: ans }, staff?.email);
        updated += 1;
      }
    }
    setQuestions(await listQuestionsForTest(activeTest));
    toast.success(`Updated ${updated} answers`);
  }

  return (
    <AppShell>
      <PageHeader title="Answer Key Editor" subtitle="Review and correct answer keys. Never visible to students." />

      <Card className="mb-6">
        <CardContent className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <Label>Test</Label>
            <Select value={activeTest} onValueChange={setActiveTest}>
              <SelectTrigger data-testid="key-test-select"><SelectValue /></SelectTrigger>
              <SelectContent>{tests.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 space-y-2">
            <Label>Bulk paste (one per line — e.g. <span className="font-mono">1: A</span>)</Label>
            <Input placeholder="1: A   2: B   3: C ..." onKeyDown={(e) => { if (e.key === "Enter") pasteBulk(e.target.value); }} data-testid="bulk-paste-input" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            {missingKey === 0 ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" /> : <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning))]" />}
            <div>
              <div className="text-sm font-medium">{missingKey === 0 ? "All answers entered" : `${missingKey} questions missing answer`}</div>
              <div className="text-xs text-muted-foreground">Correct answer must be A, B, C, or D.</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            {missingImages === 0 ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" /> : <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning))]" />}
            <div>
              <div className="text-sm font-medium">{missingImages === 0 ? "All question images uploaded" : `${missingImages} questions missing image`}</div>
              <div className="text-xs text-muted-foreground">Upload missing images via Question Bank.</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Q#</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>Standard</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead className="text-right">Correct answer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.sort((a,b)=>a.question_number - b.question_number).map(q => (
                <TableRow key={q.id} data-testid={`key-row-${q.id}`}>
                  <TableCell className="font-mono">{q.question_number}</TableCell>
                  <TableCell>
                    {q.image_url ? <img src={q.image_url} className="h-12 rounded border border-border" alt="" /> : <span className="text-xs text-destructive">Missing</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{q.standard_tag || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground capitalize">{q.difficulty || "—"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {["A","B","C","D"].map(L => (
                        <button
                          key={L}
                          data-testid={`set-key-${q.id}-${L}`}
                          onClick={() => setKey(q, L)}
                          className={`h-9 w-10 rounded-md text-sm font-semibold border ${q.correct_answer === L ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]" : "bg-card border-border hover:border-foreground/40"}`}
                        >{L}</button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {questions.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-12">Pick a test to edit its answer key.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
