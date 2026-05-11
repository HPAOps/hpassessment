import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { RequireStaff, RequireStudent } from "@/components/common/RouteGuards";
import "@/App.css";

import StudentLogin from "@/pages/StudentLogin";
import StudentCoursePicker from "@/pages/StudentCoursePicker";
import StudentTeacherVerify from "@/pages/StudentTeacherVerify";
import StudentTestSelector from "@/pages/StudentTestSelector";
import StudentTestCode from "@/pages/StudentTestCode";
import StudentWaitingRoom from "@/pages/StudentWaitingRoom";
import StudentTest from "@/pages/StudentTest";
import StudentSubmitConfirm from "@/pages/StudentSubmitConfirm";
import StaffLogin from "@/pages/StaffLogin";
import StaffForgotPassword from "@/pages/StaffForgotPassword";
import StaffResetPassword from "@/pages/StaffResetPassword";
import StaffOAuthCallback from "@/pages/StaffOAuthCallback";

import AdminDashboard from "@/pages/admin/Dashboard";
import Tests from "@/pages/admin/Tests";
import QuestionManager from "@/pages/admin/QuestionManager";
import AnswerKeyEditor from "@/pages/admin/AnswerKeyEditor";
import OneRosterImport from "@/pages/admin/OneRosterImport";
import TestImport from "@/pages/admin/TestImport";
import Reports from "@/pages/admin/Reports";
import AuditLogs from "@/pages/admin/AuditLogs";
import SettingsPage from "@/pages/admin/Settings";
import Campuses from "@/pages/admin/Campuses";
import Users from "@/pages/admin/Users";
import TestPreview from "@/pages/admin/TestPreview";
import Integrations from "@/pages/admin/Integrations";
import Sections from "@/pages/admin/Sections";
import SectionRoster from "@/pages/admin/SectionRoster";
import Proctor from "@/pages/admin/Proctor";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SettingsProvider>
          <Toaster position="top-center" richColors />
          <Routes>
            {/* Student */}
            <Route path="/" element={<StudentLogin />} />
            <Route path="/student/courses" element={<RequireStudent><StudentCoursePicker /></RequireStudent>} />
            <Route path="/student/teacher-verify/:enrollmentId" element={<RequireStudent><StudentTeacherVerify /></RequireStudent>} />
            <Route path="/student/tests/:enrollmentId" element={<RequireStudent><StudentTestSelector /></RequireStudent>} />
            <Route path="/student/test-code/:enrollmentId/:testId/:phase" element={<RequireStudent><StudentTestCode /></RequireStudent>} />
            <Route path="/student/waiting/:attemptId" element={<RequireStudent><StudentWaitingRoom /></RequireStudent>} />
            <Route path="/student/test/:attemptId" element={<RequireStudent><StudentTest /></RequireStudent>} />
            <Route path="/student/submitted/:attemptId" element={<RequireStudent><StudentSubmitConfirm /></RequireStudent>} />

            {/* Staff */}
            <Route path="/staff/login" element={<StaffLogin />} />
            <Route path="/staff/forgot-password" element={<StaffForgotPassword />} />
            <Route path="/staff/reset-password" element={<StaffResetPassword />} />
            <Route path="/staff/oauth-callback" element={<StaffOAuthCallback />} />
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<RequireStaff><AdminDashboard /></RequireStaff>} />
            <Route path="/admin/tests" element={<RequireStaff roles={["super_admin","district_admin","campus_admin"]}><Tests /></RequireStaff>} />
            <Route path="/admin/tests/:testId/preview" element={<RequireStaff><TestPreview /></RequireStaff>} />
            <Route path="/admin/questions" element={<RequireStaff roles={["super_admin","district_admin"]}><QuestionManager /></RequireStaff>} />
            <Route path="/admin/answer-keys" element={<RequireStaff roles={["super_admin","district_admin"]}><AnswerKeyEditor /></RequireStaff>} />
            <Route path="/admin/oneroster" element={<RequireStaff roles={["super_admin","district_admin"]}><OneRosterImport /></RequireStaff>} />
            <Route path="/admin/test-import" element={<RequireStaff roles={["super_admin","district_admin"]}><TestImport /></RequireStaff>} />
            <Route path="/admin/reports" element={<RequireStaff><Reports /></RequireStaff>} />
            <Route path="/admin/audit" element={<RequireStaff roles={["super_admin","district_admin"]}><AuditLogs /></RequireStaff>} />
            <Route path="/admin/settings" element={<RequireStaff roles={["super_admin"]}><SettingsPage /></RequireStaff>} />
            <Route path="/admin/integrations" element={<RequireStaff roles={["super_admin","district_admin"]}><Integrations /></RequireStaff>} />
            <Route path="/admin/campuses" element={<RequireStaff roles={["super_admin","district_admin"]}><Campuses /></RequireStaff>} />
            <Route path="/admin/users" element={<RequireStaff><Users /></RequireStaff>} />
            <Route path="/admin/sections" element={<RequireStaff><Sections /></RequireStaff>} />
            <Route path="/admin/sections/:sectionId" element={<RequireStaff><SectionRoster /></RequireStaff>} />
            <Route path="/admin/sections/:sectionId/proctor/:testId/:phase" element={<RequireStaff><Proctor /></RequireStaff>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
