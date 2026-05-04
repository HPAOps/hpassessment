import React, { useEffect, useRef, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import JSZip from "jszip";
import Papa from "papaparse";
import { listCourses, listTests, createTest, recordTestImport, listTestImports, upsertQuestion, uploadQuestionImage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ChevronRight, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function TestImport() {
  const { staff } = useAuth();
  const [step, setStep] = useState(1);
  const [courses, setCourses] = useState([]);
  const [history, setHistory] = useState([]);

  const [meta, setMeta] = useState({
    name: "", course_id: "", test_type: "BOC", school_year_id: "sy-2627",
    scope: "district", opens_at: "", closes_at: "",
  });
  const [bookletFile, setBookletFile] = useState(null);
  const [keyFile, setKeyFile] = useState(null);
  const [keyEntries, setKeyEntries] = useState([]); // {qn, ans}
  const [imageMap, setImageMap] = useState({}); // qn -> dataURL

  useEffect(() => {
    listCourses().then(setCourses);
    listTestImports().then(setHistory);
  }, []);

  async function parseAnswerKey(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "csv") {
      const text = await file.text();
      const { data } = Papa.parse(text, { header: false, skipEmptyLines: true });
      const out = [];
      data.forEach(row => {
        const num = parseInt(String(row[0]).replace(/\D/g,""), 10);
        const ans = (row[1] || "").toString().trim().toUpperCase().match(/[ABCD]/)?.[0];
        if (num && ans) out.push({ qn: num, ans });
      });
      return out;
    }
    // simple text fallback: lines like "1. A" or "Q1: B"
    const text = await file.text().catch(() => "");
    const lines = text.split(/\n+/);
    const out = [];
    lines.forEach(l => {
      const m = l.match(/(\d+)\D+([ABCD])/i);
      if (m) out.push({ qn: parseInt(m[1],10), ans: m[2].toUpperCase() });
    });
    return out;
  }

  async function onKeyFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setKeyFile(f);
    const entries = await parseAnswerKey(f);
    if (entries.length === 0) toast.warning("Could not auto-parse the answer key. You can edit manually below.");
    setKeyEntries(entries);
  }

  async function handleQuestionImages(files) {
    const next = { ...imageMap };
    const arr = Array.from(files);
    // If a single ZIP, expand it
    for (const f of arr) {
      if (f.name.toLowerCase().endsWith(".zip")) {
        const zip = await JSZip.loadAsync(f);
        for (const entryName of Object.keys(zip.files)) {
          if (zip.files[entryName].dir) continue;
          const m = entryName.match(/q0?(\d+)/i);
          if (!m) continue;
          const blob = await zip.files[entryName].async("blob");
          const fileLike = new File([blob], entryName);
          const url = await uploadQuestionImage(fileLike);
          next[parseInt(m[1],10)] = url;
        }
      } else {
        const m = f.name.match(/q0?(\d+)/i);
        if (!m) continue;
        const url = await uploadQuestionImage(f);
        next[parseInt(m[1],10)] = url;
      }
    }
    setImageMap(next);
    toast.success(`${Object.keys(next).length} images mapped`);
  }

  async function commit() {
    const test = await createTest({
      ...meta,
      question_count: keyEntries.length,
      is_published: false,
    }, staff?.email);
    for (const { qn, ans } of keyEntries) {
      const id = `${test.id}-q${qn}`;
      await upsertQuestion({
        id, test_id: test.id, question_number: qn,
        correct_answer: ans, image_url: imageMap[qn] || `https://picsum.photos/seed/${id}/1000/640`,
        is_active: true,
      }, staff?.email);
    }
    await recordTestImport({
      course_id: meta.course_id,
      test_id: test.id,
      booklet_filename: bookletFile?.name,
      answer_key_filename: keyFile?.name,
      detected_questions: keyEntries.length,
      uploaded_images: Object.keys(imageMap).length,
      status: "completed",
    }, staff?.email);
    toast.success("Test imported! Review and publish from Tests.");
    setStep(1); setMeta({ name:"", course_id:"", test_type:"BOC", school_year_id:"sy-2627", scope:"district", opens_at:"", closes_at:"" });
    setBookletFile(null); setKeyFile(null); setKeyEntries([]); setImageMap({});
    setHistory(await listTestImports());
  }

  const missing = keyEntries.filter(e => !imageMap[e.qn]).length;

  return (
    <AppShell>
      <PageHeader title="Test Import Wizard" subtitle="Upload a quiz/test booklet and answer key together. Review and confirm before publishing." />

      <Card className="mb-6">
        <CardContent className="p-6">
          <Stepper step={step} />
        </CardContent>
      </Card>

      {step === 1 && (
        <Card>
          <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 space-y-2"><Label>Test name</Label><Input value={meta.name} onChange={e=>setMeta({...meta, name:e.target.value})} placeholder="Algebra 1A BOC" data-testid="ti-name" /></div>
            <div className="space-y-2">
              <Label>Course</Label>
              <Select value={meta.course_id} onValueChange={v=>setMeta({...meta, course_id:v})}>
                <SelectTrigger data-testid="ti-course"><SelectValue placeholder="Choose course" /></SelectTrigger>
                <SelectContent>{courses.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={meta.test_type} onValueChange={v=>setMeta({...meta, test_type:v})}>
                <SelectTrigger data-testid="ti-type"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="BOC">BOC</SelectItem><SelectItem value="EOC">EOC</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Opens</Label><Input type="date" value={meta.opens_at} onChange={e=>setMeta({...meta, opens_at:e.target.value})} /></div>
            <div className="space-y-2"><Label>Closes</Label><Input type="date" value={meta.closes_at} onChange={e=>setMeta({...meta, closes_at:e.target.value})} /></div>
            <div className="md:col-span-2 flex justify-end">
              <Button onClick={()=>setStep(2)} disabled={!meta.name || !meta.course_id} data-testid="ti-next-1">Continue <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardContent className="p-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quiz / test booklet (.docx, .pdf — stored for audit)</Label>
                <Input type="file" onChange={e => setBookletFile(e.target.files?.[0])} data-testid="ti-booklet" />
                {bookletFile && <Badge variant="outline">{bookletFile.name}</Badge>}
              </div>
              <div className="space-y-2">
                <Label>Answer key (.csv, .txt, .docx)</Label>
                <Input type="file" onChange={onKeyFile} data-testid="ti-keyfile" />
                {keyFile && <Badge variant="outline">{keyFile.name}</Badge>}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={()=>setStep(1)}>Back</Button>
              <Button onClick={()=>setStep(3)} disabled={keyEntries.length === 0} data-testid="ti-next-2">Continue <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-2">
              <Label>Question images — multiple files or a ZIP (filenames like q01.png, q02.png, …)</Label>
              <Input type="file" multiple accept="image/*,.zip" onChange={e => handleQuestionImages(e.target.files)} data-testid="ti-images" />
            </div>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <Card className="border-dashed"><CardContent className="p-4 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />
                <div><div className="font-medium">{keyEntries.length} answer-key entries detected</div><div className="text-xs text-muted-foreground">Review below.</div></div>
              </CardContent></Card>
              <Card className="border-dashed"><CardContent className="p-4 flex items-center gap-3">
                {missing === 0 ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" /> : <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning))]" />}
                <div><div className="font-medium">{missing === 0 ? "All images mapped" : `${missing} images missing`}</div><div className="text-xs text-muted-foreground">Upload more or proceed (placeholder used).</div></div>
              </CardContent></Card>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Q#</TableHead><TableHead>Image</TableHead><TableHead className="text-right">Answer</TableHead></TableRow></TableHeader>
              <TableBody>
                {keyEntries.sort((a,b)=>a.qn-b.qn).map(e => (
                  <TableRow key={e.qn} data-testid={`ti-row-${e.qn}`}>
                    <TableCell className="font-mono">{e.qn}</TableCell>
                    <TableCell>
                      {imageMap[e.qn] ? <img src={imageMap[e.qn]} className="h-12 rounded border border-border" alt="" /> : <span className="text-xs text-muted-foreground">Will use placeholder</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{e.ans}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={()=>setStep(2)}>Back</Button>
              <Button onClick={commit} data-testid="ti-commit">Commit test</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-8">
        <h3 className="font-display text-xl font-semibold mb-3">Recent imports</h3>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Course</TableHead><TableHead>Booklet</TableHead><TableHead>Key</TableHead><TableHead className="text-center">Q's</TableHead><TableHead className="text-center">Imgs</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs">{new Date(h.uploaded_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{courses.find(c=>c.id===h.course_id)?.title}</TableCell>
                    <TableCell className="text-xs font-mono">{h.booklet_filename}</TableCell>
                    <TableCell className="text-xs font-mono">{h.answer_key_filename}</TableCell>
                    <TableCell className="text-center font-mono">{h.detected_questions}</TableCell>
                    <TableCell className="text-center font-mono">{h.uploaded_images}</TableCell>
                    <TableCell><Badge variant="secondary">{h.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {history.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No test imports yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Stepper({ step }) {
  const steps = ["Test details", "Files", "Review & commit"];
  return (
    <div className="flex items-center gap-3">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-3 flex-1">
          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${step > i ? "bg-[hsl(var(--success))] text-white" : step === i+1 ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "bg-secondary text-muted-foreground"}`}>{i+1}</div>
          <div className="flex-1">
            <div className="text-sm font-medium">{s}</div>
          </div>
          {i < steps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}
