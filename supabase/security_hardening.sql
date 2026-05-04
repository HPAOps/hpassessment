-- =============================================================================
-- HPA — Security hardening (FERPA/integrity)
-- Run ONCE in the Supabase SQL editor. Idempotent.
-- =============================================================================
-- Fixes 3 vulnerabilities found by the security audit:
--
--   H1. reset_attempt could be called by anon and actually reset real test
--       attempts. Root cause: Postgres NULL semantics — NOT (false OR NULL) = NULL,
--       and IF NULL doesn't raise. Fixed with coalesce() + REVOKE from public/anon.
--
--   H2. save_response / submit_attempt accepted any attempt_id without proving
--       the caller had legitimately started that attempt. An attacker who knew
--       a Student ID (100001..) could derive the student UUID via student_lookup,
--       call start_or_get_attempt for them, then save / submit answers on their
--       behalf — even for another student's attempt.
--
--   H3. get_student_attempt previously only verified student_db_id matched; the
--       UUID is recoverable from student_lookup. Now also requires session_secret
--       so only the caller who started the attempt (and still has the secret in
--       their browser) can read the questions + prior responses.
--
-- Mechanism: each test attempt now carries a random session_secret (UUID).
--   * start_or_get_attempt issues & returns it ONCE at creation time.
--   * The React app stores it in localStorage alongside the attempt id.
--   * Every subsequent write/read RPC must present the same secret.
--   * Subsequent start_or_get calls (resume / refresh without localStorage)
--     will NOT re-issue the secret — user must contact an admin to reset.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column for per-attempt session secret
-- ---------------------------------------------------------------------------
alter table public.test_attempts
  add column if not exists session_secret uuid;

-- ---------------------------------------------------------------------------
-- 2. Fix reset_attempt — proper staff-only guard + revoke anon execute
-- ---------------------------------------------------------------------------
create or replace function public.reset_attempt(p_attempt_id uuid, p_actor text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  v_role := coalesce(public.app_role()::text, '');
  if v_role not in ('super_admin','district_admin','campus_admin') then
    raise exception 'Not authorized to reset attempts'
      using errcode = '42501';
  end if;

  update public.test_attempts
     set status = 'in_progress', submitted_at = null,
         score_percent = null, correct_count = null,
         is_reset = true, session_secret = null
   where id = p_attempt_id;

  delete from public.student_responses where attempt_id = p_attempt_id;

  insert into public.audit_logs (actor_email, action, target, details)
  values (coalesce(p_actor, auth.email()), 'attempt.reset',
          p_attempt_id::text, jsonb_build_object('by', auth.uid()));
end $$;

revoke all on function public.reset_attempt(uuid, text) from public;
revoke all on function public.reset_attempt(uuid, text) from anon;
grant execute on function public.reset_attempt(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. start_or_get_attempt — issue session_secret ONCE at creation
-- ---------------------------------------------------------------------------
create or replace function public.start_or_get_attempt(
  p_student_db_id uuid, p_test_id uuid, p_section_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_question_ids uuid[];
  v_new_secret uuid;
  v_payload jsonb;
begin
  if not exists (
    select 1 from public.student_enrollments se
    join public.tests t
      on t.course_id = (select course_id from public.course_sections where id = se.course_section_id)
    where se.student_id = p_student_db_id
      and t.id = p_test_id
      and se.status = 'active'
  ) then
    raise exception 'Student not enrolled in the course for this test.'
      using errcode = '42501';
  end if;

  select * into v_attempt
  from public.test_attempts
  where student_id = p_student_db_id and test_id = p_test_id;

  if found then
    -- Returning existing attempt: NEVER re-issue the secret.
    v_payload := to_jsonb(v_attempt) - 'session_secret';
    v_payload := v_payload || jsonb_build_object('session_secret', null);
    return v_payload;
  end if;

  v_new_secret := gen_random_uuid();
  select array_agg(id order by random()) into v_question_ids
  from public.questions where test_id = p_test_id and is_active = true;

  insert into public.test_attempts (
    student_id, test_id, course_section_id, question_order,
    status, total_count, session_secret
  ) values (
    p_student_db_id, p_test_id, p_section_id, v_question_ids,
    'in_progress', coalesce(array_length(v_question_ids, 1), 0), v_new_secret
  )
  returning * into v_attempt;

  insert into public.test_attempt_questions (
    attempt_id, question_id, display_order,
    snapshot_image_url, snapshot_correct_answer
  )
  select v_attempt.id, q.id, qno.idx, q.image_url, q.correct_answer
  from unnest(v_question_ids) with ordinality qno(qid, idx)
  join public.questions q on q.id = qno.qid;

  return to_jsonb(v_attempt);
end $$;

-- ---------------------------------------------------------------------------
-- 4. save_response — require matching session_secret + in_progress
-- ---------------------------------------------------------------------------
create or replace function public.save_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer answer_letter,
  p_session_secret uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if p_session_secret is null then
    raise exception 'Missing session secret' using errcode = '42501';
  end if;

  select (ta.session_secret = p_session_secret and ta.status = 'in_progress'
          and exists (select 1 from public.test_attempt_questions taq
                      where taq.attempt_id = ta.id and taq.question_id = p_question_id))
    into v_ok
  from public.test_attempts ta
  where ta.id = p_attempt_id;

  if not coalesce(v_ok, false) then
    raise exception 'Invalid session or attempt not in progress'
      using errcode = '42501';
  end if;

  insert into public.student_responses (attempt_id, question_id, selected_answer)
  values (p_attempt_id, p_question_id, p_answer)
  on conflict (attempt_id, question_id)
    do update set selected_answer = excluded.selected_answer,
                  responded_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- 5. submit_attempt — require matching session_secret
-- ---------------------------------------------------------------------------
create or replace function public.submit_attempt(p_attempt_id uuid, p_session_secret uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_correct int := 0; v_total int := 0; v_score int := 0;
  v_test public.tests%rowtype;
  v_boc int; v_eoc int; v_diff int; v_growth int; v_avail int;
  v_other_attempt public.test_attempts%rowtype;
begin
  if p_session_secret is null then
    raise exception 'Missing session secret' using errcode = '42501';
  end if;

  select * into v_attempt from public.test_attempts
  where id = p_attempt_id for update;

  if not found then raise exception 'Attempt not found'; end if;

  if v_attempt.session_secret is distinct from p_session_secret then
    raise exception 'Invalid session' using errcode = '42501';
  end if;

  if v_attempt.status = 'submitted' then
    return to_jsonb(v_attempt) - 'session_secret';
  end if;

  select count(*) into v_total from public.test_attempt_questions where attempt_id = p_attempt_id;
  select count(*) into v_correct
  from public.test_attempt_questions taq
  join public.student_responses sr
    on sr.attempt_id = taq.attempt_id and sr.question_id = taq.question_id
  where taq.attempt_id = p_attempt_id and sr.selected_answer = taq.snapshot_correct_answer;

  v_score := case when v_total = 0 then 0 else round((v_correct::numeric / v_total) * 100) end;

  update public.test_attempts
    set status = 'submitted', submitted_at = now(),
        correct_count = v_correct, total_count = v_total, score_percent = v_score,
        session_secret = null   -- invalidate session after submit
    where id = p_attempt_id
    returning * into v_attempt;

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
      v_boc := v_attempt.score_percent; v_eoc := v_other_attempt.score_percent;
    end if;
    v_diff := v_eoc - v_boc;
    v_avail := 100 - v_boc;
    v_growth := case when v_avail <= 0 then 100 else round((v_diff::numeric / v_avail) * 100) end;

    insert into public.growth_results (student_id, course_id, school_year_id,
                                       boc_score, eoc_score, point_difference, growth_percentage)
    values (v_attempt.student_id, v_test.course_id, v_test.school_year_id,
            v_boc, v_eoc, v_diff, v_growth)
    on conflict (student_id, course_id, school_year_id) do update
      set boc_score = excluded.boc_score, eoc_score = excluded.eoc_score,
          point_difference = excluded.point_difference,
          growth_percentage = excluded.growth_percentage,
          updated_at = now();
  end if;

  insert into public.audit_logs (actor_email, action, target, details)
  values (coalesce(auth.email(), 'student'), 'test.submitted',
          v_attempt.id::text,
          jsonb_build_object('test_id', v_attempt.test_id, 'score', v_score));

  return to_jsonb(v_attempt) - 'session_secret';
end $$;

-- ---------------------------------------------------------------------------
-- 6. get_student_attempt — require matching session_secret
-- ---------------------------------------------------------------------------
create or replace function public.get_student_attempt(
  p_attempt_id uuid, p_student_db_id uuid, p_session_secret uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_test public.tests%rowtype;
  v_questions jsonb;
  v_responses jsonb;
  v_is_staff boolean;
begin
  select * into v_attempt from public.test_attempts
  where id = p_attempt_id and student_id = p_student_db_id;
  if not found then raise exception 'Attempt not found.'; end if;

  -- Allow authenticated staff to read without a secret (they have RLS already).
  v_is_staff := coalesce(public.app_role()::text, '') in ('super_admin','district_admin','campus_admin','teacher');

  if not v_is_staff then
    -- Submitted attempts still readable for the submission-confirm screen only
    -- if the caller still has the secret stored before submit cleared it.
    -- Since submit clears session_secret, subsequent reads must rely on the
    -- confirmation screen using the payload submit_attempt already returned.
    if p_session_secret is null
       or v_attempt.session_secret is null
       or v_attempt.session_secret is distinct from p_session_secret then
      raise exception 'Invalid or expired session' using errcode = '42501';
    end if;
  end if;

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
    'attempt', to_jsonb(v_attempt) - 'session_secret',
    'test', jsonb_build_object('id', v_test.id, 'name', v_test.name, 'test_type', v_test.test_type),
    'questions', v_questions,
    'responses', v_responses
  );
end $$;

-- Drop old signature variants to avoid ambiguity
drop function if exists public.save_response(uuid, uuid, answer_letter);
drop function if exists public.submit_attempt(uuid);
drop function if exists public.get_student_attempt(uuid, uuid);

-- Re-grant on new signatures
revoke all on function public.save_response(uuid, uuid, answer_letter, uuid) from public;
revoke all on function public.submit_attempt(uuid, uuid) from public;
revoke all on function public.get_student_attempt(uuid, uuid, uuid) from public;
grant execute on function public.save_response(uuid, uuid, answer_letter, uuid) to anon, authenticated;
grant execute on function public.submit_attempt(uuid, uuid) to anon, authenticated;
grant execute on function public.get_student_attempt(uuid, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
select 'security hardening applied' as status;
