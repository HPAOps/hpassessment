-- =============================================================================
-- HPA -- Final fix for student-side RPCs (v2 schema)
--
-- Replaces both `student_open_tests` and `start_or_get_attempt`. Three bugs
-- were stacked here:
--
--   1. `student_open_tests` filtered on the legacy `tests.opens_at` /
--      `closes_at` columns, missing every test created via the v2 form.
--   2. `start_or_get_attempt` enforced enrollment via the legacy
--      `tests.course_id` single-pointer, missing students whose section's
--      course is one of the multi-course `test_courses` links.
--   3. `start_or_get_attempt` skipped the INSERT into
--      `test_attempt_questions`, so even when an attempt was created the
--      `get_student_attempt` JOIN returned zero questions ("Question 1 of 0").
--
-- Idempotent. Safe to re-run.
-- =============================================================================

-- 1) student_open_tests -- v2-aware
create or replace function public.student_open_tests(p_course_id uuid)
returns jsonb
language sql security definer set search_path = public as $$
  with linked as (
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
       and boc_opens_at is not null and boc_closes_at is not null
       and current_date between boc_opens_at and boc_closes_at
    union all
    select id, name, question_count,
           'EOC'::text as phase,
           eoc_opens_at as opens_at, eoc_closes_at as closes_at
      from linked
     where is_published = true
       and eoc_opens_at is not null and eoc_closes_at is not null
       and current_date between eoc_opens_at and eoc_closes_at
    union all
    -- Legacy single-window tests (pre-v2). Kept for backward compat.
    select id, name, question_count,
           coalesce(test_type::text, 'BOC') as phase,
           opens_at, closes_at
      from linked
     where is_published = true
       and test_type is not null
       and (boc_opens_at is null and eoc_opens_at is null)
       and (opens_at  is null or opens_at  <= current_date)
       and (closes_at is null or closes_at >= current_date)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name,
    'phase', phase, 'test_type', phase,
    'question_count', question_count,
    'opens_at', opens_at, 'closes_at', closes_at
  ) order by name, phase), '[]'::jsonb)
    from windows;
$$;
revoke all on function public.student_open_tests(uuid) from public;
grant execute on function public.student_open_tests(uuid) to anon, authenticated;

-- 2) start_or_get_attempt -- multi-course enrollment + populates TAQ
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
  v_total int;
begin
  select * into v_test from public.tests where id = p_test_id;
  if not found then
    raise exception 'Test not found' using errcode = '42501';
  end if;

  -- Multi-course enrollment check: section.course_id must match the test's
  -- legacy single-pointer course_id OR appear in test_courses.
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

  -- Determine the active phase from configured windows (EOC wins on overlap).
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

  -- Existing attempt for this student+test+phase? Return it (issue a fresh
  -- session secret only if the prior one is null, which can happen after a
  -- previous broken run).
  select * into v_attempt
    from public.test_attempts
   where student_id = p_student_db_id
     and test_id    = p_test_id
     and coalesce(phase, 'BOC'::test_phase_enum) = v_phase;

  if found then
    -- If the existing attempt has zero linked questions (because an earlier
    -- broken RPC version created it), repair it in place rather than serving
    -- the student an empty test.
    if not exists (
      select 1 from public.test_attempt_questions where attempt_id = v_attempt.id
    ) then
      select array_agg(q.id order by random())
        into v_question_ids
        from public.questions q
       where q.test_id = p_test_id and q.is_active = true;

      if v_question_ids is null or array_length(v_question_ids, 1) is null then
        raise exception 'No questions have been imported for this test yet.'
          using errcode = '42501';
      end if;

      update public.test_attempts
         set question_order = v_question_ids,
             total_count = array_length(v_question_ids, 1),
             session_secret = coalesce(v_attempt.session_secret, gen_random_uuid())
       where id = v_attempt.id
       returning * into v_attempt;

      insert into public.test_attempt_questions (
        attempt_id, question_id, display_order, snapshot_image_url, snapshot_correct_answer
      )
      select v_attempt.id, q.id, qno.idx, q.image_url, q.correct_answer
        from unnest(v_question_ids) with ordinality qno(qid, idx)
        join public.questions q on q.id = qno.qid;
    end if;

    v_payload := to_jsonb(v_attempt) - 'session_secret';
    v_payload := v_payload || jsonb_build_object('session_secret', v_attempt.session_secret);
    return v_payload;
  end if;

  -- Fresh attempt
  select array_agg(q.id order by random())
    into v_question_ids
    from public.questions q
   where q.test_id = p_test_id and q.is_active = true;

  if v_question_ids is null or array_length(v_question_ids, 1) is null then
    raise exception 'No questions have been imported for this test yet.'
      using errcode = '42501';
  end if;

  v_total := array_length(v_question_ids, 1);
  v_new_secret := gen_random_uuid();

  insert into public.test_attempts (
    student_id, test_id, course_section_id, phase,
    status, question_order, total_count, session_secret
  )
  values (
    p_student_db_id, p_test_id, p_section_id, v_phase,
    'in_progress', v_question_ids, v_total, v_new_secret
  )
  returning * into v_attempt;

  insert into public.test_attempt_questions (
    attempt_id, question_id, display_order, snapshot_image_url, snapshot_correct_answer
  )
  select v_attempt.id, q.id, qno.idx, q.image_url, q.correct_answer
    from unnest(v_question_ids) with ordinality qno(qid, idx)
    join public.questions q on q.id = qno.qid;

  v_payload := to_jsonb(v_attempt) - 'session_secret';
  v_payload := v_payload || jsonb_build_object('session_secret', v_new_secret);
  return v_payload;
end;
$$;
revoke all on function public.start_or_get_attempt(uuid, uuid, uuid) from public;
grant execute on function public.start_or_get_attempt(uuid, uuid, uuid) to anon, authenticated;

-- 3) Backfill: any in-progress attempts that exist with non-empty
--    question_order but ZERO test_attempt_questions rows are leftovers from
--    earlier broken RPC runs. Backfill TAQ from the question_order so the
--    student can resume the same attempt without losing it.
insert into public.test_attempt_questions (
  attempt_id, question_id, display_order, snapshot_image_url, snapshot_correct_answer
)
select ta.id, q.id, qno.idx, q.image_url, q.correct_answer
  from public.test_attempts ta
  cross join lateral unnest(ta.question_order) with ordinality qno(qid, idx)
  join public.questions q on q.id = qno.qid
 where ta.status = 'in_progress'
   and array_length(ta.question_order, 1) is not null
   and not exists (
     select 1 from public.test_attempt_questions taq where taq.attempt_id = ta.id
   );

-- 4) Diagnostic: report state after running this script.
select
  'student RPCs patched (multi-course, BOC/EOC, TAQ populated) + backfilled' as status,
  (select count(*) from public.test_attempts where status = 'in_progress'
      and not exists (select 1 from public.test_attempt_questions where attempt_id = test_attempts.id))
    as still_empty_attempts,
  (select count(*) from public.tests t where not exists (select 1 from public.questions q where q.test_id = t.id))
    as tests_with_no_questions;
