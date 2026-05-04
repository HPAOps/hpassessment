import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StudentShell from "@/components/Layout/StudentShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ArrowLeft, X, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getStudentEnrollments } from "@/lib/api";
import { toast } from "sonner";

export default function StudentTeacherVerify() {
  const { enrollmentId } = useParams();
  const { student } = useAuth();
  const nav = useNavigate();
  const [item, setItem] = useState(null);

  useEffect(() => {
    if (!student) return;
    getStudentEnrollments(student.id).then(items => {
      setItem(items.find(i => i.enrollment.id === enrollmentId));
    });
  }, [student, enrollmentId]);

  if (!item) return <StudentShell><div className="flex-1" /></StudentShell>;

  return (
    <StudentShell>
      <div className="max-w-2xl mx-auto px-6 py-12 w-full">
        <button onClick={() => nav(-1)} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-6" data-testid="back-btn">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="overline">Step 2 of 3</div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Verify your teacher</h1>
        <p className="mt-3 text-muted-foreground">Make sure this matches the teacher for <span className="font-medium text-foreground">{item.course.title}</span>.</p>

        <Card className="mt-8 border-2 border-[hsl(var(--primary))]" data-testid="teacher-verify-card">
          <CardContent className="p-8 text-center">
            <div className="overline">Your teacher for this course</div>
            <div className="mt-4 mx-auto h-20 w-20 rounded-full brand-gradient flex items-center justify-center">
              <span className="font-display text-3xl text-[hsl(var(--accent))] font-bold">
                {item.teacher ? `${item.teacher.first_name[0]}${item.teacher.last_name[0]}` : "?"}
              </span>
            </div>
            <div className="mt-5 font-display text-2xl font-bold tracking-tight">
              {item.teacher ? `${item.teacher.first_name} ${item.teacher.last_name}` : "Not yet assigned"}
            </div>
            <div className="mt-2 text-sm text-muted-foreground">{item.course.title} · Section {item.section?.section_code}</div>
            <div className="mt-2 text-sm text-muted-foreground">{item.campus?.name}</div>
          </CardContent>
        </Card>

        <div className="mt-8 grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="h-14 text-base"
            data-testid="teacher-verify-no"
            onClick={() => { toast.warning("No problem — please tell your teacher so we can correct your enrollment."); nav("/student/courses"); }}
          >
            <X className="h-4 w-4" /> No, that's not my teacher
          </Button>
          <Button
            className="h-14 text-base"
            data-testid="teacher-verify-yes"
            onClick={() => nav(`/student/tests/${enrollmentId}`)}
          >
            <Check className="h-4 w-4" /> Yes, that's my teacher
          </Button>
        </div>
      </div>
    </StudentShell>
  );
}
