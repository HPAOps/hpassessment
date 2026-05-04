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
