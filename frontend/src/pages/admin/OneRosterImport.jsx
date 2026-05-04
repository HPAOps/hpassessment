import React, { useEffect, useRef, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Upload, FileCheck2, AlertCircle, CheckCircle2 } from "lucide-react";
import { ONEROSTER_FILES, parseOneRosterZip, mapOneRosterToOperational } from "@/lib/oneroster";
import { recordOneRosterImport, applyOneRosterMapping, listOneRosterImports } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function OneRosterImport() {
  const { staff } = useAuth();
  const fileInput = useRef();
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => { listOneRosterImports().then(setHistory); }, []);

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setParsing(true);
    setParsed(null); setMapping(null);
    try {
      const result = await parseOneRosterZip(f);
      setParsed({ filename: f.name, ...result });
      const mapped = mapOneRosterToOperational(result);
      setMapping(mapped);
    } catch (err) {
      toast.error("Couldn't parse ZIP: " + err.message);
    } finally {
      setParsing(false);
    }
  }

  async function commit() {
    if (!mapping) return;
    await applyOneRosterMapping(mapping.records, staff?.email);
    await recordOneRosterImport({
      filename: parsed.filename,
      files_seen: parsed.filesSeen,
      counts: mapping.counts,
      errors: parsed.errors,
      status: parsed.errors.length === 0 ? "completed" : "completed_with_errors",
    }, staff?.email);
    toast.success("Roster imported");
    setParsed(null); setMapping(null);
    setHistory(await listOneRosterImports());
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <AppShell>
      <PageHeader title="OneRoster Import" subtitle="Import roster, enrollments, and class data from Infinite Campus OneRoster ZIP exports." />

      <Card className="mb-6">
        <CardContent className="p-8">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center">
              <Upload className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-display text-xl font-semibold">Upload OneRoster ZIP</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">Expected files: {ONEROSTER_FILES.join(", ")}</p>
            </div>
            <div>
              <input ref={fileInput} type="file" accept=".zip" onChange={onFile} className="hidden" data-testid="oneroster-zip-input" id="onerosterFile" />
              <Button asChild data-testid="oneroster-pick-btn"><label htmlFor="onerosterFile" className="cursor-pointer">{parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{parsing ? "Parsing…" : "Choose ZIP"}</label></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {parsed && mapping && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <FileCheck2 className="h-5 w-5 text-[hsl(var(--success))]" />
              <h3 className="font-display text-lg font-semibold">Review import</h3>
              <Badge variant="outline" className="ml-auto">{parsed.filename}</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {Object.entries(mapping.counts).map(([k, v]) => (
                <div key={k} className="rounded-md border border-border p-3" data-testid={`count-${k}`}>
                  <div className="overline">{k}</div>
                  <div className="font-display text-2xl font-bold">{v}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="overline mb-2">Files detected</div>
                <ul className="space-y-1">
                  {ONEROSTER_FILES.map(f => (
                    <li key={f} className="flex items-center gap-2">
                      {parsed.filesSeen.includes(f)
                        ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                        : <AlertCircle className="h-4 w-4 text-destructive" />}
                      <span className="font-mono text-xs">{f}</span>
                      {parsed.missing.includes(f) && <Badge variant="destructive" className="ml-auto">missing</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="overline mb-2">Issues</div>
                {parsed.errors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No parse errors.</p>
                ) : (
                  <ul className="text-xs space-y-1 max-h-40 overflow-auto">
                    {parsed.errors.slice(0, 30).map((e, i) => (
                      <li key={i} className="font-mono text-destructive">{e.file}: {e.message}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setParsed(null); setMapping(null); }} data-testid="oneroster-cancel">Cancel</Button>
              <Button onClick={commit} data-testid="oneroster-commit">Commit import</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>File</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Counts</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map(h => (
                <TableRow key={h.id} data-testid={`oneroster-history-${h.id}`}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(h.uploaded_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{h.filename}</TableCell>
                  <TableCell className="text-xs">{h.uploaded_by}</TableCell>
                  <TableCell className="text-xs">
                    {Object.entries(h.counts || {}).slice(0, 4).map(([k,v]) => `${k}:${v}`).join(" · ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={h.status === "completed" ? "secondary" : "outline"}>{h.status.replace("_"," ")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {history.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">No imports yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
