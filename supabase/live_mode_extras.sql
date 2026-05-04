-- =============================================================================
-- HPA — Student-side helper RPCs (live mode extras)
-- Run AFTER full_setup.sql and extended_seed.sql.
-- =============================================================================

-- 1) Tests open for a given course
create or replace function public.student_open_tests(p_course_id uuid)
returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'test_type', t.test_type,
    'question_count', t.question_count,
    'opens_at', t.opens_at, 'closes_at', t.closes_at
  )), '[]'::jsonb)
  from public.tests t
  where t.course_id = p_course_id
    and t.is_published = true
    and (t.opens_at is null or t.opens_at <= current_date)
    and (t.closes_at is null or t.closes_at >= current_date);
$$;
revoke all on function public.student_open_tests(uuid) from public;
grant execute on function public.student_open_tests(uuid) to anon, authenticated;

-- 2) A student's attempts
create or replace function public.student_attempts(p_student_db_id uuid)
returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'test_id', a.test_id,
    'status', a.status, 'score_percent', a.score_percent,
    'submitted_at', a.submitted_at
  )), '[]'::jsonb)
  from public.test_attempts a
  where a.student_id = p_student_db_id;
$$;
revoke all on function public.student_attempts(uuid) from public;
grant execute on function public.student_attempts(uuid) to anon, authenticated;

-- 3) Get attempt + questions (image only, no correct_answer leaked)
create or replace function public.get_student_attempt(p_attempt_id uuid, p_student_db_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_test public.tests%rowtype;
  v_questions jsonb;
  v_responses jsonb;
begin
  select * into v_attempt from public.test_attempts
  where id = p_attempt_id and student_id = p_student_db_id;
  if not found then raise exception 'Attempt not found.'; end if;

  select * into v_test from public.tests where id = v_attempt.test_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'question_number', q.question_number,
    'image_url', q.image_url, 'display_order', taq.display_order
  ) order by taq.display_order), '[]'::jsonb)
  into v_questions
  from public.test_attempt_questions taq
  join public.questions q on q.id = taq.question_id
  where taq.attempt_id = p_attempt_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'question_id', sr.question_id,
    'selected_answer', sr.selected_answer
  )), '[]'::jsonb)
  into v_responses
  from public.student_responses sr
  where sr.attempt_id = p_attempt_id;

  return jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'test', jsonb_build_object('id', v_test.id, 'name', v_test.name, 'test_type', v_test.test_type),
    'questions', v_questions,
    'responses', v_responses
  );
end $$;
revoke all on function public.get_student_attempt(uuid, uuid) from public;
grant execute on function public.get_student_attempt(uuid, uuid) to anon, authenticated;
