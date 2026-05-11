-- =============================================================================
-- HPA -- Patch for P2 Waiting Room: add 'waiting' to attempt_status enum
-- =============================================================================
-- The original p2_waiting_room.sql function inserts status='waiting' when a
-- session is in the waiting room, but the attempt_status enum was only:
--   ('in_progress','submitted','reset')
-- so the insert errored with:
--   "column status is of type attempt_status but expression is of type text"
-- This patch (a) adds the missing enum value, and (b) re-creates the
-- redeem_test_code function with an explicit ::attempt_status cast for safety.
-- Idempotent.
-- =============================================================================

-- 1) Add 'waiting' to the enum if not present
alter type attempt_status add value if not exists 'waiting';

-- 2) Re-create redeem_test_code with an explicit cast on the status column
create or replace function public.redeem_test_code(
  p_code text, p_student_db_id uuid, p_test_id uuid, p_section_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_normalized text := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  v_code public.test_codes%rowtype;
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_session public.test_sessions%rowtype;
  v_attempt public.test_attempts%rowtype;
  v_phase test_phase_enum;
  v_question_ids uuid[];
  v_new_secret uuid;
  v_total int;
  v_test public.tests%rowtype;
  v_initial_status attempt_status;
begin
  if length(v_normalized) = 0 then
    raise exception 'Please enter the test code from your teacher.' using errcode = '22023';
  end if;

  select * into v_code from public.test_codes
   where upper(code) = v_normalized
     and is_active = true
     and test_id = p_test_id
     and valid_on_date = v_today
     and (for_student_id is null or for_student_id = p_student_db_id)
     and (for_student_id is null or used_at is null)
   order by created_at desc limit 1;

  if not found then
    raise exception 'That test code is not valid for today. Ask your teacher to confirm the code, or for a fresh one.'
      using errcode = '22023';
  end if;

  if v_code.for_student_id is not null and coalesce(v_code.bypass_waiting_room, false) = true then
    update public.test_codes set used_at = now(), used_by_student_id = p_student_db_id
      where id = v_code.id;
    return public.start_or_get_attempt(p_student_db_id, p_test_id, p_section_id);
  end if;

  select * into v_test from public.tests where id = p_test_id;
  if v_test.eoc_opens_at is not null and v_test.eoc_closes_at is not null
     and v_today between v_test.eoc_opens_at and v_test.eoc_closes_at then
    v_phase := 'EOC';
  elsif v_test.boc_opens_at is not null and v_test.boc_closes_at is not null
     and v_today between v_test.boc_opens_at and v_test.boc_closes_at then
    v_phase := 'BOC';
  elsif v_test.test_type is not null then
    v_phase := (v_test.test_type::text)::test_phase_enum;
  else
    raise exception 'Test is not currently in a BOC or EOC window.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.student_enrollments se
      join public.course_sections cs on cs.id = se.course_section_id
     where se.student_id = p_student_db_id and se.status = 'active'
       and (cs.course_id = v_test.course_id
         or cs.course_id in (select course_id from public.test_courses where test_id = v_test.id))
  ) then
    raise exception 'You are not enrolled in this course.' using errcode = '22023';
  end if;

  select * into v_session from public.test_sessions
    where test_id = p_test_id and course_section_id = p_section_id and phase = v_phase
      and status <> 'ended'
    order by created_at desc limit 1;
  if not found then
    insert into public.test_sessions (test_id, course_section_id, phase, status)
    values (p_test_id, p_section_id, v_phase, 'waiting')
    returning * into v_session;
  end if;

  if v_session.status = 'ended' then
    raise exception 'This testing session has ended.' using errcode = '22023';
  end if;

  if v_code.for_student_id is not null then
    update public.test_codes set used_at = now(), used_by_student_id = p_student_db_id
      where id = v_code.id;
  end if;

  -- Explicit cast: attempt_status enum now includes 'waiting'
  v_initial_status := case when v_session.status = 'running'
                            then 'in_progress'::attempt_status
                            else 'waiting'::attempt_status end;

  select * into v_attempt from public.test_attempts
   where student_id = p_student_db_id and test_id = p_test_id
     and coalesce(phase, 'BOC'::test_phase_enum) = v_phase;

  if found then
    if v_attempt.is_paused then
      raise exception 'Your test was paused by your teacher. Ask for a make-up code.' using errcode = '22023';
    end if;
    if v_attempt.status = 'submitted' then
      raise exception 'You already submitted this test.' using errcode = '22023';
    end if;

    if not exists (select 1 from public.test_attempt_questions where attempt_id = v_attempt.id) then
      select array_agg(q.id order by random()) into v_question_ids
        from public.questions q where q.test_id = p_test_id and q.is_active = true;
      if v_question_ids is null then
        raise exception 'No questions have been imported for this test yet.' using errcode = '22023';
      end if;
      insert into public.test_attempt_questions (attempt_id, question_id, display_order, snapshot_image_url, snapshot_correct_answer)
      select v_attempt.id, q.id, qno.idx, q.image_url, q.correct_answer
        from unnest(v_question_ids) with ordinality qno(qid, idx)
        join public.questions q on q.id = qno.qid;
      update public.test_attempts set question_order = v_question_ids,
        total_count = array_length(v_question_ids, 1) where id = v_attempt.id;
    end if;

    if v_attempt.session_id is null then
      update public.test_attempts set session_id = v_session.id where id = v_attempt.id
        returning * into v_attempt;
    end if;

    if v_session.status = 'running' and v_attempt.status = 'waiting' then
      update public.test_attempts
         set status = 'in_progress'::attempt_status,
             started_at = coalesce(started_at, now())
       where id = v_attempt.id returning * into v_attempt;
    end if;

    v_new_secret := gen_random_uuid();
    update public.test_attempts set session_secret = v_new_secret
      where id = v_attempt.id returning * into v_attempt;
    return (to_jsonb(v_attempt) - 'session_secret') || jsonb_build_object('session_secret', v_new_secret);
  end if;

  select array_agg(q.id order by random()) into v_question_ids
    from public.questions q where q.test_id = p_test_id and q.is_active = true;
  if v_question_ids is null then
    raise exception 'No questions have been imported for this test yet.' using errcode = '22023';
  end if;
  v_total := array_length(v_question_ids, 1);
  v_new_secret := gen_random_uuid();

  insert into public.test_attempts (
    student_id, test_id, course_section_id, phase, session_id,
    status, started_at, question_order, total_count, session_secret
  ) values (
    p_student_db_id, p_test_id, p_section_id, v_phase, v_session.id,
    v_initial_status,
    case when v_initial_status = 'in_progress'::attempt_status then now() else null end,
    v_question_ids, v_total, v_new_secret
  ) returning * into v_attempt;

  insert into public.test_attempt_questions (attempt_id, question_id, display_order, snapshot_image_url, snapshot_correct_answer)
  select v_attempt.id, q.id, qno.idx, q.image_url, q.correct_answer
    from unnest(v_question_ids) with ordinality qno(qid, idx)
    join public.questions q on q.id = qno.qid;

  return (to_jsonb(v_attempt) - 'session_secret') || jsonb_build_object('session_secret', v_new_secret);
end $$;
revoke all on function public.redeem_test_code(text, uuid, uuid, uuid) from public;
grant execute on function public.redeem_test_code(text, uuid, uuid, uuid) to anon, authenticated;

select 'P2 enum patch applied -- attempt_status now includes ''waiting''' as status;
