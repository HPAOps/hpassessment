import React, { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listCampuses, listStudents, listTeachers, listWhitelist } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function Users() {
  const { staff } = useAuth();
  const [campuses, setCampuses] = useState([]);
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    listCampuses().then(setCampuses);
    const cId = staff?.role === "campus_admin" ? staff.campus_id : null;
    listStudents(cId).then(setStudents);
    listTeachers(cId).then(setTeachers);
    listWhitelist().then(rows => setStaffList(
      cId ? (rows || []).filter(r => !r.campus_id || r.campus_id === cId) : (rows || [])
    )).catch(() => setStaffList([]));
  }, [staff]);

  const ff = (s) => s.toLowerCase().includes(filter.toLowerCase());

  return (
    <AppShell>
      <PageHeader title="Users" subtitle="Browse students, teachers, and staff accounts." />
      <Card className="mb-6"><CardContent className="p-4">
        <Input placeholder="Search by name or ID…" value={filter} onChange={e=>setFilter(e.target.value)} data-testid="users-filter" />
      </CardContent></Card>

      <Tabs defaultValue="students">
        <TabsList>
          <TabsTrigger value="students">Students ({students.length})</TabsTrigger>
          <TabsTrigger value="teachers">Teachers ({teachers.length})</TabsTrigger>
          <TabsTrigger value="staff" data-testid="staff-tab">Staff ({staffList.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="students" className="mt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Student ID</TableHead><TableHead>Grade</TableHead><TableHead>Campus</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {students.filter(s => ff(`${s.first_name} ${s.last_name} ${s.student_id}`)).map(s => (
                  <TableRow key={s.id} data-testid={`student-row-${s.id}`}>
                    <TableCell>{s.first_name} {s.last_name}</TableCell>
                    <TableCell className="font-mono">{s.student_id}</TableCell>
                    <TableCell>{s.grade_level}</TableCell>
                    <TableCell>{campuses.find(c=>c.id===s.campus_id)?.name}</TableCell>
                    <TableCell><Badge variant={s.is_active ? "secondary" : "outline"}>{s.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="teachers" className="mt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Campus</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {teachers.filter(t => ff(`${t.first_name} ${t.last_name} ${t.email}`)).map(t => (
                  <TableRow key={t.id} data-testid={`teacher-row-${t.id}`}>
                    <TableCell>{t.first_name} {t.last_name}</TableCell>
                    <TableCell className="font-mono text-xs">{t.email}</TableCell>
                    <TableCell>{campuses.find(c=>c.id===t.campus_id)?.name}</TableCell>
                    <TableCell><Badge variant={t.is_active ? "secondary" : "outline"}>{t.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="staff" className="mt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Campus</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
              <TableBody>
                {staffList.filter(u => ff(`${u.email} ${u.role}`)).map(u => (
                  <TableRow key={u.id || u.email} data-testid={`staff-row-${u.email}`}>
                    <TableCell className="font-mono text-xs">{u.email}</TableCell>
                    <TableCell><Badge variant="outline">{(u.role || "").replace("_", " ")}</Badge></TableCell>
                    <TableCell>{u.campus_id ? (campuses.find(c => c.id === u.campus_id)?.name || "—") : <span className="text-xs text-muted-foreground italic">all campuses</span>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.tenant_hint === "oneroster_auto" ? "OneRoster sync" : (u.tenant_hint || "manual")}</TableCell>
                  </TableRow>
                ))}
                {staffList.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-12">No staff configured yet. Run a OneRoster sync to import teachers, or add manually on Integrations → Staff Access.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
