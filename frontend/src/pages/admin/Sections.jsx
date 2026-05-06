import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSectionsScoped } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, Search, Loader2 } from "lucide-react";

function teacherLabel(teachers) {
  if (!teachers?.length) return <span className="text-muted-foreground italic">—</span>;
  const names = teachers.map(t => `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim()).filter(Boolean);
  return names.join(", ");
}

export default function Sections() {
  const { staff } = useAuth();
  const isSuper = staff?.role === "super_admin";
  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [campusFilter, setCampusFilter] = useState("all");

  useEffect(() => {
    let alive = true;
    listSectionsScoped()
      .then(d => { if (alive) setRows(d); })
      .catch(e => { if (alive) { setError(e.message || String(e)); setRows([]); } });
    return () => { alive = false; };
  }, []);

  // Distinct campuses present in the visible row set, alphabetised.
  const campusOptions = useMemo(() => {
    if (!rows) return [];
    const m = new Map();
    for (const r of rows) {
      if (r.campus?.id && !m.has(r.campus.id)) m.set(r.campus.id, r.campus.name || "—");
    }
    return [...m.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const term = q.trim().toLowerCase();
    return rows.filter(r => {
      if (isSuper && campusFilter !== "all" && r.campus?.id !== campusFilter) return false;
      if (!term) return true;
      return (
        (r.section_code || "").toLowerCase().includes(term) ||
        (r.course?.title || "").toLowerCase().includes(term) ||
        (r.course?.code || "").toLowerCase().includes(term) ||
        (r.campus?.name || "").toLowerCase().includes(term) ||
        (r.teachers || []).some(t => `${t.first_name ?? ""} ${t.last_name ?? ""}`.toLowerCase().includes(term))
      );
    });
  }, [rows, q, campusFilter, isSuper]);

  return (
    <AppShell>
      <PageHeader title="Sections" subtitle="Course sections you can access. Click any section to see its roster." />

      <div className="mb-4 flex items-center gap-2 flex-wrap max-w-3xl">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="sections-search"
            placeholder="Search by course, code, campus, or teacher…"
            value={q}
            onChange={e => setQ(e.target.value)}
            className="pl-9"
          />
        </div>

        {isSuper && campusOptions.length > 1 && (
          <Select value={campusFilter} onValueChange={setCampusFilter}>
            <SelectTrigger className="w-[220px]" data-testid="sections-campus-filter">
              <SelectValue placeholder="Filter by campus" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" data-testid="sections-campus-all">All campuses</SelectItem>
              {campusOptions.map(c => (
                <SelectItem key={c.id} value={c.id} data-testid={`sections-campus-${c.id}`}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="text-sm text-muted-foreground" data-testid="sections-count">
          {rows ? `${filtered.length} of ${rows.length}` : "…"}
        </span>
      </div>

      {error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="sections-error">{error}</div>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Teacher(s)</TableHead>
                <TableHead className="text-center">Students</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="inline h-4 w-4 animate-spin mr-2" /> Loading sections…
                </TableCell></TableRow>
              )}
              {rows && filtered.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground" data-testid="sections-empty">
                  No sections to show.
                </TableCell></TableRow>
              )}
              {filtered.map(r => (
                <TableRow key={r.id} data-testid={`section-row-${r.id}`}>
                  <TableCell className="font-medium">
                    <div>{r.course?.title || <span className="italic text-muted-foreground">Untitled course</span>}</div>
                    {r.course?.code && <div className="text-xs text-muted-foreground font-mono">{r.course.code}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.section_code}</TableCell>
                  <TableCell>{r.campus?.name || <span className="italic text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{teacherLabel(r.teachers)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" data-testid={`section-${r.id}-count`}>{r.enrollment_count}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="ghost" data-testid={`section-${r.id}-open`}>
                      <Link to={`/admin/sections/${r.id}`}>
                        Roster <ArrowRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
