import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listQuestionsForTest, listTests } from "@/lib/api";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function TestPreview() {
  const { testId } = useParams();
  const nav = useNavigate();
  const [test, setTest] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const tests = await listTests();
      setTest(tests.find(t => t.id === testId));
      setQuestions((await listQuestionsForTest(testId)).sort((a,b)=>a.question_number-b.question_number));
    })();
  }, [testId]);

  if (!test) return <AppShell><div className="text-sm text-muted-foreground">Loading…</div></AppShell>;
  const q = questions[idx];

  return (
    <AppShell>
      <PageHeader title={`Preview · ${test.name}`} subtitle="Walk through every question as a student would see it (admin view shows the correct answer)." actions={
        <Button variant="outline" onClick={()=>nav("/admin/tests")} data-testid="back-tests">Back to tests</Button>
      } />

      {q && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="overline">Question {idx+1} of {questions.length}</div>
              <Badge variant="outline" className="font-mono">Correct: {q.correct_answer}</Badge>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4 flex justify-center">
              <img src={q.image_url} alt="" className="max-h-[60vh]" />
            </div>
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {["A","B","C","D"].map(L => (
                <div key={L} className={`rounded-md border-2 p-3 text-center font-display text-lg font-bold ${q.correct_answer === L ? "border-[hsl(var(--success))] bg-[hsl(var(--success))]/10" : "border-border bg-card"}`}>{L}</div>
              ))}
            </div>
            <div className="mt-6 flex justify-between">
              <Button variant="outline" disabled={idx===0} onClick={() => setIdx(i => i-1)} data-testid="preview-prev"><ArrowLeft className="h-4 w-4" /> Previous</Button>
              <Button disabled={idx >= questions.length - 1} onClick={() => setIdx(i => i+1)} data-testid="preview-next">Next <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
