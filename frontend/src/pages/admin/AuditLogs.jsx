import React, { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { listAuditLogs } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("");

  useEffect(() => { listAuditLogs(500).then(setLogs); }, []);

  const filtered = logs.filter(l => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return [l.actor, l.action, l.target, JSON.stringify(l.details || {})].join(" ").toLowerCase().includes(f);
  });

  return (
    <AppShell>
      <PageHeader title="Audit Log" subtitle="Track imports, resets, key changes, and admin actions across the district." />

      <Card className="mb-6">
        <CardContent className="p-4">
          <Input placeholder="Filter by actor, action, target…" value={filter} onChange={e => setFilter(e.target.value)} data-testid="audit-filter" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map(l => (
                <TableRow key={l.id} data-testid={`audit-row-${l.id}`}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs font-mono">{l.actor}</TableCell>
                  <TableCell><Badge variant="outline">{l.action}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{l.target}</TableCell>
                  <TableCell className="text-xs text-muted-foreground"><code>{JSON.stringify(l.details || {})}</code></TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-12">No audit entries match.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
