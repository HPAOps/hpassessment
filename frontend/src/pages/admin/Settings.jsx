import React from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/contexts/SettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { resetDemoData } from "@/lib/api";
import { toast } from "sonner";
import { isDemoMode } from "@/lib/supabase";

export default function Settings() {
  const { settings, update } = useSettings();
  const { staff } = useAuth();
  if (!settings) return <AppShell><div className="text-sm text-muted-foreground">Loading…</div></AppShell>;

  function set(key, value) { update({ [key]: value }, staff?.email); }

  return (
    <AppShell>
      <PageHeader title="Settings" subtitle="District-wide controls for testing behavior, visibility, and overrides." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6 space-y-5">
            <h3 className="font-display text-lg font-semibold">Student experience</h3>
            <Toggle label="Show score after submission" checked={settings.show_score_to_student} onChange={v=>set("show_score_to_student", v)} testId="setting-show-score" />
            <Toggle label="Allow student answer review" checked={settings.allow_student_answer_review} onChange={v=>set("allow_student_answer_review", v)} testId="setting-review" />
            <Toggle label="Require teacher verification before test" checked={settings.require_teacher_verification} onChange={v=>set("require_teacher_verification", v)} testId="setting-verify" />
            <Toggle label="Random question order" checked={settings.random_question_order} onChange={v=>set("random_question_order", v)} testId="setting-random" />
            <Toggle label="Allow test retakes" checked={settings.allow_test_retakes} onChange={v=>set("allow_test_retakes", v)} testId="setting-retakes" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-5">
            <h3 className="font-display text-lg font-semibold">Test windows & timing</h3>
            <Toggle label="Enable timer" checked={settings.enable_timer} onChange={v=>set("enable_timer", v)} testId="setting-timer" />
            <div className="space-y-2">
              <Label>Default test minutes</Label>
              <Input type="number" defaultValue={settings.default_test_minutes} onBlur={e => set("default_test_minutes", Number(e.target.value))} className="max-w-xs" data-testid="setting-default-minutes" />
            </div>
            <Toggle label="Campus-specific windows" checked={settings.campus_specific_windows} onChange={v=>set("campus_specific_windows", v)} testId="setting-campus-windows" />
            <div className="space-y-2">
              <Label>Test locked message (shown to students when no test is open)</Label>
              <Textarea defaultValue={settings.test_locked_message} onBlur={e => set("test_locked_message", e.target.value)} className="min-h-20" data-testid="setting-locked-msg" />
            </div>
            <Toggle label="Maintenance mode (blocks all student logins)" checked={settings.maintenance_mode} onChange={v=>set("maintenance_mode", v)} testId="setting-maintenance" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-5">
            <h3 className="font-display text-lg font-semibold">Teacher & campus admin permissions</h3>
            <Toggle label="Show question analysis to teachers" checked={settings.show_question_analysis_to_teachers} onChange={v=>set("show_question_analysis_to_teachers", v)} testId="setting-qa-teacher" />
            <Toggle label="Campus admins can reset attempts" checked={settings.campus_admins_can_reset_attempts} onChange={v=>set("campus_admins_can_reset_attempts", v)} testId="setting-camp-reset" />
            <Toggle label="Teachers can view scores" checked={settings.teachers_can_view_scores} onChange={v=>set("teachers_can_view_scores", v)} testId="setting-teacher-scores" />
            <Toggle label="Teachers can export results" checked={settings.teachers_can_export_results} onChange={v=>set("teachers_can_export_results", v)} testId="setting-teacher-export" />
          </CardContent>
        </Card>

        {isDemoMode && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <h3 className="font-display text-lg font-semibold">Demo controls</h3>
              <p className="text-sm text-muted-foreground">Reset all demo data (campuses, students, attempts, growth, etc.) back to seeded defaults.</p>
              <Button variant="destructive" onClick={() => { resetDemoData(); toast.success("Demo data reset"); setTimeout(() => window.location.reload(), 800); }} data-testid="reset-demo-btn">Reset demo data</Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function Toggle({ label, checked, onChange, testId }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="cursor-pointer">{label}</Label>
      <Switch checked={!!checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}
