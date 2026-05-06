import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSectionDetail, getSectionRoster } from "@/lib/api";
import { ArrowLeft, Search, Loader2, Users } from "lucide-react";

function fullName(s) {
  return `${s?.first_name ?? ""} ${s?.last_name ?? ""}`.trim() || "—";
}

export default function SectionRoster() {
  const { sectionId } = useParams();
  const [section, setSection] = useState(null);
  const [roster, setRoster] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    setSection(null); setRoster(null); setError(null);
    Promise.all([getSectionDetail(sectionId), getSectionRoster(sectionId)])
      .then(([s, r]) => { if (alive) { setSection(s); setRoster(r); } })
      .catch(e => { if (alive) { setError(e.message || String(e)); setRoster([]); } });
    return () => { alive = false; };
  }, [sectionId]);

  const filtered = useMemo(() => {
    if (!roster) return [];
    const term = q.trim().toLowerCase();
    if (!term) return roster;
    return roster.filter(r =>
      `${r.student.first_name ?? ""} ${r.student.last_name ?? ""}`.toLowerCase().includes(term) ||
      (r.student.student_id || "").toLowerCase().includes(term)
    );
  }, [roster, q]);

  const teacherNames = (section?.teachers || []).map(t => fullName(t)).filter(Boolean).join(", ");

  return (
    <AppShell>
      <div className="mb-4">
        <Button asChild size="sm" variant="ghost" data-testid="roster-back">
          <Link to="/admin/sections"><ArrowLeft className="h-4 w-4 mr-1" /> Back to sections</Link>
        </Button>
      </div>

      <PageHeader
        title={section ? (section.course?.title || "Section") : "Loading…"}
        subtitle={section
          ? `${section.section_code}${section.campus?.name ? ` — ${section.campus.name}` : ""}${teacherNames ? ` — ${teacherNames}` : ""}`
          : null}
      />

      {error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="roster-error">{error}</div>}

      {section === null && !error && (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading section…
        </div>
      )}

      {section && !error && (
        <>
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              <span data-testid="roster-total">{roster ? roster.length : "…"}</span>
              <span className="opacity-70">{roster?.length === 1 ? "student" : "students"}</span>
            </Badge>
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="roster-search"
                placeholder="Search by name or Student ID…"
                value={q}
                onChange={e => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Last name</TableHead>
                    <TableHead>First name</TableHead>
                    <TableHead>Student ID</TableHead>
                    <TableHead className="text-center">Grade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster === null && (
                    <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading roster…
                    </TableCell></TableRow>
                  )}
                  {roster && filtered.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground" data-testid="roster-empty">
                      {roster.length === 0 ? "No students enrolled in this section." : "No students match your search."}
                    </TableCell></TableRow>
                  )}
                  {filtered.map(r => (
                    <TableRow key={r.enrollment_id} data-testid={`roster-row-${r.student.id}`}>
                      <TableCell className="font-medium">{r.student.last_name || "—"}</TableCell>
                      <TableCell>{r.student.first_name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.student.student_id || "—"}</TableCell>
                      <TableCell className="text-center">{r.student.grade_level ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}
