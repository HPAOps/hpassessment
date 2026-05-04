import React, { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listTests, listQuestionsForTest, upsertQuestion, deleteQuestion, uploadQuestionImage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Trash2, Upload, Image as ImageIcon } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";

export default function QuestionManager() {
  const { staff } = useAuth();
  const [tests, setTests] = useState([]);
  const [activeTest, setActiveTest] = useState("");
  const [questions, setQuestions] = useState([]);

  useEffect(() => { listTests().then(t => { setTests(t); if (t[0]) setActiveTest(t[0].id); }); }, []);
  useEffect(() => { if (activeTest) listQuestionsForTest(activeTest).then(setQuestions); }, [activeTest]);

  async function refresh() { setQuestions(await listQuestionsForTest(activeTest)); }

  async function onUploadImage(qid, file) {
    const url = await uploadQuestionImage(file);
    await upsertQuestion({ id: qid, image_url: url }, staff?.email);
    toast.success("Image updated");
    refresh();
  }

  async function changeAnswer(q, ans) {
    await upsertQuestion({ ...q, correct_answer: ans }, staff?.email);
    toast.success(`Answer for Q${q.question_number} → ${ans}`);
    refresh();
  }

  async function onDelete(q) {
    if (!confirm(`Delete question ${q.question_number}?`)) return;
    await deleteQuestion(q.id, staff?.email);
    toast.success("Question deleted");
    refresh();
  }

  async function bulkUpload(files) {
    const filesArr = Array.from(files);
    let matched = 0;
    for (const f of filesArr) {
      const m = f.name.match(/q0?(\d+)/i);
      if (!m) continue;
      const qn = parseInt(m[1], 10);
      const q = questions.find(x => x.question_number === qn);
      if (!q) continue;
      const url = await uploadQuestionImage(f);
      await upsertQuestion({ id: q.id, image_url: url }, staff?.email);
      matched += 1;
    }
    toast.success(`Replaced ${matched} of ${filesArr.length} images`);
    refresh();
  }

  return (
    <AppShell>
      <PageHeader title="Question Bank" subtitle="Upload, replace, and curate question images for each test." />

      <Card className="mb-6">
        <CardContent className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-2">
            <Label>Test</Label>
            <Select value={activeTest} onValueChange={setActiveTest}>
              <SelectTrigger data-testid="qmgr-test-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {tests.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.test_type})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Bulk replace by filename (q01.png, q02.png, …)</Label>
            <Input type="file" multiple accept="image/*" onChange={e => bulkUpload(e.target.files)} data-testid="bulk-upload-input" />
          </div>
        </CardContent>
      </Card>

      {questions.length === 0 ? (
        <EmptyState title="No questions yet" description="Use the Test Import wizard or upload images here." icon={ImageIcon} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {questions.sort((a,b)=>a.question_number-b.question_number).map(q => (
            <Card key={q.id} data-testid={`qcard-${q.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="overline">Question {q.question_number}</div>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(q)} aria-label="Delete">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="aspect-[4/3] rounded-md border border-border overflow-hidden bg-secondary/30 flex items-center justify-center">
                  {q.image_url ? <img src={q.image_url} alt={`Q${q.question_number}`} className="max-w-full max-h-full object-contain" /> : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Replace image</Label>
                  <Input type="file" accept="image/*" onChange={e => e.target.files?.[0] && onUploadImage(q.id, e.target.files[0])} className="text-xs" data-testid={`replace-${q.id}`} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Correct answer</Label>
                  <div className="grid grid-cols-4 gap-1">
                    {["A","B","C","D"].map(L => (
                      <button
                        key={L}
                        data-testid={`set-correct-${q.id}-${L}`}
                        onClick={() => changeAnswer(q, L)}
                        className={`h-9 rounded-md text-sm font-medium border ${q.correct_answer === L ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]" : "bg-card border-border hover:border-foreground/40"}`}
                      >{L}</button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
