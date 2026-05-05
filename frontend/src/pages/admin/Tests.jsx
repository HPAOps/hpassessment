import React, { useEffect, useMemo, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { Plus, Eye, Pencil, Trash2, Check, ChevronDown, X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  listCourses, listTests, createTest, updateTest, deleteTest,
  listCourseSections, listTestCourses,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Tests() {
  const { staff } = useAuth();
  const [tests, setTests] = useState([]);
  const [courses, setCourses] = useState([]);
  const [sections, setSections] = useState([]);
  const [testCourses, setTestCourses] = useState([]);
  const [open, setOpen] = useState(false);

  async function refresh() {
    const [t, c, s, tc] = await Promise.all([
      listTests(), listCourses(), listCourseSections(), listTestCourses(),
    ]);
    setTests(t); setCourses(c); setSections(s); setTestCourses(tc);
  }
  useEffect(() => { refresh(); }, []);

  // Map course_id -> sections for quick count
  const sectionsByCourse = useMemo(() => {
    const m = new Map();
    for (const s of sections) {
      if (!m.has(s.course_id)) m.set(s.course_id, []);
      m.get(s.course_id).push(s);
    }
    return m;
  }, [sections]);

  // Map test_id -> array of course IDs (from join table, fallback to legacy course_id)
  const courseIdsByTest = useMemo(() => {
    const m = new Map();
    for (const tc of testCourses) {
      if (!m.has(tc.test_id)) m.set(tc.test_id, []);
      m.get(tc.test_id).push(tc.course_id);
    }
    for (const t of tests) {
      if (!m.has(t.id) && t.course_id) m.set(t.id, [t.course_id]);
    }
    return m;
  }, [testCourses, tests]);

  const courseById = useMemo(
    () => new Map(courses.map(c => [c.id, c])), [courses]
  );

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
        subtitle="Each test is administered twice — once at the start of the course (BOC) and once at the end (EOC). Link a test to one or more courses; it'll apply to every section of every linked course."
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
                <TableHead>Linked courses</TableHead>
                <TableHead>Sections</TableHead>
                <TableHead className="text-center">Q's</TableHead>
                <TableHead>BOC window</TableHead>
                <TableHead>EOC window</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tests.map(t => {
                const linkedIds = courseIdsByTest.get(t.id) || [];
                const linkedCourses = linkedIds.map(id => courseById.get(id)).filter(Boolean);
                const sectionCount = linkedIds.reduce(
                  (sum, cid) => sum + (sectionsByCourse.get(cid)?.length || 0), 0
                );
                return (
                  <TableRow key={t.id} data-testid={`test-row-${t.id}`}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      {linkedCourses.length ? (
                        <div className="flex flex-wrap gap-1" data-testid={`courses-${t.id}`}>
                          {linkedCourses.slice(0, 3).map(c => (
                            <Badge key={c.id} variant="secondary" className="text-xs">
                              {c.title}
                            </Badge>
                          ))}
                          {linkedCourses.length > 3 && (
                            <Badge variant="outline" className="text-xs">+{linkedCourses.length - 3}</Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">no course linked</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" data-testid={`section-count-${t.id}`}>
                        {sectionCount} {sectionCount === 1 ? "section" : "sections"}
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
                    <TableCell className="text-right whitespace-nowrap">
                      <Button asChild variant="ghost" size="sm" data-testid={`preview-${t.id}`}>
                        <Link to={`/admin/tests/${t.id}/preview`}><Eye className="h-3.5 w-3.5" /> Preview</Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm" data-testid={`edit-key-${t.id}`}>
                        <Link to={`/admin/answer-keys?test=${t.id}`}><Pencil className="h-3.5 w-3.5" /> Key</Link>
                      </Button>
                      {isSuper && (
                        <Button variant="ghost" size="sm" onClick={() => onDelete(t)} data-testid={`delete-test-${t.id}`} className="text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]">
                          <Trash2 className="h-3.5 w-3.5" />
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

// Multi-select for courses, deduplicates by title+code so the dropdown shows
// one row per unique course label (handles IC's per-year course duplicates).
// Selecting a label links the test to ALL course IDs sharing that label.
function CourseMultiSelect({ courses, value, onChange }) {
  const [open, setOpen] = useState(false);

  // Group courses by "title|code" so duplicates collapse into one selectable item
  const groups = useMemo(() => {
    const m = new Map();
    for (const c of courses) {
      const key = `${(c.title || "").trim()}|${(c.code || "").trim()}`;
      if (!m.has(key)) m.set(key, { key, title: c.title, code: c.code, ids: [] });
      m.get(key).ids.push(c.id);
    }
    return [...m.values()].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  }, [courses]);

  const valueSet = useMemo(() => new Set(value), [value]);

  // A group is "selected" if all its ids are in value
  const isGroupSelected = (g) => g.ids.every(id => valueSet.has(id));
  const isGroupPartial  = (g) => g.ids.some(id => valueSet.has(id)) && !isGroupSelected(g);

  function toggleGroup(g) {
    if (isGroupSelected(g)) {
      onChange(value.filter(id => !g.ids.includes(id)));
    } else {
      // add any missing ids
      const next = new Set(value);
      g.ids.forEach(id => next.add(id));
      onChange([...next]);
    }
  }

  function removeGroup(g) {
    onChange(value.filter(id => !g.ids.includes(id)));
  }

  const selectedGroups = groups.filter(isGroupSelected);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            data-testid="new-test-courses"
          >
            <span className="text-sm">
              {selectedGroups.length === 0
                ? <span className="text-muted-foreground">Choose one or more courses</span>
                : `${selectedGroups.length} course${selectedGroups.length === 1 ? "" : "s"} selected`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search courses…" />
            <CommandList>
              <CommandEmpty>No courses found.</CommandEmpty>
              <CommandGroup>
                {groups.map(g => {
                  const selected = isGroupSelected(g);
                  const partial = isGroupPartial(g);
                  return (
                    <CommandItem
                      key={g.key}
                      onSelect={() => toggleGroup(g)}
                      className="cursor-pointer"
                      data-testid={`course-option-${g.code || g.title}`}
                    >
                      <div className={cn(
                        "mr-2 h-4 w-4 rounded border flex items-center justify-center",
                        selected ? "bg-primary border-primary text-primary-foreground"
                                 : partial ? "bg-primary/40 border-primary"
                                           : "border-input"
                      )}>
                        {selected && <Check className="h-3 w-3" />}
                      </div>
                      <span className="flex-1">{g.title}</span>
                      {g.code && <span className="text-xs text-muted-foreground ml-2">{g.code}</span>}
                      {g.ids.length > 1 && (
                        <span className="text-xs text-muted-foreground ml-2">({g.ids.length}×)</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedGroups.map(g => (
            <Badge key={g.key} variant="secondary" className="gap-1 pl-2 pr-1">
              {g.title}
              <button
                type="button"
                onClick={() => removeGroup(g)}
                className="ml-1 rounded hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${g.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function NewTestDialog({ courses, sectionsByCourse, onSubmit }) {
  const [name, setName] = useState("");
  const [course_ids, setCourseIds] = useState([]);
  const [school_year_id] = useState("sy-2627");
  const [boc_opens_at, setBocOpens] = useState("");
  const [boc_closes_at, setBocCloses] = useState("");
  const [eoc_opens_at, setEocOpens] = useState("");
  const [eoc_closes_at, setEocCloses] = useState("");

  const totalSections = course_ids.reduce(
    (sum, cid) => sum + (sectionsByCourse?.get(cid)?.length || 0), 0
  );

  return (
    <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="font-display">New test</DialogTitle>
        <DialogDescription>
          One test, administered twice (BOC + EOC). Link the test to one or more courses — every section of every linked course will share the same test.
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
          <Label>Courses</Label>
          <CourseMultiSelect courses={courses} value={course_ids} onChange={setCourseIds} />
          {course_ids.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="section-preview">
              Will apply to <strong>{totalSections}</strong> section{totalSections === 1 ? "" : "s"} across the selected courses.
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
            name, course_ids, school_year_id,
            scope: "district", question_count: 0, is_published: false,
            boc_opens_at: boc_opens_at || null,
            boc_closes_at: boc_closes_at || null,
            eoc_opens_at: eoc_opens_at || null,
            eoc_closes_at: eoc_closes_at || null,
          })}
          disabled={!name || course_ids.length === 0}
          data-testid="new-test-submit"
        >
          Create test
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
