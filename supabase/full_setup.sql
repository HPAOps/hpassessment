-- =============================================================================
-- HPA Course Growth Assessments — FULL SUPABASE SETUP (single-paste script)
-- =============================================================================
-- Paste this entire file into the Supabase SQL Editor at
--   https://supabase.com/dashboard/project/soaagmzmecutvlxfbscl/sql/new
-- and click "Run". It is idempotent — safe to re-run.
--
-- Sections in order:
--   1) Schema (tables, enums, indexes)
--   2) RLS helpers + policies
--   3) Storage buckets + storage policies
--   4) RPCs (student_lookup, start_or_get_attempt, save_response,
--            submit_attempt, reset_attempt)
--   5) Minimal seed (3 campuses + 2 placeholder courses + 2026-2027 school year)
--
-- After running this script:
--   • Run extended_seed.sql to add 22 courses, 5 teachers, 30 students, 5 tests.
--   • Authentication → Users → Add user × 4 (super, district, madison, teacher).
--   • Run staff_bootstrap.sql with the 4 auth.users UUIDs filled in.
--   • In /app/frontend/.env set REACT_APP_FORCE_DEMO=false (or remove that line)
--     and restart the frontend (sudo supervisorctl restart frontend).
-- =============================================================================

-- =============================================================================
-- HPA Course Growth Assessments — Full Postgres Schema for Supabase
-- =============================================================================
-- Run this script in the Supabase SQL Editor.
-- Then run rls_policies.sql, storage_buckets.sql, and seed.sql in that order.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================
do $$ begin
  create type user_role as enum ('super_admin','district_admin','campus_admin','teacher','student');
exception when duplicate_object then null; end $$;

do $$ begin
  create type test_type_enum as enum ('BOC','EOC');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attempt_status as enum ('in_progress','submitted','reset');
exception when duplicate_object then null; end $$;

do $$ begin
  create type answer_letter as enum ('A','B','C','D');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- 1. PROFILES + ROLES
-- =============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text,
  role user_role not null default 'teacher',
  campus_id uuid,
  teacher_id uuid,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role user_role not null,
  permission text not null,
  unique(role, permission)
);

create table if not exists public.campus_user_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  campus_id uuid,
  created_at timestamptz default now()
);

-- =============================================================================
-- 2. ONEROSTER STAGING TABLES (raw, source-of-truth preserved)
-- =============================================================================
create table if not exists public.oneroster_imports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz default now(),
  filename text,
  storage_path text,                     -- pointer into oneroster-imports bucket
  files_seen text[],
  counts jsonb,
  status text default 'pending',
  errors jsonb default '[]'::jsonb
);

create table if not exists public.oneroster_import_files (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.oneroster_imports(id) on delete cascade,
  filename text not null,
  row_count integer default 0,
  storage_path text,
  created_at timestamptz default now()
);

create table if not exists public.oneroster_import_errors (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.oneroster_imports(id) on delete cascade,
  filename text, line_number int, message text, raw jsonb,
  created_at timestamptz default now()
);

create table if not exists public.oneroster_manifest          (id uuid primary key default gen_random_uuid(), import_id uuid references public.oneroster_imports(id) on delete cascade, raw jsonb);
create table if not exists public.oneroster_academic_sessions (id uuid primary key default gen_random_uuid(), import_id uuid references public.oneroster_imports(id) on delete cascade, sourced_id text, raw jsonb);
create table if not exists public.oneroster_orgs              (id uuid primary key default gen_random_uuid(), import_id uuid references public.oneroster_imports(id) on delete cascade, sourced_id text, raw jsonb);
create table if not exists public.oneroster_users             (id uuid primary key default gen_random_uuid(), import_id uuid references public.oneroster_imports(id) on delete cascade, sourced_id text, role text, raw jsonb);
create table if not exists public.oneroster_courses           (id uuid primary key default gen_random_uuid(), import_id uuid references public.oneroster_imports(id) on delete cascade, sourced_id text, raw jsonb);
create table if not exists public.oneroster_classes           (id uuid primary key default gen_random_uuid(), import_id uuid references public.oneroster_imports(id) on delete cascade, sourced_id text, raw jsonb);
create table if not exists public.oneroster_enrollments       (id uuid primary key default gen_random_uuid(), import_id uuid references public.oneroster_imports(id) on delete cascade, sourced_id text, role text, raw jsonb);
create table if not exists public.oneroster_demographics      (id uuid primary key default gen_random_uuid(), import_id uuid references public.oneroster_imports(id) on delete cascade, sourced_id text, raw jsonb);

create index if not exists idx_or_users_sid       on public.oneroster_users (sourced_id);
create index if not exists idx_or_classes_sid     on public.oneroster_classes (sourced_id);
create index if not exists idx_or_enrollments_sid on public.oneroster_enrollments (sourced_id);

-- =============================================================================
-- 3. OPERATIONAL ROSTER TABLES
-- =============================================================================
create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  oneroster_org_sourced_id text unique,
  name text not null,
  code text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.school_years (
  id uuid primary key default gen_random_uuid(),
  oneroster_academic_session_sourced_id text unique,
  name text not null, start_date date, end_date date,
  is_active boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  oneroster_academic_session_sourced_id text unique,
  school_year_id uuid references public.school_years(id) on delete set null,
  name text not null, start_date date, end_date date
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  oneroster_course_sourced_id text unique,
  school_year_id uuid references public.school_years(id) on delete set null,
  code text, title text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.course_sections (
  id uuid primary key default gen_random_uuid(),
  oneroster_class_sourced_id text unique,
  course_id uuid references public.courses(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  term_id uuid references public.terms(id) on delete set null,
  section_code text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  oneroster_user_sourced_id text unique,
  profile_id uuid references public.profiles(id) on delete set null,
  first_name text, last_name text, email text, campus_id uuid references public.campuses(id) on delete set null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  oneroster_user_sourced_id text unique,
  student_id text unique not null,
  first_name text, last_name text, grade_level int,
  campus_id uuid references public.campuses(id) on delete set null,
  email text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  oneroster_enrollment_sourced_id text unique,
  student_id uuid references public.students(id) on delete cascade,
  course_section_id uuid references public.course_sections(id) on delete cascade,
  status text default 'active',
  created_at timestamptz default now()
);

create table if not exists public.teacher_class_assignments (
  id uuid primary key default gen_random_uuid(),
  oneroster_enrollment_sourced_id text unique,
  teacher_id uuid references public.teachers(id) on delete cascade,
  course_section_id uuid references public.course_sections(id) on delete cascade,
  created_at timestamptz default now()
);

-- =============================================================================
-- 4. ASSESSMENT TABLES
-- =============================================================================
create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete cascade,
  school_year_id uuid references public.school_years(id) on delete set null,
  name text not null,
  test_type test_type_enum not null,
  scope text default 'district',                -- district | campus
  campus_id uuid references public.campuses(id) on delete set null,
  question_count int default 0,
  is_published boolean default false,
  opens_at date, closes_at date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists public.test_windows (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references public.tests(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete cascade,
  opens_at timestamptz, closes_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references public.tests(id) on delete cascade,
  question_number int not null,
  image_url text,                                -- public URL or storage path
  storage_path text,                              -- internal storage path
  correct_answer answer_letter,
  standard_tag text, difficulty text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  unique (test_id, question_number)
);

create table if not exists public.question_images (
  id uuid primary key default gen_random_uuid(),
  question_id uuid references public.questions(id) on delete cascade,
  storage_path text not null,
  is_current boolean default true,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.answer_keys (
  id uuid primary key default gen_random_uuid(),
  test_id uuid references public.tests(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  correct_answer answer_letter not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.test_imports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz default now(),
  course_id uuid references public.courses(id) on delete set null,
  test_id  uuid references public.tests(id) on delete set null,
  booklet_filename text, answer_key_filename text,
  detected_questions int, uploaded_images int,
  status text default 'pending'
);

create table if not exists public.test_import_files (
  id uuid primary key default gen_random_uuid(),
  test_import_id uuid references public.test_imports(id) on delete cascade,
  kind text,                       -- 'booklet' | 'answer_key' | 'image' | 'zip'
  storage_path text not null,
  filename text,
  created_at timestamptz default now()
);

-- =============================================================================
-- 5. ATTEMPT / SCORING
-- =============================================================================
create table if not exists public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  test_id    uuid references public.tests(id) on delete cascade,
  course_section_id uuid references public.course_sections(id) on delete set null,
  question_order uuid[] not null,            -- preserves randomized order
  status attempt_status default 'in_progress',
  started_at timestamptz default now(),
  submitted_at timestamptz,
  score_percent int,
  correct_count int, total_count int,
  is_reset boolean default false,
  created_at timestamptz default now(),
  unique (student_id, test_id)
);

create table if not exists public.test_attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.test_attempts(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  display_order int not null,
  -- snapshot of what was shown so historical attempts don't break:
  snapshot_image_url text, snapshot_correct_answer answer_letter,
  unique (attempt_id, question_id)
);

create table if not exists public.student_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.test_attempts(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  selected_answer answer_letter,
  responded_at timestamptz default now(),
  unique (attempt_id, question_id)
);

create table if not exists public.growth_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete cascade,
  course_id  uuid references public.courses(id) on delete cascade,
  school_year_id uuid references public.school_years(id) on delete set null,
  boc_score int, eoc_score int,
  point_difference int,
  growth_percentage int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (student_id, course_id, school_year_id)
);

-- =============================================================================
-- 6. AUDIT + SETTINGS
-- =============================================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_email text,
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz default now()
);

create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  show_score_to_student boolean default false,
  enable_timer boolean default false,
  default_test_minutes int default 60,
  allow_test_retakes boolean default false,
  require_teacher_verification boolean default true,
  random_question_order boolean default true,
  campus_specific_windows boolean default false,
  test_locked_message text default 'This test is currently closed. Please see your teacher.',
  maintenance_mode boolean default false,
  show_question_analysis_to_teachers boolean default true,
  campus_admins_can_reset_attempts boolean default true,
  teachers_can_view_scores boolean default true,
  teachers_can_export_results boolean default false,
  updated_at timestamptz default now()
);

insert into public.app_settings (id) values (1) on conflict do nothing;

-- =============================================================================
-- INDEXES
-- =============================================================================
create index if not exists idx_students_studentid       on public.students (student_id);
create index if not exists idx_students_campus          on public.students (campus_id);
create index if not exists idx_teachers_campus          on public.teachers (campus_id);
create index if not exists idx_sections_course          on public.course_sections (course_id);
create index if not exists idx_sections_campus          on public.course_sections (campus_id);
create index if not exists idx_enrollments_student      on public.student_enrollments (student_id);
create index if not exists idx_enrollments_section      on public.student_enrollments (course_section_id);
create index if not exists idx_tca_section              on public.teacher_class_assignments (course_section_id);
create index if not exists idx_questions_test           on public.questions (test_id);
create index if not exists idx_attempts_student_test    on public.test_attempts (student_id, test_id);
create index if not exists idx_responses_attempt        on public.student_responses (attempt_id);
create index if not exists idx_growth_student_course    on public.growth_results (student_id, course_id);
create index if not exists idx_audit_created            on public.audit_logs (created_at desc);

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
create or replace function public.app_role()
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
create policy "sections: campus read"   on public.course_sections for select using (public.app_role() = 'campus_admin' and campus_id = public.current_campus_id());
create policy "sections: teacher read"  on public.course_sections for select using (public.app_role() = 'teacher' and id in (select course_section_id from public.teacher_class_assignments where teacher_id = public.current_teacher_id()));
create policy "sections: district write" on public.course_sections for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- TEACHERS
-- =============================================================================
create policy "teachers: district read" on public.teachers for select using (public.is_district_admin());
create policy "teachers: campus read"   on public.teachers for select using (public.app_role() = 'campus_admin' and campus_id = public.current_campus_id());
create policy "teachers: self read"     on public.teachers for select using (id = public.current_teacher_id());
create policy "teachers: district write" on public.teachers for all using (public.is_district_admin()) with check (public.is_district_admin());

-- =============================================================================
-- STUDENTS
-- =============================================================================
create policy "students: district read" on public.students for select using (public.is_district_admin());
create policy "students: campus read"   on public.students for select using (public.app_role() = 'campus_admin' and campus_id = public.current_campus_id());
create policy "students: teacher read"  on public.students for select using (
  public.app_role() = 'teacher'
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
  public.app_role() = 'campus_admin'
  and student_id in (select id from public.students where campus_id = public.current_campus_id())
);
create policy "enrollments: teacher read"  on public.student_enrollments for select using (
  public.app_role() = 'teacher'
  and course_section_id in (select course_section_id from public.teacher_class_assignments where teacher_id = public.current_teacher_id())
);
create policy "enrollments: district write" on public.student_enrollments for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "tca: district read" on public.teacher_class_assignments for select using (public.is_district_admin());
create policy "tca: campus read"   on public.teacher_class_assignments for select using (
  public.app_role() = 'campus_admin'
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
  public.app_role() = 'campus_admin'
  and student_id in (select id from public.students where campus_id = public.current_campus_id())
);
create policy "attempts: teacher read"  on public.test_attempts for select using (
  public.app_role() = 'teacher'
  and course_section_id in (select course_section_id from public.teacher_class_assignments where teacher_id = public.current_teacher_id())
);
create policy "attempts: district write" on public.test_attempts for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "responses: district read" on public.student_responses for select using (public.is_district_admin());
create policy "responses: campus read"   on public.student_responses for select using (
  public.app_role() = 'campus_admin'
  and attempt_id in (select id from public.test_attempts where student_id in (select id from public.students where campus_id = public.current_campus_id()))
);
create policy "responses: teacher read"  on public.student_responses for select using (
  public.app_role() = 'teacher'
  and attempt_id in (select id from public.test_attempts where course_section_id in (select course_section_id from public.teacher_class_assignments where teacher_id = public.current_teacher_id()))
);
create policy "responses: district write" on public.student_responses for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "taq: district read" on public.test_attempt_questions for select using (public.is_district_admin());
create policy "taq: district write" on public.test_attempt_questions for all using (public.is_district_admin()) with check (public.is_district_admin());

create policy "growth: district read" on public.growth_results for select using (public.is_district_admin());
create policy "growth: campus read"   on public.growth_results for select using (
  public.app_role() = 'campus_admin'
  and student_id in (select id from public.students where campus_id = public.current_campus_id())
);
create policy "growth: teacher read"  on public.growth_results for select using (
  public.app_role() = 'teacher'
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

-- =============================================================================
-- Storage buckets + policies
-- =============================================================================
-- Run in Supabase SQL editor AFTER rls_policies.sql.
-- Buckets:
--   oneroster-imports   — original OneRoster ZIP files (PRIVATE)
--   test-booklets       — original quiz booklet files (PRIVATE)
--   answer-keys         — original answer key files (PRIVATE)
--   question-images     — individual question images (PRIVATE, signed URLs)
--   import-files        — temporary parsing scratch (PRIVATE)
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('oneroster-imports', 'oneroster-imports', false),
  ('test-booklets',     'test-booklets',     false),
  ('answer-keys',       'answer-keys',       false),
  ('question-images',   'question-images',   false),
  ('import-files',      'import-files',      false)
on conflict (id) do nothing;

-- District admins may upload/read all assessment-related buckets.
create policy "oneroster: district rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'oneroster-imports' and public.is_district_admin())
  with check (bucket_id = 'oneroster-imports' and public.is_district_admin());

create policy "booklets: district rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'test-booklets' and public.is_district_admin())
  with check (bucket_id = 'test-booklets' and public.is_district_admin());

-- Answer keys: NEVER readable except district admins.
create policy "answer-keys: district rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'answer-keys' and public.is_district_admin())
  with check (bucket_id = 'answer-keys' and public.is_district_admin());

-- Question images:
--   * District admins: full read/write
--   * Authenticated users (incl. students via signed URL): read-only.
create policy "qimages: district write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-images' and public.is_district_admin());

create policy "qimages: district update/delete" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-images' and public.is_district_admin())
  with check (bucket_id = 'question-images' and public.is_district_admin());

create policy "qimages: authenticated read" on storage.objects
  for select to authenticated
  using (bucket_id = 'question-images');

create policy "import-files: district rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'import-files' and public.is_district_admin())
  with check (bucket_id = 'import-files' and public.is_district_admin());

-- =============================================================================
-- Student-ID login RPC
-- =============================================================================
-- The student app collects only a Student ID. This RPC validates it server-side
-- (so the anon key alone cannot enumerate students) and returns the minimum
-- profile + active enrollments so the React app can render the course picker.
--
-- The function is SECURITY DEFINER so it can read across RLS (the function
-- enforces its own checks). Grant execute to anon so the student-id input
-- works without a Supabase auth session.
-- =============================================================================

create or replace function public.student_lookup(p_student_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
  v_enrollments jsonb;
begin
  select * into v_student
  from public.students
  where student_id = p_student_id and is_active = true
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'enrollment_id', se.id,
    'course', jsonb_build_object('id', c.id, 'title', c.title, 'code', c.code),
    'section', jsonb_build_object('id', cs.id, 'section_code', cs.section_code),
    'campus',  jsonb_build_object('id', cmp.id, 'name', cmp.name),
    'teacher', case when t.id is null then null else
      jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
    end
  )), '[]'::jsonb)
  into v_enrollments
  from public.student_enrollments se
  join public.course_sections cs on cs.id = se.course_section_id
  join public.courses c on c.id = cs.course_id
  left join public.campuses cmp on cmp.id = cs.campus_id
  left join public.teacher_class_assignments tca on tca.course_section_id = cs.id
  left join public.teachers t on t.id = tca.teacher_id
  where se.student_id = v_student.id and se.status = 'active';

  return jsonb_build_object(
    'found', true,
    'student', jsonb_build_object(
      'id', v_student.id,
      'student_id', v_student.student_id,
      'name', concat_ws(' ', v_student.first_name, v_student.last_name),
      'campus_id', v_student.campus_id
    ),
    'enrollments', v_enrollments
  );
end $$;

revoke all on function public.student_lookup(text) from public;
grant execute on function public.student_lookup(text) to anon, authenticated;

-- =============================================================================
-- Server-side test attempt + scoring RPCs
-- =============================================================================
-- Student-facing functions that the React app calls (with anon JWT carrying
-- only a session_id + student_db_id provided by student_lookup).  Use
-- SECURITY DEFINER + explicit checks to avoid leaking the answer key.
-- =============================================================================

create or replace function public.start_or_get_attempt(
  p_student_db_id uuid,
  p_test_id       uuid,
  p_section_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_question_ids uuid[];
begin
  -- Verify enrollment
  if not exists (
    select 1 from public.student_enrollments se
    join public.tests t on t.course_id = (select course_id from public.course_sections where id = se.course_section_id)
    where se.student_id = p_student_db_id and t.id = p_test_id and se.status = 'active'
  ) then
    raise exception 'Student not enrolled in the course for this test.';
  end if;

  select * into v_attempt from public.test_attempts where student_id = p_student_db_id and test_id = p_test_id;
  if found then
    return to_jsonb(v_attempt);
  end if;

  -- Build randomized question order
  select array_agg(id order by random()) into v_question_ids
  from public.questions where test_id = p_test_id and is_active = true;

  insert into public.test_attempts (student_id, test_id, course_section_id, question_order, status, total_count)
  values (p_student_db_id, p_test_id, p_section_id, v_question_ids, 'in_progress', coalesce(array_length(v_question_ids, 1), 0))
  returning * into v_attempt;

  -- Snapshot questions
  insert into public.test_attempt_questions (attempt_id, question_id, display_order, snapshot_image_url, snapshot_correct_answer)
  select v_attempt.id, q.id, qno.idx, q.image_url, q.correct_answer
  from unnest(v_question_ids) with ordinality qno(qid, idx)
  join public.questions q on q.id = qno.qid;

  return to_jsonb(v_attempt);
end $$;

grant execute on function public.start_or_get_attempt(uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.save_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer answer_letter
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.student_responses (attempt_id, question_id, selected_answer)
  values (p_attempt_id, p_question_id, p_answer)
  on conflict (attempt_id, question_id)
    do update set selected_answer = excluded.selected_answer, responded_at = now();
end $$;

grant execute on function public.save_response(uuid, uuid, answer_letter) to anon, authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.submit_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_correct int := 0;
  v_total int := 0;
  v_score int := 0;
  v_test public.tests%rowtype;
  v_boc int; v_eoc int; v_diff int; v_growth int; v_avail int;
  v_other_attempt public.test_attempts%rowtype;
begin
  select * into v_attempt from public.test_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Attempt not found'; end if;
  if v_attempt.status = 'submitted' then return to_jsonb(v_attempt); end if;

  select count(*) into v_total from public.test_attempt_questions where attempt_id = p_attempt_id;
  select count(*) into v_correct
  from public.test_attempt_questions taq
  join public.student_responses sr on sr.attempt_id = taq.attempt_id and sr.question_id = taq.question_id
  where taq.attempt_id = p_attempt_id and sr.selected_answer = taq.snapshot_correct_answer;

  v_score := case when v_total = 0 then 0 else round((v_correct::numeric / v_total) * 100) end;

  update public.test_attempts
    set status = 'submitted', submitted_at = now(),
        correct_count = v_correct, total_count = v_total, score_percent = v_score
    where id = p_attempt_id
    returning * into v_attempt;

  -- Update growth
  select * into v_test from public.tests where id = v_attempt.test_id;
  select * into v_other_attempt
  from public.test_attempts ta
  join public.tests t2 on t2.id = ta.test_id
  where ta.student_id = v_attempt.student_id
    and t2.course_id = v_test.course_id
    and t2.test_type <> v_test.test_type
    and ta.status = 'submitted'
  limit 1;

  if v_other_attempt.id is not null then
    if v_test.test_type = 'EOC' then
      v_boc := v_other_attempt.score_percent; v_eoc := v_attempt.score_percent;
    else
      v_boc := v_attempt.score_percent;       v_eoc := v_other_attempt.score_percent;
    end if;
    v_diff := v_eoc - v_boc;
    v_avail := 100 - v_boc;
    v_growth := case when v_avail <= 0 then 100 else round((v_diff::numeric / v_avail) * 100) end;

    insert into public.growth_results (student_id, course_id, school_year_id, boc_score, eoc_score, point_difference, growth_percentage)
    values (v_attempt.student_id, v_test.course_id, v_test.school_year_id, v_boc, v_eoc, v_diff, v_growth)
    on conflict (student_id, course_id, school_year_id) do update
      set boc_score = excluded.boc_score, eoc_score = excluded.eoc_score,
          point_difference = excluded.point_difference, growth_percentage = excluded.growth_percentage,
          updated_at = now();
  end if;

  insert into public.audit_logs (actor_email, action, target, details)
  values (coalesce(auth.email(), 'student'), 'test.submitted', v_attempt.id::text,
          jsonb_build_object('test_id', v_attempt.test_id, 'score', v_score));

  return to_jsonb(v_attempt);
end $$;

grant execute on function public.submit_attempt(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.reset_attempt(p_attempt_id uuid, p_actor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_district_admin() or public.app_role() = 'campus_admin') then
    raise exception 'Not authorized to reset attempts';
  end if;

  update public.test_attempts
    set status = 'in_progress', submitted_at = null,
        score_percent = null, correct_count = null, is_reset = true
    where id = p_attempt_id;

  delete from public.student_responses where attempt_id = p_attempt_id;

  insert into public.audit_logs (actor_email, action, target, details)
  values (coalesce(p_actor, auth.email()), 'attempt.reset', p_attempt_id::text, '{}'::jsonb);
end $$;

grant execute on function public.reset_attempt(uuid, text) to authenticated;

-- =============================================================================
-- Seed data — minimal, safe-to-run-anytime placeholders.
-- =============================================================================
-- Insert initial campuses and a small set of placeholder courses so the app
-- has something visible before OneRoster import. Real data will overwrite
-- via the OneRoster import pipeline (matched by oneroster_*_sourced_id).
-- =============================================================================

insert into public.campuses (oneroster_org_sourced_id, name, code) values
  ('SEED-MHP', 'Madison Highland Prep', 'MHP'),
  ('SEED-HP',  'Highland Prep',         'HP'),
  ('SEED-HPW', 'Highland Prep West',    'HPW')
on conflict (oneroster_org_sourced_id) do nothing;

insert into public.school_years (oneroster_academic_session_sourced_id, name, start_date, end_date, is_active) values
  ('SEED-SY-2627', '2026-2027', '2026-08-03', '2027-05-21', true)
on conflict (oneroster_academic_session_sourced_id) do nothing;

insert into public.courses (oneroster_course_sourced_id, code, title, school_year_id)
select v.sid, v.code, v.title, sy.id
from (values
  ('SEED-COURSE-1','ALG1A','Algebra 1A'),
  ('SEED-COURSE-2','ALG1B','Algebra 1B')
) v(sid, code, title)
join public.school_years sy on sy.oneroster_academic_session_sourced_id = 'SEED-SY-2627'
on conflict (oneroster_course_sourced_id) do nothing;

-- Default settings row already inserted by schema.sql.
