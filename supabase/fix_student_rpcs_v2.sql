-- =============================================================================
-- HPA -- Fix student-side RPCs for v2 schema (multi-course test_courses join +
--        BOC/EOC date windows). Run as super_admin (idempotent).
--
-- Problem:
--   * student_open_tests() filtered on the legacy single-pointer
--     `tests.course_id` AND on the legacy `t.opens_at` / `t.closes_at` columns.
--     Tests created via the v2 form only set `boc_opens_at` / `eoc_opens_at`,
--     so the function returned an empty list even when the window was open.
--   * start_or_get_attempt() also enforced enrollment via the legacy
--     `t.course_id`, so even after a test showed up on the selector, kicking
--     off an attempt would 401 with "Student not enrolled" if the student's
--     section happened to live under a different copy of the same course.
--
-- Fix: both RPCs now match a test against a course via the `test_courses`
-- join table (with a fallback to `tests.course_id` for any legacy rows that
-- predate the v2 simplifications).
-- =============================================================================

-- 1) student_open_tests -- v2-aware. Returns one row per (test, currently-open
--    phase). If a test has both BOC and EOC windows open right now (rare but
--    defensive), both phases are emitted so the student sees them as separate
--    entries on the selector.
create or replace function public.student_open_tests(p_course_id uuid)
returns jsonb
language sql security definer set search_path = public as $$
  with linked as (
    -- Tests linked to this course via the new join table OR via the legacy
    -- single-pointer course_id (for any tests created before v2).
    select t.* from public.tests t
      join public.test_courses tc on tc.test_id = t.id
     where tc.course_id = p_course_id
    union
    select t.* from public.tests t
     where t.course_id = p_course_id
  ),
  windows as (
    select id, name, question_count,
           'BOC'::text as phase,
           boc_opens_at as opens_at, boc_closes_at as closes_at
      from linked
     where is_published = true
       and boc_opens_at is not null
       and boc_closes_at is not null
       and current_date between boc_opens_at and boc_closes_at
    union all
    select id, name, question_count,
           'EOC'::text as phase,
           eoc_opens_at as opens_at, eoc_closes_at as closes_at
      from linked
     where is_published = true
       and eoc_opens_at is not null
       and eoc_closes_at is not null
       and current_date between eoc_opens_at and eoc_closes_at
    union all
    -- Legacy single-window tests (test_type + opens_at/closes_at), kept so
    -- pre-v2 data still works after this migration is applied.
    select id, name, question_count,
           coalesce(test_type::text, 'BOC') as phase,
           opens_at, closes_at
      from linked
     where is_published = true
       and test_type is not null
       and (boc_opens_at is null and eoc_opens_at is null)
       and (opens_at is null or opens_at <= current_date)
       and (closes_at is null or closes_at >= current_date)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'name', name,
    'phase', phase,
    'test_type', phase,                     -- kept for the older client field
    'question_count', question_count,
    'opens_at', opens_at,
    'closes_at', closes_at
  ) order by name, phase), '[]'::jsonb)
    from windows;
$$;

revoke all on function public.student_open_tests(uuid) from public;
grant execute on function public.student_open_tests(uuid) to anon, authenticated;

-- 2) start_or_get_attempt -- swap the enrollment check to also use test_courses.
--    (Phase detection logic is unchanged from v2_simplifications.sql.)
create or replace function public.start_or_get_attempt(
  p_student_db_id uuid, p_test_id uuid, p_section_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_test public.tests%rowtype;
  v_attempt public.test_attempts%rowtype;
  v_phase test_phase_enum;
  v_question_ids uuid[];
  v_new_secret uuid;
  v_payload jsonb;
  v_today date := current_date;
begin
  -- Verify test exists
  select * into v_test from public.tests where id = p_test_id;
  if not found then
    raise exception 'Test not found' using errcode = '42501';
  end if;

  -- Verify enrollment: the student must be enrolled in a section whose course
  -- is one of the test's linked courses (test_courses join), OR matches the
  -- legacy single-pointer tests.course_id.
  if not exists (
    select 1
      from public.student_enrollments se
      join public.course_sections cs on cs.id = se.course_section_id
     where se.student_id = p_student_db_id
       and se.status = 'active'
       and (
            cs.course_id = v_test.course_id
         or cs.course_id in (select course_id from public.test_courses where test_id = v_test.id)
       )
  ) then
    raise exception 'Student not enrolled in the course for this test.'
      using errcode = '42501';
  end if;

  -- Determine phase from current date and configured windows. Prefer EOC if
  -- both windows happen to overlap (rare).
  if v_test.eoc_opens_at is not null and v_test.eoc_closes_at is not null
     and v_today between v_test.eoc_opens_at and v_test.eoc_closes_at then
    v_phase := 'EOC';
  elsif v_test.boc_opens_at is not null and v_test.boc_closes_at is not null
     and v_today between v_test.boc_opens_at and v_test.boc_closes_at then
    v_phase := 'BOC';
  elsif v_test.test_type is not null then
    v_phase := (v_test.test_type::text)::test_phase_enum;
  else
    raise exception 'Test is not currently in a BOC or EOC window.'
      using errcode = '42501';
  end if;

  -- Look for an existing attempt for this student+test+phase
  select * into v_attempt
    from public.test_attempts
   where student_id = p_student_db_id
     and test_id    = p_test_id
     and coalesce(phase, 'BOC'::test_phase_enum) = v_phase;

  if found then
    v_payload := to_jsonb(v_attempt) - 'session_secret';
    v_payload := v_payload || jsonb_build_object('session_secret', null);
    return v_payload;
  end if;

  -- Create a fresh attempt with randomized question order
  select array_agg(q.id order by random())
    into v_question_ids
    from public.questions q
   where q.test_id = p_test_id and q.is_active = true;

  v_new_secret := gen_random_uuid();

  insert into public.test_attempts (
    student_id, test_id, course_section_id, phase,
    status, question_order, responses, session_secret
  )
  values (
    p_student_db_id, p_test_id, p_section_id, v_phase,
    'in_progress', coalesce(v_question_ids, '{}'::uuid[]), '{}'::jsonb, v_new_secret
  )
  returning * into v_attempt;

  v_payload := to_jsonb(v_attempt) - 'session_secret';
  v_payload := v_payload || jsonb_build_object('session_secret', v_new_secret);
  return v_payload;
end;
$$;

revoke all on function public.start_or_get_attempt(uuid, uuid, uuid) from public;
grant execute on function public.start_or_get_attempt(uuid, uuid, uuid) to anon, authenticated;

select 'student RPCs patched for v2 (test_courses + BOC/EOC windows)' as status;
