import React, { useEffect, useState } from "react";
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
import { Plus, Eye, FileText, Pencil } from "lucide-react";
import { Link } from "react-router-dom";
import { listCourses, listTests, createTest, updateTest } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Tests() {
  const { staff } = useAuth();
  const [tests, setTests] = useState([]);
  const [courses, setCourses] = useState([]);
  const [open, setOpen] = useState(false);

  async function refresh() {
    setTests(await listTests());
    setCourses(await listCourses());
  }
  useEffect(() => { refresh(); }, []);

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

  return (
    <AppShell>
      <PageHeader
        title="Tests"
        subtitle="Manage Beginning-of-Course and End-of-Course assessments."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="new-test-btn"><Plus className="h-4 w-4" /> New test</Button>
            </DialogTrigger>
            <NewTestDialog courses={courses} onSubmit={onCreate} />
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
                <TableHead>Type</TableHead>
                <TableHead className="text-center">Questions</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map(t => {
                const course = courses.find(c => c.id === t.course_id);
                return (
                  <TableRow key={t.id} data-testid={`test-row-${t.id}`}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{course?.title || "—"}</TableCell>
                    <TableCell><Badge variant={t.test_type === "BOC" ? "secondary" : "default"}>{t.test_type}</Badge></TableCell>
                    <TableCell className="text-center font-mono">{t.question_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.opens_at} → {t.closes_at}</TableCell>
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
                    </TableCell>
                  </TableRow>
                );
              })}
              {tests.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">No tests yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function NewTestDialog({ courses, onSubmit }) {
  const [name, setName] = useState("");
  const [course_id, setCourse] = useState("");
  const [test_type, setType] = useState("BOC");
  const [school_year_id] = useState("sy-2627");
  const [opens_at, setOpens] = useState("");
  const [closes_at, setCloses] = useState("");
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="font-display">New test</DialogTitle>
        <DialogDescription>Create a Beginning-of-Course or End-of-Course assessment.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={e=>setName(e.target.value)} placeholder="Algebra 1A BOC" data-testid="new-test-name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Course</Label>
            <Select value={course_id} onValueChange={setCourse}>
              <SelectTrigger data-testid="new-test-course"><SelectValue placeholder="Choose course" /></SelectTrigger>
              <SelectContent>{courses.map(c => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={test_type} onValueChange={setType}>
              <SelectTrigger data-testid="new-test-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BOC">BOC — Beginning of Course</SelectItem>
                <SelectItem value="EOC">EOC — End of Course</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Opens</Label><Input type="date" value={opens_at} onChange={e=>setOpens(e.target.value)} /></div>
          <div className="space-y-2"><Label>Closes</Label><Input type="date" value={closes_at} onChange={e=>setCloses(e.target.value)} /></div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={()=>onSubmit({ name, course_id, test_type, school_year_id, opens_at, closes_at, question_count: 0 })} disabled={!name || !course_id} data-testid="new-test-submit">Create test</Button>
      </DialogFooter>
    </DialogContent>
  );
}
