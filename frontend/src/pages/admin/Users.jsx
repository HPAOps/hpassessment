import React, { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listCampuses, listStudents, listTeachers, listStaff } from "@/lib/api";
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
    listStaff(cId).then(setStaffList).catch(() => setStaffList([]));
  }, [staff]);

  const ff = (s) => s.toLowerCase().includes(filter.toLowerCase());

  return (
    <AppShell>
      <PageHeader title="Users" subtitle="Browse students, teachers, and staff synced from Infinite Campus." />
      <Card className="mb-6"><CardContent className="p-4">
        <Input placeholder="Search by name, email, or ID…" value={filter} onChange={e=>setFilter(e.target.value)} data-testid="users-filter" />
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
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Campus</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {staffList.filter(s => ff(`${s.first_name || ""} ${s.last_name || ""} ${s.email || ""} ${s.oneroster_role || ""}`)).map(s => (
                  <TableRow key={s.id} data-testid={`staff-row-${s.id}`}>
                    <TableCell>{[s.first_name, s.last_name].filter(Boolean).join(" ") || <span className="text-muted-foreground italic">—</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{s.email || <span className="text-muted-foreground italic">no email</span>}</TableCell>
                    <TableCell><Badge variant="outline">{prettyRole(s.oneroster_role)}</Badge></TableCell>
                    <TableCell>{s.campus_id ? (campuses.find(c => c.id === s.campus_id)?.name || "—") : <span className="text-xs text-muted-foreground italic">district</span>}</TableCell>
                    <TableCell><Badge variant={s.is_active ? "secondary" : "outline"}>{s.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
                {staffList.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-12">No staff synced yet. Run a OneRoster sync to import principals, academic coaches, and other staff.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function prettyRole(r) {
  if (!r) return "—";
  // Convert "siteAdministrator" -> "Site Administrator"
  return String(r).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, c => c.toUpperCase());
}
