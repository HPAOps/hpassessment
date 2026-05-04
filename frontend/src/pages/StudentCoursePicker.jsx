import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, BookOpen } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getStudentEnrollments } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";

export default function StudentCoursePicker() {
  const { student } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!student) return;
    getStudentEnrollments(student.id).then(setItems);
  }, [student]);

  if (items === null) {
    return <StudentShell><div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></StudentShell>;
  }

  return (
    <StudentShell>
      <div className="max-w-3xl mx-auto px-6 py-12 w-full">
        <div className="overline">Step 1 of 3</div>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight">Hi, {student.name.split(" ")[0]} 👋</h1>
        <p className="mt-3 text-muted-foreground">Choose the course you'd like to take an assessment for.</p>

        <div className="mt-8 space-y-3">
          {items.length === 0 && (
            <EmptyState
              title="No active enrollments"
              description="We couldn't find any active course enrollments for your Student ID. Please see your teacher."
            />
          )}
          {items.map((it) => (
            <button
              key={it.enrollment.id}
              data-testid={`course-pick-${it.course.id}`}
              onClick={() => nav(`/student/teacher-verify/${it.enrollment.id}`)}
              className="w-full text-left rounded-lg border border-border bg-card p-5 hover:border-[hsl(var(--accent))]/50 hover:shadow-md transition-all flex items-center gap-4"
            >
              <div className="h-12 w-12 rounded-md brand-gradient flex items-center justify-center shrink-0">
                <BookOpen className="h-5 w-5 text-[hsl(var(--accent))]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="overline">{it.campus?.name}</div>
                <div className="font-display text-lg font-semibold tracking-tight mt-0.5">{it.course.title}</div>
                <div className="text-xs text-muted-foreground mt-1">Section {it.section?.section_code} · Teacher {it.teacher ? `${it.teacher.first_name} ${it.teacher.last_name}` : "TBD"}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </StudentShell>
  );
}
