import React, { useEffect, useMemo, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Eye, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { listCourses, listTests, createTest, updateTest, deleteTest, listCourseSections } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Tests() {
  const { staff } = useAuth();
  const [tests, setTests] = useState([]);
  const [courses, setCourses] = useState([]);
  const [sections, setSections] = useState([]);
  const [open, setOpen] = useState(false);

  async function refresh() {
    const [t, c, s] = await Promise.all([listTests(), listCourses(), listCourseSections()]);
    setTests(t); setCourses(c); setSections(s);
  }
  useEffect(() => { refresh(); }, []);

  // Map course_id -> array of sections
  const sectionsByCourse = useMemo(() => {
    const m = new Map();
    for (const s of sections) {
      if (!m.has(s.course_id)) m.set(s.course_id, []);
      m.get(s.course_id).push(s);
    }
    return m;
  }, [sections]);

  async function onCreate(payload) {
    await createTest(payload, staff?.email);
    toast.success("Test created");
    setOpen(false);
    refresh();
  }

  async function togglePublish(t) {
    await updateTest(t.id, { is_published: !t.is_published }, staff?.email);
    toast.success(t.is_published ? "Test unpublished" : "Test published");
    refresh();
  }

  async function onDelete(t) {
    if (!confirm(`Delete test "${t.name}"?\n\nThis will permanently remove the test, its questions, answer keys, and ALL student attempts/scores. This cannot be undone.`)) return;
    try {
      await deleteTest(t.id);
      toast.success(`"${t.name}" deleted`);
      refresh();
    } catch (e) {
      toast.error(e.message || "Delete failed");
    }
  }

  const isSuper = staff?.role === "super_admin";

  return (
    <AppShell>
      <PageHeader
        title="Tests"
        subtitle="Each test is administered twice — once at the start of the course (BOC) and once at the end (EOC)."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="new-test-btn"><Plus className="h-4 w-4" /> New test</Button>
            </DialogTrigger>
            <NewTestDialog courses={courses} sectionsByCourse={sectionsByCourse} onSubmit={onCreate} />
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Sections</TableHead>
                <TableHead className="text-center">Questions</TableHead>
                <TableHead>BOC window</TableHead>
                <TableHead>EOC window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map(t => {
                const course = courses.find(c => c.id === t.course_id);
                const courseSections = sectionsByCourse.get(t.course_id) || [];
                return (
                  <TableRow key={t.id} data-testid={`test-row-${t.id}`}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{course?.title || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`section-count-${t.id}`}>
                        {courseSections.length} {courseSections.length === 1 ? "section" : "sections"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-mono">{t.question_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtWindow(t.boc_opens_at, t.boc_closes_at)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtWindow(t.eoc_opens_at, t.eoc_closes_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch checked={!!t.is_published} onCheckedChange={() => togglePublish(t)} data-testid={`publish-${t.id}`} />
                        <span className="text-xs text-muted-foreground">{t.is_published ? "Published" : "Draft"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm" data-testid={`preview-${t.id}`}>
                        <Link to={`/admin/tests/${t.id}/preview`}><Eye className="h-3.5 w-3.5" /> Preview</Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" data-testid={`edit-key-${t.id}`}>
                        <Link to={`/admin/answer-keys?test=${t.id}`}><Pencil className="h-3.5 w-3.5" /> Key</Link>
                      </Button>
                      {isSuper && (
                        <Button variant="ghost" size="sm" onClick={() => onDelete(t)} data-testid={`delete-test-${t.id}`} className="text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {tests.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">No tests yet. Click "New test" to create one.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function fmtWindow(open, close) {
  if (!open && !close) return <span className="italic">not set</span>;
  return <>{open || "—"} → {close || "—"}</>;
}

function NewTestDialog({ courses, sectionsByCourse, onSubmit }) {
  const [name, setName] = useState("");
  const [course_id, setCourse] = useState("");
  const [school_year_id] = useState("sy-2627");
  const [boc_opens_at, setBocOpens] = useState("");
  const [boc_closes_at, setBocCloses] = useState("");
  const [eoc_opens_at, setEocOpens] = useState("");
  const [eoc_closes_at, setEocCloses] = useState("");

  const previewSections = course_id ? (sectionsByCourse?.get(course_id) || []) : [];
  const sortedCourses = useMemo(() =>
    [...courses].sort((a, b) => (a.title || "").localeCompare(b.title || "")), [courses]);

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="font-display">New test</DialogTitle>
        <DialogDescription>
          One test per course, administered twice. Set both BOC (start of course) and EOC (end of course) windows below.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Test name</Label>
          <Input
            value={name} onChange={e=>setName(e.target.value)}
            placeholder="Algebra 1A Growth Test"
            data-testid="new-test-name"
          />
        </div>
        <div className="space-y-2">
          <Label>Course</Label>
          <Select value={course_id} onValueChange={setCourse}>
            <SelectTrigger data-testid="new-test-course"><SelectValue placeholder="Choose course" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {sortedCourses.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}{c.code ? ` · ${c.code}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {course_id && (
            <p className="text-xs text-muted-foreground" data-testid="section-preview">
              Will apply to <strong>{previewSections.length}</strong> section{previewSections.length === 1 ? "" : "s"}
              {previewSections.length > 0 && previewSections.length <= 5 && (
                <> — {previewSections.map(s => s.section_code).join(", ")}</>
              )}
            </p>
          )}
        </div>

        <div className="rounded-md border border-border p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">BOC window — beginning of course</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Opens</Label><Input type="date" value={boc_opens_at} onChange={e=>setBocOpens(e.target.value)} data-testid="boc-opens" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Closes</Label><Input type="date" value={boc_closes_at} onChange={e=>setBocCloses(e.target.value)} data-testid="boc-closes" /></div>
          </div>
        </div>
        <div className="rounded-md border border-border p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">EOC window — end of course</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Opens</Label><Input type="date" value={eoc_opens_at} onChange={e=>setEocOpens(e.target.value)} data-testid="eoc-opens" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Closes</Label><Input type="date" value={eoc_closes_at} onChange={e=>setEocCloses(e.target.value)} data-testid="eoc-closes" /></div>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={() => onSubmit({
            name, course_id, school_year_id,
            scope: "district", question_count: 0, is_published: false,
            boc_opens_at: boc_opens_at || null,
            boc_closes_at: boc_closes_at || null,
            eoc_opens_at: eoc_opens_at || null,
            eoc_closes_at: eoc_closes_at || null,
          })}
          disabled={!name || !course_id}
          data-testid="new-test-submit"
        >
          Create test
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
