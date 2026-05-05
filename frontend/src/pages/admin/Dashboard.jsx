import React, { useEffect, useMemo, useState } from "react";
import AppShell, { PageHeader } from "@/components/Layout/AppShell";
import { StatCard } from "@/components/common/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { listAttempts, listCampuses, listCourses, listGrowthResults, listStudents, listTeachers, listTests, listSyncRunsLatest } from "@/lib/api";
import { BarChart3, Users, Building2, GraduationCap, TrendingUp, ClipboardList, CheckCircle2, AlertCircle, XCircle, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell } from "recharts";

export default function AdminDashboard() {
  const { staff } = useAuth();
  const [data, setData] = useState(null);
  const [rosterSync, setRosterSync] = useState(null);

  useEffect(() => {
    (async () => {
      const [campuses, courses, students, teachers, tests, attempts, growth] = await Promise.all([
        listCampuses(), listCourses(), listStudents(), listTeachers(), listTests(), listAttempts(), listGrowthResults(),
      ]);
      setData({ campuses, courses, students, teachers, tests, attempts, growth });
    })();
  }, []);

  useEffect(() => {
    const role = staff?.role;
    if (role !== "super_admin" && role !== "district_admin") return;
    listSyncRunsLatest()
      .then(runs => setRosterSync(runs.find(r => r.category === "oneroster_sftp") || null))
      .catch(() => setRosterSync(null));
  }, [staff]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const role = staff?.role;
    let students = data.students;
    let teachers = data.teachers;
    let campuses = data.campuses;
    if (role === "campus_admin") {
      students = students.filter(s => s.campus_id === staff.campus_id);
      teachers = teachers.filter(t => t.campus_id === staff.campus_id);
      campuses = campuses.filter(c => c.id === staff.campus_id);
    } else if (role === "teacher") {
      // Teacher: RLS already filters listStudents/listAttempts down to their
      // accessible rows in live mode. We just narrow campuses + teachers.
      teachers = teachers.filter(t => t.id === staff.teacher_id);
      if (staff.campus_id) campuses = campuses.filter(c => c.id === staff.campus_id);
    }
    const studentIds = new Set(students.map(s => s.id));
    const attempts = data.attempts.filter(a => studentIds.has(a.student_id));
    const submitted = attempts.filter(a => a.status === "submitted");
    const growth = data.growth.filter(g => studentIds.has(g.student_id));
    return { ...data, campuses, students, teachers, attempts: submitted, growth };
  }, [data, staff]);

  if (!filtered) return <AppShell><div className="text-muted-foreground text-sm">Loading…</div></AppShell>;

  const submittedAttempts = filtered.attempts;
  const totalStudents = filtered.students.length;
  const studentsTested = new Set(submittedAttempts.map(a => a.student_id)).size;
  const completionRate = totalStudents ? Math.round((studentsTested / totalStudents) * 100) : 0;
  const avgBoc = avg(submittedAttempts.filter(a => filtered.tests.find(t => t.id === a.test_id)?.test_type === "BOC").map(a => a.score_percent));
  const avgEoc = avg(submittedAttempts.filter(a => filtered.tests.find(t => t.id === a.test_id)?.test_type === "EOC").map(a => a.score_percent));
  const avgGrowth = avg(filtered.growth.map(g => g.growth_percentage));

  // Campus comparison data
  const campusData = filtered.campuses.map(c => {
    const sids = new Set(filtered.students.filter(s => s.campus_id === c.id).map(s => s.id));
    const cAttempts = submittedAttempts.filter(a => sids.has(a.student_id));
    const cBoc = avg(cAttempts.filter(a => filtered.tests.find(t => t.id === a.test_id)?.test_type === "BOC").map(a => a.score_percent));
    const cEoc = avg(cAttempts.filter(a => filtered.tests.find(t => t.id === a.test_id)?.test_type === "EOC").map(a => a.score_percent));
    const cGrowth = avg(filtered.growth.filter(g => sids.has(g.student_id)).map(g => g.growth_percentage));
    return { name: c.name.replace("Highland Prep", "HP"), BOC: cBoc, EOC: cEoc, Growth: cGrowth };
  });

  // Course comparison
  const courseData = filtered.courses.slice(0, 8).map(c => {
    const cTests = filtered.tests.filter(t => t.course_id === c.id);
    const cAttempts = submittedAttempts.filter(a => cTests.find(t => t.id === a.test_id));
    return {
      name: c.title,
      BOC: avg(cAttempts.filter(a => cTests.find(t => t.id === a.test_id)?.test_type === "BOC").map(a => a.score_percent)),
      EOC: avg(cAttempts.filter(a => cTests.find(t => t.id === a.test_id)?.test_type === "EOC").map(a => a.score_percent)),
    };
  });

  // Growth distribution
  const buckets = [0, 20, 40, 60, 80, 100];
  const dist = buckets.map((b, i) => ({
    range: i === buckets.length - 1 ? `${b}+%` : `${b}-${buckets[i+1]}%`,
    students: filtered.growth.filter(g => g.growth_percentage != null && g.growth_percentage >= b && (i === buckets.length-1 || g.growth_percentage < buckets[i+1])).length,
  }));

  return (
    <AppShell>
      <PageHeader
        title={titleForRole(staff)}
        subtitle="Real-time view of completion, scores, and growth across the district."
      />

      <RosterSyncBanner run={rosterSync} role={staff?.role} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard testId="kpi-students-tested" label="Students Tested" value={studentsTested} sub={`${completionRate}% completion`} icon={Users} />
        <StatCard testId="kpi-avg-boc" label="Avg BOC" value={`${avgBoc}%`} sub="Beginning of course" icon={ClipboardList} />
        <StatCard testId="kpi-avg-eoc" label="Avg EOC" value={`${avgEoc}%`} sub="End of course" icon={GraduationCap} />
        <StatCard testId="kpi-avg-growth" label="Avg Growth" value={avgGrowth != null ? `${avgGrowth}%` : "—"} sub="Available growth captured" icon={TrendingUp} accent />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-display tracking-tight">Campus comparison</CardTitle>
          </CardHeader>
          <CardContent className="h-72 w-full min-h-[18rem]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={campusData}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="BOC" fill="hsl(var(--chart-1))" radius={[6,6,0,0]} />
                <Bar dataKey="EOC" fill="hsl(var(--chart-2))" radius={[6,6,0,0]} />
                <Bar dataKey="Growth" fill="hsl(var(--chart-3))" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display tracking-tight">Course performance (BOC vs EOC)</CardTitle>
          </CardHeader>
          <CardContent className="h-72 w-full min-h-[18rem]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={courseData}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="BOC" stroke="hsl(var(--chart-1))" strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="EOC" stroke="hsl(var(--chart-2))" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display tracking-tight">Growth distribution</CardTitle>
          </CardHeader>
          <CardContent className="h-64 w-full min-h-[16rem]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="range" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="students" fill="hsl(var(--chart-2))" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display tracking-tight">Roster snapshot</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Stat label="Active campuses"  value={filtered.campuses.length} icon={Building2} />
              <Stat label="Active students"  value={filtered.students.length} icon={Users} />
              <Stat label="Active teachers"  value={filtered.teachers.length} icon={GraduationCap} />
              <Stat label="Published tests"  value={filtered.tests.filter(t => t.is_published).length} icon={ClipboardList} />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">{label}</span>
      </div>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  );
}

function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  const cleaned = arr.filter(x => x != null);
  if (!cleaned.length) return 0;
  return Math.round(cleaned.reduce((a,b)=>a+b,0) / cleaned.length);
}

function titleForRole(staff) {
  if (!staff) return "Dashboard";
  switch (staff.role) {
    case "super_admin": return "District Overview";
    case "district_admin": return "District Overview";
    case "campus_admin": return "Campus Overview";
    case "teacher": return "Teacher Overview";
    default: return "Dashboard";
  }
}


function RosterSyncBanner({ run, role }) {
  if (role !== "super_admin" && role !== "district_admin") return null;

  if (!run) {
    return (
      <div
        className="mb-6 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 flex items-center justify-between gap-4"
        data-testid="roster-sync-banner-empty"
      >
        <div className="flex items-center gap-3">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Roster sync — no runs yet</div>
            <div className="text-xs text-muted-foreground">Import a OneRoster ZIP or configure the SFTP integration to begin nightly roster sync.</div>
          </div>
        </div>
        <Link
          to="/admin/integrations"
          className="text-xs font-medium text-[hsl(var(--accent))] hover:underline whitespace-nowrap"
          data-testid="roster-sync-banner-cta"
        >
          Configure integrations →
        </Link>
      </div>
    );
  }

  const ok = run.status === "success";
  const failed = run.status === "failed";
  const Icon = ok ? CheckCircle2 : failed ? XCircle : AlertCircle;
  const colorClass = ok
    ? "text-[hsl(var(--success))]"
    : failed
      ? "text-[hsl(var(--destructive))]"
      : "text-[hsl(var(--warning))]";
  const borderClass = ok
    ? "border-[hsl(var(--success))]/30"
    : failed
      ? "border-[hsl(var(--destructive))]/40"
      : "border-[hsl(var(--warning))]/40";
  const counts = run.row_counts || {};
  const countSummary = Object.entries(counts).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(" · ");
  const when = new Date(run.completed_at || run.started_at);
  const ago = relTime(when);

  return (
    <div
      className={`mb-6 rounded-lg border ${borderClass} bg-card px-4 py-3 flex items-center justify-between gap-4`}
      data-testid="roster-sync-banner"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Icon className={`h-5 w-5 shrink-0 ${colorClass}`} />
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-2">
            Roster sync {ok ? "up to date" : failed ? "failed" : "completed with warnings"}
            <span className="text-xs font-normal text-muted-foreground">· {run.source.replace(/_/g, " ")}</span>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {ago} · {when.toLocaleString()}
            {countSummary ? ` · ${countSummary}` : ""}
            {run.error_message ? ` · ${run.error_message}` : ""}
          </div>
        </div>
      </div>
      <Link
        to="/admin/integrations"
        className="text-xs font-medium text-[hsl(var(--accent))] hover:underline whitespace-nowrap"
        data-testid="roster-sync-banner-cta"
      >
        View integrations →
      </Link>
    </div>
  );
}

function relTime(date) {
  const diff = Date.now() - date.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return `${Math.floor(d / 7)} wk ago`;
}
