import React, { useEffect, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, Plug, ShieldCheck, Users, KeyRound, RotateCcw, Trash2, Plus, Lock } from "lucide-react";
import {
  listSecrets, setSecret, clearSecret, INTEGRATION_CATALOG,
  listWhitelist, upsertWhitelist, deleteWhitelist,
  listCampuses, listTeachers,
} from "@/lib/api";
import { isDemoMode } from "@/lib/supabase";

export default function Integrations() {
  const { staff } = useAuth();
  const isSuper = staff?.role === "super_admin";

  return (
    <AppShell>
      <PageHeader
        title="Integrations"
        subtitle="Manage third-party API credentials, staff access (SSO whitelist), and sign-on status — all server-side, never exposed to the browser."
      />
      {!isSuper && (
        <Card className="mb-6 border-[hsl(var(--warning))]/40">
          <CardContent className="p-4 flex items-center gap-3">
            <Lock className="h-4 w-4 text-[hsl(var(--warning))]" />
            <div className="text-sm">Read-only — only <strong>super_admin</strong> can change these values.</div>
          </CardContent>
        </Card>
      )}
      <Tabs defaultValue="integrations">
        <TabsList>
          <TabsTrigger value="integrations" data-testid="tab-integrations"><Plug className="h-4 w-4 mr-1" /> Integrations</TabsTrigger>
          <TabsTrigger value="whitelist" data-testid="tab-whitelist"><Users className="h-4 w-4 mr-1" /> Staff Access</TabsTrigger>
          <TabsTrigger value="sso" data-testid="tab-sso"><ShieldCheck className="h-4 w-4 mr-1" /> SSO</TabsTrigger>
        </TabsList>

        <TabsContent value="integrations" className="mt-4">
          <IntegrationList isSuper={isSuper} />
        </TabsContent>

        <TabsContent value="whitelist" className="mt-4">
          <WhitelistManager isSuper={isSuper} />
        </TabsContent>

        <TabsContent value="sso" className="mt-4">
          <SsoStatus />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

/* ---------------- INTEGRATIONS ---------------- */

function IntegrationList({ isSuper }) {
  const [secrets, setSecrets] = useState(null);

  async function refresh() { setSecrets(await listSecrets()); }
  useEffect(() => { refresh(); }, []);

  function statusFor(category) {
    const fields = INTEGRATION_CATALOG.find(c => c.category === category)?.fields || [];
    const rows = (secrets || []).filter(s => s.category === category);
    const configured = fields.every(f => rows.find(r => r.name === f.key)?.configured);
    const anyConfigured = fields.some(f => rows.find(r => r.name === f.key)?.configured);
    const lastUpdated = rows.reduce((max, r) => r.updated_at && r.updated_at > (max || "") ? r.updated_at : max, null);
    const lastBy = rows.find(r => r.updated_at === lastUpdated)?.updated_by_email;
    return { configured, anyConfigured, lastUpdated, lastBy };
  }

  if (secrets === null) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {INTEGRATION_CATALOG.map(it => {
        const status = statusFor(it.category);
        return (
          <Card key={it.category} data-testid={`integration-${it.category}`}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="overline">{it.category.replace(/_/g, " ")}</div>
                  <h3 className="font-display text-lg font-semibold mt-1">{it.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{it.description}</p>
                </div>
                <StatusBadge status={status} />
              </div>

              {status.lastUpdated && (
                <div className="mt-4 text-xs text-muted-foreground">
                  Last rotated <strong>{new Date(status.lastUpdated).toLocaleString()}</strong>
                  {status.lastBy ? <> by <span className="font-mono">{status.lastBy}</span></> : null}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <ConfigureIntegrationDialog integration={it} secrets={secrets} onDone={refresh} disabled={!isSuper}>
                  <Button size="sm" disabled={!isSuper} data-testid={`configure-${it.category}`}>
                    <KeyRound className="h-4 w-4" /> {status.anyConfigured ? "Rotate" : "Configure"}
                  </Button>
                </ConfigureIntegrationDialog>
                {status.anyConfigured && (
                  <Button size="sm" variant="outline" disabled={!isSuper}
                    onClick={async () => {
                      if (!confirm(`Clear all values for ${it.name}?`)) return;
                      for (const f of it.fields) { await clearSecret(f.key); }
                      toast.success(`${it.name} cleared`);
                      refresh();
                    }}
                    data-testid={`clear-${it.category}`}>
                    <RotateCcw className="h-4 w-4" /> Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }) {
  if (status.configured) return <Badge className="bg-[hsl(var(--success))] text-white"><CheckCircle2 className="h-3 w-3 mr-1" />Configured</Badge>;
  if (status.anyConfigured) return <Badge variant="outline" className="border-[hsl(var(--warning))] text-[hsl(var(--warning))]"><AlertCircle className="h-3 w-3 mr-1" />Partial</Badge>;
  return <Badge variant="outline">Not configured</Badge>;
}

function ConfigureIntegrationDialog({ integration, secrets, onDone, disabled, children }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const initial = {};
      integration.fields.forEach(f => { initial[f.key] = ""; });
      setValues(initial);
    }
  }, [open, integration]);

  async function save() {
    setSaving(true);
    try {
      for (const f of integration.fields) {
        const v = values[f.key] || "";
        if (!v) continue; // only write non-empty values — preserves existing if user leaves blank
        await setSecret(f.key, v, integration.category, f.label);
      }
      toast.success(`${integration.name} updated`);
      setOpen(false);
      onDone?.();
    } catch (e) {
      toast.error(e.message || "Failed to save");
    } finally { setSaving(false); }
  }

  if (disabled) return children;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">{integration.name}</DialogTitle>
          <DialogDescription>
            Leave a field blank to keep its current value. Values are never returned to the browser once saved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {integration.fields.map(f => {
            const row = (secrets || []).find(s => s.name === f.key);
            return (
              <div key={f.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">{f.label}</Label>
                  {row?.configured && <Badge variant="outline" className="text-[10px]">Currently set</Badge>}
                </div>
                <Input
                  type={f.secret ? "password" : "text"}
                  placeholder={f.placeholder || (row?.configured ? "••••••••" : "")}
                  value={values[f.key] || ""}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  data-testid={`secret-input-${f.key}`}
                />
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} data-testid="save-secrets">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- WHITELIST ---------------- */

function WhitelistManager({ isSuper }) {
  const [rows, setRows] = useState(null);
  const [campuses, setCampuses] = useState([]);
  const [teachers, setTeachers] = useState([]);

  async function refresh() {
    setRows(await listWhitelist());
    setCampuses(await listCampuses());
    setTeachers(await listTeachers());
  }
  useEffect(() => { refresh(); }, []);

  if (rows === null) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <>
      <Card className="mb-4">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="text-sm">
            <strong>{rows.length}</strong> email{rows.length === 1 ? "" : "s"} authorized to sign in via Microsoft SSO.
          </div>
          <WhitelistDialog mode="add" campuses={campuses} teachers={teachers} onDone={refresh} disabled={!isSuper}>
            <Button size="sm" disabled={!isSuper} data-testid="add-whitelist"><Plus className="h-4 w-4" /> Add staff</Button>
          </WhitelistDialog>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Campus</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} data-testid={`wl-row-${r.email}`}>
                  <TableCell className="font-mono text-xs">{r.email}</TableCell>
                  <TableCell><Badge variant="outline">{r.role.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-xs">{campuses.find(c => c.id === r.campus_id)?.name || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.tenant_hint || "—"}</TableCell>
                  <TableCell className="text-right">
                    <WhitelistDialog mode="edit" entry={r} campuses={campuses} teachers={teachers} onDone={refresh} disabled={!isSuper}>
                      <Button size="sm" variant="ghost" disabled={!isSuper}>Edit</Button>
                    </WhitelistDialog>
                    <Button size="sm" variant="ghost" disabled={!isSuper}
                      onClick={async () => {
                        if (!confirm(`Remove ${r.email}? They'll lose access on next sign-in.`)) return;
                        await deleteWhitelist(r.email);
                        toast.success(`${r.email} removed`);
                        refresh();
                      }}
                      data-testid={`wl-del-${r.email}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">Whitelist is empty.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function WhitelistDialog({ mode, entry, campuses, teachers, onDone, disabled, children }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(entry?.email || "");
  const [role, setRole] = useState(entry?.role || "teacher");
  const [campusId, setCampusId] = useState(entry?.campus_id || "none");
  const [teacherId, setTeacherId] = useState(entry?.teacher_id || "none");
  const [tenantHint, setTenantHint] = useState(entry?.tenant_hint || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && entry) {
      setEmail(entry.email); setRole(entry.role);
      setCampusId(entry.campus_id || "none"); setTeacherId(entry.teacher_id || "none");
      setTenantHint(entry.tenant_hint || "");
    }
  }, [open, entry]);

  async function save() {
    if (!email.trim()) { toast.error("Email required"); return; }
    setSaving(true);
    try {
      await upsertWhitelist({
        email: email.trim(),
        role,
        campus_id: campusId === "none" ? null : campusId,
        teacher_id: teacherId === "none" ? null : teacherId,
        tenant_hint: tenantHint || null,
      });
      toast.success(mode === "add" ? "Staff added" : "Updated");
      setOpen(false);
      onDone?.();
    } catch (e) { toast.error(e.message || "Save failed"); }
    finally { setSaving(false); }
  }

  if (disabled) return children;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">{mode === "add" ? "Add staff access" : "Edit staff access"}</DialogTitle>
          <DialogDescription>
            Authorized emails can sign in via Microsoft SSO from either tenant. Changes log to the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="jdoe@madisonhighlandprep.org" disabled={mode === "edit"} data-testid="wl-email" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger data-testid="wl-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="super_admin">Super admin</SelectItem>
                  <SelectItem value="district_admin">District admin</SelectItem>
                  <SelectItem value="campus_admin">Campus admin</SelectItem>
                  <SelectItem value="teacher">Teacher</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Campus (optional)</Label>
              <Select value={campusId} onValueChange={setCampusId}>
                <SelectTrigger data-testid="wl-campus"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {campuses.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {role === "teacher" && (
            <div className="space-y-1.5">
              <Label>Teacher record (optional)</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger data-testid="wl-teacher"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {teachers.map(t => <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name} · {t.email}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Link the SSO email to the OneRoster teacher record so RLS scopes their data.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Tenant hint</Label>
            <Input value={tenantHint} onChange={e => setTenantHint(e.target.value)} placeholder="Highland Prep AZ / Madison HP" data-testid="wl-tenant" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} data-testid="wl-save">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- SSO STATUS ---------------- */

function SsoStatus() {
  const [count, setCount] = useState(null);
  useEffect(() => { listWhitelist().then(r => setCount(r.length)); }, []);
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-[hsl(var(--primary))] flex items-center justify-center">
            <svg viewBox="0 0 23 23" className="h-5 w-5" aria-hidden>
              <path fill="#f35325" d="M1 1h10v10H1z"/>
              <path fill="#81bc06" d="M12 1h10v10H12z"/>
              <path fill="#05a6f0" d="M1 12h10v10H1z"/>
              <path fill="#ffba08" d="M12 12h10v10H12z"/>
            </svg>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">Microsoft (Entra ID)</div>
            <div className="text-sm text-muted-foreground">Multi-tenant — accepts both Highland Prep AZ and Madison Highland Prep staff.</div>
          </div>
          <Badge className="ml-auto bg-[hsl(var(--success))] text-white"><CheckCircle2 className="h-3 w-3 mr-1" />Enabled</Badge>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-md border border-border p-3">
            <div className="overline">Authorized staff</div>
            <div className="font-display text-2xl font-bold mt-1">{count ?? "—"}</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="overline">Provider</div>
            <div className="mt-1 text-sm">Azure / organizations</div>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          To manage the OAuth app registration (tenants, redirect URIs, consent), use the Azure portal for the Highland Prep AZ tenant.
          Break-glass email/password accounts remain active in case Microsoft is unavailable.
        </div>
      </CardContent>
    </Card>
  );
}
