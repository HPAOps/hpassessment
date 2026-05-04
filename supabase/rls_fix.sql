-- =============================================================================
-- HPA — RLS RECURSION FIX
-- =============================================================================
-- Cause: helper functions like is_district_admin() query public.profiles,
-- and profiles has an RLS policy that calls is_district_admin() back —
-- Postgres re-evaluates RLS on every recursive call → 42P17 / 54001.
-- Fix: mark every helper SECURITY DEFINER (bypasses RLS), and rewrite the
-- handful of cross-table policies that joined teacher_class_assignments to
-- use SECURITY DEFINER helpers that return the caller's accessible IDs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helper functions become SECURITY DEFINER + STABLE
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_district_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('super_admin','district_admin') from public.profiles where id = auth.uid()),
    false)
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'super_admin' from public.profiles where id = auth.uid()),
    false)
$$;

create or replace function public.current_campus_id()
returns uuid language sql stable security definer set search_path = public as $$
  select campus_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_teacher_id()
returns uuid language sql stable security definer set search_path = public as $$
  select teacher_id from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 2) Caller-scope helpers (return accessible IDs without re-triggering RLS)
-- ---------------------------------------------------------------------------
create or replace function public.my_section_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select tca.course_section_id
  from public.teacher_class_assignments tca
  where tca.teacher_id = public.current_teacher_id()
$$;

create or replace function public.my_student_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct se.student_id
  from public.student_enrollments se
  where se.course_section_id in (
    select tca.course_section_id from public.teacher_class_assignments tca
    where tca.teacher_id = public.current_teacher_id()
  )
$$;

create or replace function public.my_campus_section_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.course_sections where campus_id = public.current_campus_id()
$$;

create or replace function public.my_campus_student_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.students where campus_id = public.current_campus_id()
$$;

-- ---------------------------------------------------------------------------
-- 3) Drop + re-create the policies that previously joined cross-table.
-- Anything else (district admin, super admin, self read) is unaffected.
-- ---------------------------------------------------------------------------

-- COURSE SECTIONS
drop policy if exists "sections_teacher_read" on public.course_sections;
create policy "sections_teacher_read" on public.course_sections for select using (
  public.app_role() = 'teacher' and id in (select public.my_section_ids())
);

-- STUDENTS
drop policy if exists "students_teacher_read" on public.students;
create policy "students_teacher_read" on public.students for select using (
  public.app_role() = 'teacher' and id in (select public.my_student_ids())
);

-- ENROLLMENTS
drop policy if exists "enrollments_campus_read" on public.student_enrollments;
create policy "enrollments_campus_read" on public.student_enrollments for select using (
  public.app_role() = 'campus_admin'
  and student_id in (select public.my_campus_student_ids())
);

drop policy if exists "enrollments_teacher_read" on public.student_enrollments;
create policy "enrollments_teacher_read" on public.student_enrollments for select using (
  public.app_role() = 'teacher'
  and course_section_id in (select public.my_section_ids())
);

-- TEACHER_CLASS_ASSIGNMENTS
drop policy if exists "tca_campus_read" on public.teacher_class_assignments;
create policy "tca_campus_read" on public.teacher_class_assignments for select using (
  public.app_role() = 'campus_admin'
  and course_section_id in (select public.my_campus_section_ids())
);

-- TEST ATTEMPTS
drop policy if exists "attempts_campus_read" on public.test_attempts;
create policy "attempts_campus_read" on public.test_attempts for select using (
  public.app_role() = 'campus_admin'
  and student_id in (select public.my_campus_student_ids())
);

drop policy if exists "attempts_teacher_read" on public.test_attempts;
create policy "attempts_teacher_read" on public.test_attempts for select using (
  public.app_role() = 'teacher'
  and course_section_id in (select public.my_section_ids())
);

-- STUDENT RESPONSES
drop policy if exists "responses_campus_read" on public.student_responses;
create policy "responses_campus_read" on public.student_responses for select using (
  public.app_role() = 'campus_admin'
  and attempt_id in (
    select id from public.test_attempts where student_id in (select public.my_campus_student_ids())
  )
);

drop policy if exists "responses_teacher_read" on public.student_responses;
create policy "responses_teacher_read" on public.student_responses for select using (
  public.app_role() = 'teacher'
  and attempt_id in (
    select id from public.test_attempts where course_section_id in (select public.my_section_ids())
  )
);

-- GROWTH RESULTS
drop policy if exists "growth_campus_read" on public.growth_results;
create policy "growth_campus_read" on public.growth_results for select using (
  public.app_role() = 'campus_admin'
  and student_id in (select public.my_campus_student_ids())
);

drop policy if exists "growth_teacher_read" on public.growth_results;
create policy "growth_teacher_read" on public.growth_results for select using (
  public.app_role() = 'teacher'
  and student_id in (select public.my_student_ids())
);

-- Tell PostgREST to reload its schema cache so new functions are picked up.
notify pgrst, 'reload schema';

select 'rls fix applied' as status;
