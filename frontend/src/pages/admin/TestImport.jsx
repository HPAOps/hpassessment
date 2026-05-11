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
import { listCourses, listTests, createTest, recordTestImport, listTestImports, upsertQuestion, uploadQuestionImage, listSchoolYears, importTextTest } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { ChevronRight, Upload, AlertTriangle, CheckCircle2, Image as ImageIcon, FileText } from "lucide-react";
import { CourseMultiSelect } from "@/components/common/CourseMultiSelect";
import { extractDocxImages, extractDocxText } from "@/lib/docxImages";
import { parseTextBookletDocx, validateParsedBooklet } from "@/lib/docxText";

export default function TestImport() {
  const { staff } = useAuth();
  const [step, setStep] = useState(1);
  const [courses, setCourses] = useState([]);
  const [history, setHistory] = useState([]);
  const [schoolYears, setSchoolYears] = useState([]);

  const [meta, setMeta] = useState({
    name: "", course_ids: [],
    boc_opens_at: "", boc_closes_at: "",
    eoc_opens_at: "", eoc_closes_at: "",
    scope: "district",
    format: "image", // "image" | "text"
  });
  const [bookletFile, setBookletFile] = useState(null);
  const [keyFile, setKeyFile] = useState(null);
  const [keyEntries, setKeyEntries] = useState([]); // {qn, ans}
  const [imageMap, setImageMap] = useState({}); // qn -> dataURL
  // Text-mode parsed booklet:
  //   { passages: [{ordinal, title?, body}], questions: [{qn, stem, choices:{A,B,C,D}, passage_ordinal?}] }
  const [textParsed, setTextParsed] = useState(null);
  const [textWarnings, setTextWarnings] = useState([]);

  useEffect(() => {
    listCourses().then(setCourses);
    listTestImports().then(setHistory);
    listSchoolYears().then(setSchoolYears).catch(() => setSchoolYears([]));
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
    // .docx — extract paragraph text and parse line-by-line
    let text = "";
    if (ext === "docx") {
      try { text = await extractDocxText(file); }
      catch { text = ""; }
    } else {
      text = await file.text().catch(() => "");
    }
    // Match patterns like "1 B", "1) B", "1. B", "Q1: B", or even "1 C31 C"
    // where two answers run together (Word column layout flattens to plain text).
    const out = [];
    const re = /(\d{1,3})\s*[\)\.\-:]?\s+([ABCD])(?![A-Z])/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ qn: parseInt(m[1], 10), ans: m[2].toUpperCase() });
    }
    // De-dupe by qn (keep first)
    const seen = new Set();
    return out.filter(e => { if (seen.has(e.qn)) return false; seen.add(e.qn); return true; });
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

  // Booklet upload: behavior depends on test format.
  //   - IMAGE mode: extract embedded images from the .docx
  //   - TEXT mode:  parse paragraphs into passages + questions + choices
  async function onBookletFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBookletFile(f);
    if (!f.name.toLowerCase().endsWith(".docx")) return;

    if (meta.format === "text") {
      const loading = toast.loading("Parsing booklet text…");
      try {
        const parsed = await parseTextBookletDocx(f);
        const warnings = validateParsedBooklet(parsed);
        setTextParsed(parsed);
        setTextWarnings(warnings);
        toast.dismiss(loading);
        toast.success(`Parsed ${parsed.questions.length} questions and ${parsed.passages.length} passages`);
      } catch (err) {
        toast.dismiss(loading);
        toast.error("Couldn't parse the booklet: " + (err.message || err));
      }
      return;
    }

    // IMAGE mode: existing image-extraction path.
    const loading = toast.loading("Extracting question images from booklet…");
    try {
      const items = await extractDocxImages(f);
      if (!items.length) {
        toast.dismiss(loading);
        toast.warning("No images found in this booklet. You can still upload images manually in step 3.");
        return;
      }
      const next = {};
      for (const item of items) {
        const fileLike = new File([item.blob], `q${String(item.qn).padStart(2,"0")}.${item.ext}`, { type: item.blob.type });
        const url = await uploadQuestionImage(fileLike);
        next[item.qn] = url;
      }
      setImageMap(next);
      toast.dismiss(loading);
      toast.success(`Extracted ${items.length} question images from booklet`);
    } catch (err) {
      toast.dismiss(loading);
      toast.error("Couldn't extract images: " + (err.message || err));
    }
  }

  async function commit() {
    try {
      // Pick the school year that contains today, fallback to most recent
      const today = new Date().toISOString().slice(0, 10);
      const sy = schoolYears.find(s =>
        (!s.start_date || s.start_date <= today) &&
        (!s.end_date   || s.end_date   >= today)
      ) || schoolYears[0];

      const qCountForCreate = meta.format === "text"
        ? (textParsed?.questions?.length || 0)
        : keyEntries.length;

      const test = await createTest({
        name: meta.name,
        course_ids: meta.course_ids,
        school_year_id: sy?.id || null,
        scope: meta.scope,
        boc_opens_at: meta.boc_opens_at || null,
        boc_closes_at: meta.boc_closes_at || null,
        eoc_opens_at: meta.eoc_opens_at || null,
        eoc_closes_at: meta.eoc_closes_at || null,
        question_count: qCountForCreate,
        is_published: false,
      }, staff?.email);

      if (meta.format === "text") {
        // Build the payload for admin_import_text_test: merge parsed questions
        // with the answer key (matched by question number).
        const keyByQn = Object.fromEntries(keyEntries.map(e => [e.qn, e.ans]));
        const passages = (textParsed?.passages || []).map(p => ({
          ordinal: p.ordinal,
          title: p.title,
          body: p.body,
        }));
        const questions = (textParsed?.questions || []).map(q => ({
          qn: q.qn,
          question_text: q.stem,
          choice_a: q.choices.A,
          choice_b: q.choices.B,
          choice_c: q.choices.C,
          choice_d: q.choices.D,
          correct: keyByQn[q.qn] || null,
          passage_ordinal: q.passage_ordinal || null,
        }));
        const missingAnswers = questions.filter(q => !q.correct).map(q => q.qn);
        if (missingAnswers.length) {
          throw new Error(
            `Missing answer key for question${missingAnswers.length === 1 ? "" : "s"}: ${missingAnswers.slice(0, 8).join(", ")}${missingAnswers.length > 8 ? "…" : ""}`
          );
        }
        await importTextTest(test.id, passages, questions);
      } else {
        for (const { qn, ans } of keyEntries) {
          const id = `${test.id}-q${qn}`;
          await upsertQuestion({
            id, test_id: test.id, question_number: qn,
            correct_answer: ans, image_url: imageMap[qn] || null,
            is_active: true,
          }, staff?.email);
        }
      }

      await recordTestImport({
        course_id: meta.course_ids?.[0] || null,
        test_id: test.id,
        booklet_filename: bookletFile?.name,
        answer_key_filename: keyFile?.name,
        detected_questions: qCountForCreate,
        uploaded_images: meta.format === "text" ? 0 : Object.keys(imageMap).length,
        status: "completed",
      }, staff?.email);

      toast.success("Test imported! Review and publish from Tests.");
      setStep(1);
      setMeta({ name:"", course_ids:[], boc_opens_at:"", boc_closes_at:"", eoc_opens_at:"", eoc_closes_at:"", scope:"district", format:"image" });
      setBookletFile(null); setKeyFile(null); setKeyEntries([]); setImageMap({});
      setTextParsed(null); setTextWarnings([]);
      setHistory(await listTestImports());
    } catch (e) {
      const msg = e?.message || e?.details || e?.hint || JSON.stringify(e);
      toast.error("Import failed: " + msg);
    }
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
            <div className="md:col-span-2 space-y-2">
              <Label>Test format</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="ti-format">
                <button
                  type="button"
                  onClick={() => setMeta({ ...meta, format: "image" })}
                  data-testid="ti-format-image"
                  className={`text-left rounded-lg border-2 p-4 transition-all flex items-start gap-3 ${meta.format === "image" ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-border hover:border-[hsl(var(--accent))]/50"}`}
                >
                  <ImageIcon className="h-5 w-5 mt-1 shrink-0" />
                  <div>
                    <div className="font-medium">Image-based</div>
                    <div className="text-xs text-muted-foreground mt-1">Math, science, anything with figures. Question images extracted from the .docx booklet.</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMeta({ ...meta, format: "text" })}
                  data-testid="ti-format-text"
                  className={`text-left rounded-lg border-2 p-4 transition-all flex items-start gap-3 ${meta.format === "text" ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-border hover:border-[hsl(var(--accent))]/50"}`}
                >
                  <FileText className="h-5 w-5 mt-1 shrink-0" />
                  <div>
                    <div className="font-medium">Text-based</div>
                    <div className="text-xs text-muted-foreground mt-1">English / reading. Passages, stems, and A/B/C/D choices parsed straight out of the booklet — no images needed.</div>
                  </div>
                </button>
              </div>
            </div>
            <div className="md:col-span-2 space-y-2"><Label>Test name</Label><Input value={meta.name} onChange={e=>setMeta({...meta, name:e.target.value})} placeholder="Algebra 1A Growth Test" data-testid="ti-name" /></div>
            <div className="md:col-span-2 space-y-2">
              <Label>Courses</Label>
              <CourseMultiSelect
                courses={courses}
                value={meta.course_ids}
                onChange={(ids) => setMeta({ ...meta, course_ids: ids })}
                testid="ti-courses"
              />
              <p className="text-xs text-muted-foreground">Select one or more courses. The test will apply to every section of every selected course.</p>
            </div>
            <div className="md:col-span-2 rounded-md border border-border p-3 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">BOC window — beginning of course</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Opens</Label><Input type="date" value={meta.boc_opens_at} onChange={e=>setMeta({...meta, boc_opens_at:e.target.value})} data-testid="ti-boc-opens" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Closes</Label><Input type="date" value={meta.boc_closes_at} onChange={e=>setMeta({...meta, boc_closes_at:e.target.value})} data-testid="ti-boc-closes" /></div>
              </div>
            </div>
            <div className="md:col-span-2 rounded-md border border-border p-3 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">EOC window — end of course</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label className="text-xs">Opens</Label><Input type="date" value={meta.eoc_opens_at} onChange={e=>setMeta({...meta, eoc_opens_at:e.target.value})} data-testid="ti-eoc-opens" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Closes</Label><Input type="date" value={meta.eoc_closes_at} onChange={e=>setMeta({...meta, eoc_closes_at:e.target.value})} data-testid="ti-eoc-closes" /></div>
              </div>
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button onClick={()=>setStep(2)} disabled={!meta.name || meta.course_ids.length === 0} data-testid="ti-next-1">Continue <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardContent className="p-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  {meta.format === "text"
                    ? "Test booklet (.docx — passages + questions parsed automatically)"
                    : "Quiz / test booklet (.docx auto-extracts embedded images)"}
                </Label>
                <Input type="file" accept=".docx,.pdf" onChange={onBookletFile} data-testid="ti-booklet" />
                {bookletFile && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{bookletFile.name}</Badge>
                    {meta.format === "text" && textParsed && (
                      <Badge className="bg-[hsl(var(--success))] text-white" data-testid="ti-text-parsed-badge">
                        {textParsed.questions.length} Qs, {textParsed.passages.length} passages
                      </Badge>
                    )}
                    {meta.format === "image" && Object.keys(imageMap).length > 0 && (
                      <Badge className="bg-[hsl(var(--success))] text-white">
                        {Object.keys(imageMap).length} images extracted
                      </Badge>
                    )}
                  </div>
                )}
                {meta.format === "text" && textWarnings.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-1" data-testid="ti-text-warnings">
                    {textWarnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-amber-900">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Answer key (.csv, .txt, .docx)</Label>
                <Input type="file" onChange={onKeyFile} data-testid="ti-keyfile" />
                {keyFile && <Badge variant="outline">{keyFile.name}</Badge>}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={()=>setStep(1)}>Back</Button>
              <Button onClick={()=>setStep(3)} disabled={keyEntries.length === 0 || (meta.format === "text" && !textParsed)} data-testid="ti-next-2">Continue <ChevronRight className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardContent className="p-6 space-y-6">
            {meta.format === "image" && (
              <>
                <div className="space-y-2">
                  <Label>Question images <span className="text-muted-foreground font-normal">(optional — already extracted from .docx booklet)</span></Label>
                  <Input type="file" multiple accept="image/*,.zip" onChange={e => handleQuestionImages(e.target.files)} data-testid="ti-images" />
                  <p className="text-xs text-muted-foreground">Use this to add or replace individual images. Filenames like q01.png, q02.png map to question numbers; a ZIP with similarly named files works too.</p>
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
              </>
            )}

            {meta.format === "text" && textParsed && (
              <>
                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <Card className="border-dashed"><CardContent className="p-4 flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />
                    <div><div className="font-medium">{textParsed.questions.length} questions parsed</div><div className="text-xs text-muted-foreground">from the booklet</div></div>
                  </CardContent></Card>
                  <Card className="border-dashed"><CardContent className="p-4 flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" />
                    <div><div className="font-medium">{textParsed.passages.length} passages</div><div className="text-xs text-muted-foreground">{(() => {
                      const shared = {};
                      textParsed.questions.forEach(q => { if (q.passage_ordinal) shared[q.passage_ordinal] = (shared[q.passage_ordinal]||0) + 1; });
                      const sharedCount = Object.values(shared).filter(c => c > 1).length;
                      return sharedCount > 0 ? `${sharedCount} shared by 2+ questions` : "all single-question";
                    })()}</div></div>
                  </CardContent></Card>
                  <Card className="border-dashed"><CardContent className="p-4 flex items-center gap-3">
                    {keyEntries.length >= textParsed.questions.length ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" /> : <AlertTriangle className="h-5 w-5 text-[hsl(var(--warning))]" />}
                    <div><div className="font-medium">{keyEntries.length} answers</div><div className="text-xs text-muted-foreground">{keyEntries.length >= textParsed.questions.length ? "fully keyed" : `missing ${textParsed.questions.length - keyEntries.length}`}</div></div>
                  </CardContent></Card>
                </div>

                <div className="border border-border rounded-md max-h-[55vh] overflow-auto" data-testid="ti-text-preview">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Q#</TableHead>
                        <TableHead>Passage</TableHead>
                        <TableHead>Question stem &amp; choices</TableHead>
                        <TableHead className="text-right w-16">Answer</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {textParsed.questions.map(q => {
                        const p = q.passage_ordinal ? textParsed.passages.find(x => x.ordinal === q.passage_ordinal) : null;
                        const ans = keyEntries.find(e => e.qn === q.qn)?.ans;
                        return (
                          <TableRow key={q.qn} data-testid={`ti-text-row-${q.qn}`}>
                            <TableCell className="font-mono align-top">{q.qn}</TableCell>
                            <TableCell className="align-top max-w-[200px]">
                              {p ? (
                                <div>
                                  {p.title && <div className="text-xs font-semibold truncate">{p.title}</div>}
                                  <div className="text-xs text-muted-foreground line-clamp-2">{p.body}</div>
                                  <Badge variant="outline" className="mt-1 text-[10px]">passage #{p.ordinal}</Badge>
                                </div>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="align-top max-w-md">
                              <div className="text-xs font-medium line-clamp-2">{q.stem}</div>
                              <div className="text-[11px] text-muted-foreground mt-1 grid grid-cols-1 gap-0.5">
                                <div><span className="font-mono mr-1">A.</span>{q.choices.A}</div>
                                <div><span className="font-mono mr-1">B.</span>{q.choices.B}</div>
                                <div><span className="font-mono mr-1">C.</span>{q.choices.C}</div>
                                <div><span className="font-mono mr-1">D.</span>{q.choices.D}</div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono align-top">
                              {ans ? (
                                <Badge className="bg-[hsl(var(--success))] text-white">{ans}</Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-700 border-amber-400">missing</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

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
