import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listQuestionsForTest, listPassagesForTest, listTests } from "@/lib/api";
import { ArrowLeft, ArrowRight, FileText, Image as ImageIcon } from "lucide-react";
import FormattedText from "@/components/common/FormattedText";

export default function TestPreview() {
  const { testId } = useParams();
  const nav = useNavigate();
  const [test, setTest] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [passages, setPassages] = useState([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const tests = await listTests();
      const t = tests.find(x => x.id === testId);
      setTest(t);
      const qs = (await listQuestionsForTest(testId))
        .sort((a, b) => a.question_number - b.question_number);
      setQuestions(qs);
      if (t?.format === "text") {
        setPassages(await listPassagesForTest(testId));
      }
    })();
  }, [testId]);

  if (!test) return <AppShell><div className="text-sm text-muted-foreground">Loading…</div></AppShell>;
  const q = questions[idx];
  const isText = test.format === "text";
  const passage = q && q.passage_id ? passages.find(p => p.id === q.passage_id) : null;

  return (
    <AppShell>
      <PageHeader
        title={`Preview · ${test.name}`}
        subtitle="Walk through every question as a student would see it (admin view shows the correct answer)."
        actions={<Button variant="outline" onClick={() => nav("/admin/tests")} data-testid="back-tests">Back to tests</Button>}
      />

      {q && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="overline flex items-center gap-2">
                {isText ? <FileText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                Question {idx + 1} of {questions.length}
              </div>
              <Badge variant="outline" className="font-mono" data-testid="preview-correct">Correct: {q.correct_answer}</Badge>
            </div>

            {/* TEXT MODE: stem → passage → choices (matches booklet layout) */}
            {isText && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-border bg-card px-5 py-4" data-testid="preview-stem">
                  <FormattedText text={q.question_text} as="div" className="text-sm leading-relaxed whitespace-pre-wrap" />
                </div>
                {passage && (
                  <div className="rounded-xl border border-border bg-card overflow-hidden" data-testid="preview-passage">
                    {passage.title && (
                      <div className="px-5 py-2.5 bg-secondary/30 border-b border-border">
                        <FormattedText text={passage.title} as="div" className="font-display font-bold text-sm whitespace-pre-wrap" />
                      </div>
                    )}
                    <div className="px-5 py-4 max-h-[40vh] overflow-auto">
                      <FormattedText text={passage.body} as="div" className="whitespace-pre-wrap leading-relaxed text-sm" />
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {["A","B","C","D"].map(L => {
                    const choiceText = q[`choice_${L.toLowerCase()}`];
                    const isCorrect = q.correct_answer === L;
                    return (
                      <div
                        key={L}
                        data-testid={`preview-choice-${L}`}
                        className={`rounded-lg border-2 p-3 flex items-start gap-3 ${isCorrect ? "border-[hsl(var(--success))] bg-[hsl(var(--success))]/5" : "border-border bg-card"}`}
                      >
                        <div className={`h-8 w-8 rounded-md flex items-center justify-center font-display font-bold text-sm shrink-0 ${isCorrect ? "bg-[hsl(var(--success))] text-white" : "bg-secondary text-foreground"}`}>{L}</div>
                        <div className="flex-1 text-sm leading-relaxed">
                          {choiceText ? <FormattedText text={choiceText} /> : <span className="text-muted-foreground italic">— missing —</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* IMAGE MODE (original behavior) */}
            {!isText && (
              <>
                <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4 flex justify-center">
                  {q.image_url ? <img src={q.image_url} alt="" className="max-h-[60vh]" /> : <span className="text-sm text-muted-foreground">No image uploaded for this question</span>}
                </div>
                <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {["A","B","C","D"].map(L => (
                    <div key={L} className={`rounded-md border-2 p-3 text-center font-display text-lg font-bold ${q.correct_answer === L ? "border-[hsl(var(--success))] bg-[hsl(var(--success))]/10" : "border-border bg-card"}`}>{L}</div>
                  ))}
                </div>
              </>
            )}

            <div className="mt-6 flex justify-between">
              <Button variant="outline" disabled={idx === 0} onClick={() => setIdx(i => i - 1)} data-testid="preview-prev">
                <ArrowLeft className="h-4 w-4" /> Previous
              </Button>
              <Button disabled={idx >= questions.length - 1} onClick={() => setIdx(i => i + 1)} data-testid="preview-next">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
