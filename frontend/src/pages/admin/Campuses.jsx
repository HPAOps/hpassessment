import React, { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { listCampuses, listStudents, listTeachers } from "@/lib/api";

export default function Campuses() {
  const [campuses, setCampuses] = useState([]);
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);

  useEffect(() => {
    listCampuses().then(setCampuses);
    listStudents().then(setStudents);
    listTeachers().then(setTeachers);
  }, []);

  return (
    <AppShell>
      <PageHeader title="Campuses" subtitle="Operational campus records mapped from OneRoster orgs." />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead>OneRoster ID</TableHead>
              <TableHead className="text-center">Students</TableHead><TableHead className="text-center">Teachers</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {campuses.map(c => (
                <TableRow key={c.id} data-testid={`campus-row-${c.id}`}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell className="font-mono text-xs">{c.oneroster_org_sourced_id}</TableCell>
                  <TableCell className="text-center">{students.filter(s => s.campus_id === c.id).length}</TableCell>
                  <TableCell className="text-center">{teachers.filter(t => t.campus_id === c.id).length}</TableCell>
                  <TableCell><Badge variant={c.is_active ? "secondary" : "outline"}>{c.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
