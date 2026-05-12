import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listQuestionsForTest, listPassagesForTest, listTests } from "@/lib/api";
import { FileText, Image as ImageIcon, Layers } from "lucide-react";
import FormattedText from "@/components/common/FormattedText";

// Passage-grouped preview: for text-based tests, we show each passage with
// ALL of its attached questions stacked below it, then the next passage.
// This mirrors how the printed booklet is laid out (one reading passage
// followed by every question that references it) and makes verification of
// shared-passage grouping (Q15+Q16, etc.) obvious at a glance.
//
// Image-based tests retain the legacy one-at-a-time preview.
export default function TestPreview() {
  const { testId } = useParams();
  const nav = useNavigate();
  const [test, setTest] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [passages, setPassages] = useState([]);
  const [imgIdx, setImgIdx] = useState(0); // image-mode only

  useEffect(() => {
    (async () => {
      const tests = await listTests();
      const t = tests.find(x => x.id === testId);
      setTest(t);
      const qs = (await listQuestionsForTest(testId))
        .sort((a, b) => a.question_number - b.question_number);
      setQuestions(qs);
      if (t?.format === "text") setPassages(await listPassagesForTest(testId));
    })();
  }, [testId]);

  // Group questions by passage, preserving booklet order
  // (passages ordered by display_order, standalone questions in q-number order).
  const grouped = useMemo(() => {
    if (!test || test.format !== "text") return null;
    const passById = new Map(passages.map(p => [p.id, p]));
    const result = [];
    const seenPassages = new Set();
    const standalones = [];
    // Walk questions in numeric order so passage groups appear in the order
    // the booklet introduces them.
    for (const q of questions) {
      if (q.passage_id) {
        if (!seenPassages.has(q.passage_id)) {
          const p = passById.get(q.passage_id);
          result.push({ passage: p, questions: [q] });
          seenPassages.add(q.passage_id);
        } else {
          // Append to the existing group
          const existing = result.find(g => g.passage?.id === q.passage_id);
          if (existing) existing.questions.push(q);
        }
      } else {
        standalones.push(q);
      }
    }
    if (standalones.length) result.push({ passage: null, questions: standalones });
    return result;
  }, [test, questions, passages]);

  if (!test) return <AppShell><div className="text-sm text-muted-foreground">Loading…</div></AppShell>;
  const isText = test.format === "text";

  return (
    <AppShell>
      <PageHeader
        title={`Preview · ${test.name}`}
        subtitle={isText
          ? "Walk through the test exactly as it's laid out — each passage followed by every question that references it. The correct answer is highlighted (admin view only)."
          : "Walk through every question as a student would see it (admin view shows the correct answer)."}
        actions={<Button variant="outline" onClick={() => nav("/admin/tests")} data-testid="back-tests">Back to tests</Button>}
      />

      {isText && grouped && (
        <>
          <Card className="mb-4">
            <CardContent className="p-4 flex items-center gap-3 flex-wrap text-sm">
              <Badge variant="outline" className="gap-1.5" data-testid="preview-summary-passages">
                <Layers className="h-3.5 w-3.5" />
                {grouped.filter(g => g.passage).length} passages
              </Badge>
              <Badge variant="outline" data-testid="preview-summary-questions">
                {questions.length} questions
              </Badge>
              {grouped.find(g => !g.passage) && (
                <Badge variant="outline" className="border-amber-300 text-amber-800">
                  {grouped.find(g => !g.passage).questions.length} questions without a passage
                </Badge>
              )}
              <div className="text-xs text-muted-foreground ml-auto">
                Shared-passage groups (e.g. Q15+Q16) appear as one block.
              </div>
            </CardContent>
          </Card>

          <div className="space-y-8">
            {grouped.map((group, gIdx) => (
              <div key={gIdx} className="space-y-3" data-testid={`preview-group-${gIdx}`}>
                {/* Passage header bar */}
                {group.passage ? (
                  <div className="flex items-center gap-3 mb-3">
                    <Badge className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      Passage {gIdx + 1}
                    </Badge>
                    <div className="text-sm text-muted-foreground">
                      Question{group.questions.length === 1 ? "" : "s"} {group.questions.map(q => `#${q.question_number}`).join(" + ")}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 mb-3">
                    <Badge variant="outline">Standalone questions (no passage)</Badge>
                    <div className="text-sm text-muted-foreground">
                      {group.questions.map(q => `Q${q.question_number}`).join(", ")}
                    </div>
                  </div>
                )}

                {/* Passage card */}
                {group.passage && (
                  <Card data-testid={`preview-passage-${gIdx}`}>
                    <CardContent className="p-0">
                      {group.passage.title && (
                        <div className="px-6 py-3 bg-secondary/30 border-b border-border">
                          <FormattedText
                            text={group.passage.title}
                            as="div"
                            className="font-display font-bold text-base whitespace-pre-wrap"
                          />
                        </div>
                      )}
                      <div className="px-6 py-5">
                        <FormattedText
                          text={group.passage.body}
                          as="div"
                          className="whitespace-pre-wrap leading-relaxed text-[15px]"
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* All questions for this passage */}
                <div className="space-y-3">
                  {group.questions.map(q => (
                    <Card key={q.id} className="border-l-4 border-l-[hsl(var(--accent))]" data-testid={`preview-question-${q.question_number}`}>
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="overline">Question {q.question_number}</div>
                          <Badge variant="outline" className="font-mono shrink-0">Correct: {q.correct_answer}</Badge>
                        </div>
                        <FormattedText
                          text={q.question_text}
                          as="div"
                          className="text-base leading-relaxed whitespace-pre-wrap mb-4"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {["A","B","C","D"].map(L => {
                            const choiceText = q[`choice_${L.toLowerCase()}`];
                            const isCorrect = q.correct_answer === L;
                            return (
                              <div
                                key={L}
                                data-testid={`preview-q${q.question_number}-${L}`}
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
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* IMAGE MODE: legacy one-at-a-time preview */}
      {!isText && questions.length > 0 && (() => {
        const q = questions[imgIdx];
        return (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="overline flex items-center gap-2">
                  <ImageIcon className="h-3.5 w-3.5" /> Question {imgIdx + 1} of {questions.length}
                </div>
                <Badge variant="outline" className="font-mono" data-testid="preview-correct">Correct: {q.correct_answer}</Badge>
              </div>
              <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-4 flex justify-center">
                {q.image_url ? <img src={q.image_url} alt="" className="max-h-[60vh]" /> : <span className="text-sm text-muted-foreground">No image uploaded for this question</span>}
              </div>
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {["A","B","C","D"].map(L => (
                  <div key={L} className={`rounded-md border-2 p-3 text-center font-display text-lg font-bold ${q.correct_answer === L ? "border-[hsl(var(--success))] bg-[hsl(var(--success))]/10" : "border-border bg-card"}`}>{L}</div>
                ))}
              </div>
              <div className="mt-6 flex justify-between">
                <Button variant="outline" disabled={imgIdx === 0} onClick={() => setImgIdx(i => i - 1)} data-testid="preview-prev">Previous</Button>
                <Button disabled={imgIdx >= questions.length - 1} onClick={() => setImgIdx(i => i + 1)} data-testid="preview-next">Next</Button>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </AppShell>
  );
}
