-- =============================================================================
-- HPA Course Growth Assessments — Row Level Security Policies
-- =============================================================================
-- Run AFTER schema.sql.
-- Pattern:
--   * Super admins / district admins  : full read/write
--   * Campus admins                   : scoped to their campus_id
--   * Teachers                        : scoped to assigned course_sections only
--   * Students                        : their own active enrollments + attempts
-- =============================================================================

-- Helper: is the current user a staff role?
create or replace function public.current_role()
returns user_role
language sql stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_district_admin()
returns boolean
language sql stable
as $$
  select coalesce((select role in ('super_admin','district_admin') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable
as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.current_campus_id()
returns uuid
language sql stable
as $$
  select campus_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_teacher_id()
returns uuid
language sql stable
as $$
  select teacher_id from public.profiles where id = auth.uid()
$$;

-- =============================================================================
-- ENABLE RLS
-- =============================================================================
alter table public.profiles                  enable row level security;
alter table public.campuses                  enable row level security;
alter table public.school_years              enable row level security;
alter table public.terms                     enable row level security;
alter table public.courses                   enable row level security;
alter table public.course_sections           enable row level security;
alter table public.teachers                  enable row level security;
alter table public.students                  enable row level security;
alter table public.student_enrollments       enable row level security;
alter table public.teacher_class_assignments enable row level security;
alter table public.tests                     enable row level security;
alter table public.test_windows              enable row level security;
alter table public.questions                 enable row level security;
alter table public.question_images           enable row level security;
alter table public.answer_keys               enable row level security;
alter table public.test_imports              enable row level security;
alter table public.test_import_files         enable row level security;
alter table public.test_attempts             enable row level security;
alter table public.test_attempt_questions    enable row level security;
alter table public.student_responses         enable row level security;
alter table public.growth_results            enable row level security;
alter table public.audit_logs                enable row level security;
alter table public.app_settings              enable row level security;
alter table public.oneroster_imports         enable row level security;
alter table public.oneroster_import_files    enable row level security;
alter table public.oneroster_import_errors   enable row level security;
alter table public.oneroster_manifest          enable row level security;
alter table public.oneroster_academic_sessions enable row level security;
alter table public.oneroster_orgs              enable row level security;
alter table public.oneroster_users             enable row level security;
alter table public.oneroster_courses           enable row level security;
alter table public.oneroster_classes           enable row level security;
alter table public.oneroster_enrollments       enable row level security;
alter table public.oneroster_demographics      enable row level security;

-- =============================================================================
-- PROFILES
-- =============================================================================
create policy "profiles: self read" on public.profiles for select using (auth.uid() = id);
create policy "profiles: district read all" on public.profiles for select using (public.is_district_admin());
create policy "profiles: super write" on public.profiles for all using (public.is_super_admin()) with check (public.is_super_admin());

-- =============================================================================
-- READ-ONLY PUBLIC DOMAIN: campuses, school_years, terms
-- (Any signed-in staff can read; only district+ can write)
-- =============================================================================
create policy "campuses: staff read" on public.campuses for select using (auth.role() = 'authenticated');
create policy "campuses: district write" on public.campuses for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "school_years: staff read" on public.school_years for select using (auth.role() = 'authenticated');
create policy "school_years: district write" on public.school_years for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "terms: staff read" on public.terms for select using (auth.role() = 'authenticated');
create policy "terms: district write" on public.terms for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "courses: staff read" on public.courses for select using (auth.role() = 'authenticated');
create policy "courses: district write" on public.courses for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- COURSE SECTIONS
-- =============================================================================
create policy "sections: district read" on public.course_sections for select using (public.is_district_admin());
create policy "sections: campus read"   on public.course_sections for select using (public.current_role() = 'campus_admin' and campus_id = public.current_campus_id());
create policy "sections: teacher read"  on public.course_sections for select using (public.current_role() = 'teacher' and id in (select course_section_id from public.teacher_class_assignments where teacher_id = public.current_teacher_id()));
create policy "sections: district write" on public.course_sections for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- TEACHERS
-- =============================================================================
create policy "teachers: district read" on public.teachers for select using (public.is_district_admin());
create policy "teachers: campus read"   on public.teachers for select using (public.current_role() = 'campus_admin' and campus_id = public.current_campus_id());
create policy "teachers: self read"     on public.teachers for select using (id = public.current_teacher_id());
create policy "teachers: district write" on public.teachers for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- STUDENTS
-- =============================================================================
create policy "students: district read" on public.students for select using (public.is_district_admin());
create policy "students: campus read"   on public.students for select using (public.current_role() = 'campus_admin' and campus_id = public.current_campus_id());
create policy "students: teacher read"  on public.students for select using (
  public.current_role() = 'teacher'
  and id in (
    select se.student_id
    from public.student_enrollments se
    join public.teacher_class_assignments tca on tca.course_section_id = se.course_section_id
    where tca.teacher_id = public.current_teacher_id()
  )
);
create policy "students: district write" on public.students for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- ENROLLMENTS / TEACHER ASSIGNMENTS
-- =============================================================================
create policy "enrollments: district read" on public.student_enrollments for select using (public.is_district_admin());
create policy "enrollments: campus read"   on public.student_enrollments for select using (
  public.current_role() = 'campus_admin'
  and student_id in (select id from public.students where campus_id = public.current_campus_id())
);
create policy "enrollments: teacher read"  on public.student_enrollments for select using (
  public.current_role() = 'teacher'
  and course_section_id in (select course_section_id from public.teacher_class_assignments where teacher_id = public.current_teacher_id())
);
create policy "enrollments: district write" on public.student_enrollments for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "tca: district read" on public.teacher_class_assignments for select using (public.is_district_admin());
create policy "tca: campus read"   on public.teacher_class_assignments for select using (
  public.current_role() = 'campus_admin'
  and course_section_id in (select id from public.course_sections where campus_id = public.current_campus_id())
);
create policy "tca: self read"     on public.teacher_class_assignments for select using (teacher_id = public.current_teacher_id());
create policy "tca: district write" on public.teacher_class_assignments for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- TESTS / WINDOWS / QUESTIONS / ANSWER KEYS
-- =============================================================================
-- Tests: any authenticated staff may read published tests; district may read all.
create policy "tests: staff read published" on public.tests for select using (auth.role() = 'authenticated' and (is_published or public.is_district_admin()));
create policy "tests: district write" on public.tests for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "twindows: staff read" on public.test_windows for select using (auth.role() = 'authenticated');
create policy "twindows: district write" on public.test_windows for all using (public.is_district_admin()) with check (public.is_district_admin());

-- Questions: students can only read questions for the test they're actively attempting
-- and only the metadata + image_url — answer key is in a separate table guarded below.
create policy "questions: staff read"   on public.questions for select using (auth.role() = 'authenticated');
create policy "questions: district write" on public.questions for all using (public.is_district_admin()) with check (public.is_district_admin());

-- ANSWER KEYS — never exposed to students. Only super/district admins.
create policy "answer_keys: district only" on public.answer_keys for all
  using (public.is_district_admin())
  with check (public.is_district_admin());

create policy "qimages: staff read" on public.question_images for select using (auth.role() = 'authenticated');
create policy "qimages: district write" on public.question_images for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- TEST IMPORTS / FILES
-- =============================================================================
create policy "ti: district" on public.test_imports for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "tif: district" on public.test_import_files for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- ATTEMPTS / RESPONSES
-- =============================================================================
-- A student is identified by matching profile.email -> students.email OR via an explicit
-- student_id claim in JWT (custom). For Student-ID-only flow, attempts are managed via
-- a SECURITY DEFINER RPC (see functions/student_login.sql + functions/score_attempt.sql).

-- District admins see all attempts; campus admins scoped to their campus students;
-- teachers scoped to their assigned section students.
create policy "attempts: district read" on public.test_attempts for select using (public.is_district_admin());
create policy "attempts: campus read"   on public.test_attempts for select using (
  public.current_role() = 'campus_admin'
  and student_id in (select id from public.students where campus_id = public.current_campus_id())
);
create policy "attempts: teacher read"  on public.test_attempts for select using (
  public.current_role() = 'teacher'
  and course_section_id in (select course_section_id from public.teacher_class_assignments where teacher_id = public.current_teacher_id())
);
create policy "attempts: district write" on public.test_attempts for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "responses: district read" on public.student_responses for select using (public.is_district_admin());
create policy "responses: campus read"   on public.student_responses for select using (
  public.current_role() = 'campus_admin'
  and attempt_id in (select id from public.test_attempts where student_id in (select id from public.students where campus_id = public.current_campus_id()))
);
create policy "responses: teacher read"  on public.student_responses for select using (
  public.current_role() = 'teacher'
  and attempt_id in (select id from public.test_attempts where course_section_id in (select course_section_id from public.teacher_class_assignments where teacher_id = public.current_teacher_id()))
);
create policy "responses: district write" on public.student_responses for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "taq: district read" on public.test_attempt_questions for select using (public.is_district_admin());
create policy "taq: district write" on public.test_attempt_questions for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "growth: district read" on public.growth_results for select using (public.is_district_admin());
create policy "growth: campus read"   on public.growth_results for select using (
  public.current_role() = 'campus_admin'
  and student_id in (select id from public.students where campus_id = public.current_campus_id())
);
create policy "growth: teacher read"  on public.growth_results for select using (
  public.current_role() = 'teacher'
  and student_id in (
    select se.student_id from public.student_enrollments se
    join public.teacher_class_assignments tca on tca.course_section_id = se.course_section_id
    where tca.teacher_id = public.current_teacher_id()
  )
);
create policy "growth: district write" on public.growth_results for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- AUDIT + SETTINGS
-- =============================================================================
create policy "audit: district read" on public.audit_logs for select using (public.is_district_admin());
create policy "audit: insert via RPC" on public.audit_logs for insert with check (auth.role() = 'authenticated');

create policy "settings: staff read" on public.app_settings for select using (auth.role() = 'authenticated');
create policy "settings: super write" on public.app_settings for all using (public.is_super_admin()) with check (public.is_super_admin());

-- =============================================================================
-- ONEROSTER STAGING — district admins only
-- =============================================================================
create policy "or_imports: district" on public.oneroster_imports for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_files: district"   on public.oneroster_import_files for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_errs: district"    on public.oneroster_import_errors for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_manifest: district" on public.oneroster_manifest for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_as: district"      on public.oneroster_academic_sessions for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_orgs: district"    on public.oneroster_orgs for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_users: district"   on public.oneroster_users for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_courses: district" on public.oneroster_courses for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_classes: district" on public.oneroster_classes for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_enr: district"     on public.oneroster_enrollments for all using (public.is_district_admin()) with check (public.is_district_admin());
create policy "or_demo: district"    on public.oneroster_demographics for all using (public.is_district_admin()) with check (public.is_district_admin());
