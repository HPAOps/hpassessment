-- =============================================================================
-- HPA -- P2 Waiting Room + Live Proctor + Pause/End controls
-- =============================================================================
-- One test_session row per (test, course_section, phase) at a time. While
-- status='waiting', students who redeem the code land in a waiting state.
-- Teacher clicks Start -> session 'running', all waiting attempts flip to
-- in_progress simultaneously. Teacher can Pause an individual student
-- (locks them out; they need a make-up code on a different day) or End the
-- whole test (auto-submits everyone still in progress).
--
-- Idempotent.
-- =============================================================================

-- 1) Schema -----------------------------------------------------------------
-- Add 'waiting' to attempt_status enum if missing (idempotent, safe to re-run).
-- Required because new attempts start in 'waiting' state before the teacher
-- clicks Start.
alter type attempt_status add value if not exists 'waiting';

create table if not exists public.test_sessions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  course_section_id uuid not null references public.course_sections(id) on delete cascade,
  phase test_phase_enum not null,
  proctor_email text,
  status text not null default 'waiting' check (status in ('waiting','running','ended')),
  created_at timestamptz default now(),
  started_at timestamptz null,
  ended_at timestamptz null
);
-- One non-ended session per (test, section, phase)
create unique index if not exists test_sessions_one_active
  on public.test_sessions (test_id, course_section_id, phase)
  where status <> 'ended';

alter table public.test_sessions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='test_sessions' and policyname='test_sessions_staff_read') then
    create policy test_sessions_staff_read on public.test_sessions
      for select to authenticated
      using (exists (select 1 from public.profiles where id = auth.uid()
                       and role in ('super_admin','district_admin','campus_admin','teacher')));
  end if;
end $$;

alter table public.test_attempts
  add column if not exists session_id uuid null references public.test_sessions(id) on delete set null,
  add column if not exists is_paused boolean not null default false,
  add column if not exists paused_at timestamptz null,
  add column if not exists paused_reason text null,
  add column if not exists current_question_index int default 0;

create index if not exists test_attempts_session_idx on public.test_attempts (session_id);

-- 2) redeem_test_code -- now session-aware ----------------------------------
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

  -- Bypass-waiting-room codes (1:1 admin make-ups): consume + skip session.
  if v_code.for_student_id is not null and coalesce(v_code.bypass_waiting_room, false) = true then
    update public.test_codes set used_at = now(), used_by_student_id = p_student_db_id
      where id = v_code.id;
    return public.start_or_get_attempt(p_student_db_id, p_test_id, p_section_id);
  end if;

  -- Determine phase from windows
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

  -- Verify enrollment
  if not exists (
    select 1 from public.student_enrollments se
      join public.course_sections cs on cs.id = se.course_section_id
     where se.student_id = p_student_db_id and se.status = 'active'
       and (cs.course_id = v_test.course_id
         or cs.course_id in (select course_id from public.test_courses where test_id = v_test.id))
  ) then
    raise exception 'You are not enrolled in this course.' using errcode = '22023';
  end if;

  -- Find or create the active session for this (test, section, phase)
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

  -- Consume make-up codes
  if v_code.for_student_id is not null then
    update public.test_codes set used_at = now(), used_by_student_id = p_student_db_id
      where id = v_code.id;
  end if;

  -- New attempts inherit the session's current state.
  v_initial_status := case when v_session.status = 'running'
                            then 'in_progress'::attempt_status
                            else 'waiting'::attempt_status end;

  -- Existing attempt for this (student, test, phase)?
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

    -- Backfill TAQ if missing (defensive)
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

    -- Link to session if not yet
    if v_attempt.session_id is null then
      update public.test_attempts set session_id = v_session.id where id = v_attempt.id
        returning * into v_attempt;
    end if;

    -- Ensure status matches session state (e.g. student rejoined after teacher started)
    if v_session.status = 'running' and v_attempt.status = 'waiting' then
      update public.test_attempts set status = 'in_progress'::attempt_status, started_at = coalesce(started_at, now())
        where id = v_attempt.id returning * into v_attempt;
    end if;

    v_new_secret := gen_random_uuid();
    update public.test_attempts set session_secret = v_new_secret
      where id = v_attempt.id returning * into v_attempt;
    return (to_jsonb(v_attempt) - 'session_secret') || jsonb_build_object('session_secret', v_new_secret);
  end if;

  -- Fresh attempt
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

-- 3) save_response -- reject when paused -----------------------------------
create or replace function public.save_response(
  p_attempt_id uuid, p_question_id uuid, p_answer answer_letter, p_session_secret uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
        v_q_idx int;
begin
  if p_session_secret is null then
    raise exception 'Missing session secret' using errcode = '42501';
  end if;
  select (ta.session_secret = p_session_secret
          and ta.status = 'in_progress' and ta.is_paused = false
          and exists (select 1 from public.test_attempt_questions taq
                      where taq.attempt_id = ta.id and taq.question_id = p_question_id))
    into v_ok
  from public.test_attempts ta where ta.id = p_attempt_id;
  if not coalesce(v_ok, false) then
    raise exception 'Invalid session, attempt paused, or attempt not in progress'
      using errcode = '42501';
  end if;

  insert into public.student_responses (attempt_id, question_id, selected_answer)
  values (p_attempt_id, p_question_id, p_answer)
  on conflict (attempt_id, question_id)
    do update set selected_answer = excluded.selected_answer, responded_at = now();

  -- Track progress: how many distinct questions answered so far
  select count(*) into v_q_idx from public.student_responses where attempt_id = p_attempt_id;
  update public.test_attempts set current_question_index = v_q_idx where id = p_attempt_id;
end $$;
revoke all on function public.save_response(uuid, uuid, answer_letter, uuid) from public;
grant execute on function public.save_response(uuid, uuid, answer_letter, uuid) to anon, authenticated;

-- 4) Internal scorer used by submit_attempt + teacher_end_session ---------
create or replace function public._internal_score_and_submit(p_attempt_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_correct int := 0; v_total int := 0; v_score int := 0;
  v_test public.tests%rowtype;
  v_other_attempt public.test_attempts%rowtype;
  v_boc int; v_eoc int; v_diff int; v_growth int; v_avail int;
begin
  select * into v_attempt from public.test_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status = 'submitted' then return; end if;

  select count(*) into v_total from public.test_attempt_questions where attempt_id = p_attempt_id;
  select count(*) into v_correct
    from public.test_attempt_questions taq
    join public.student_responses sr on sr.attempt_id = taq.attempt_id and sr.question_id = taq.question_id
   where taq.attempt_id = p_attempt_id and sr.selected_answer = taq.snapshot_correct_answer;
  v_score := case when v_total = 0 then 0 else round((v_correct::numeric / v_total) * 100) end;

  update public.test_attempts
     set status = 'submitted', submitted_at = now(),
         correct_count = v_correct, total_count = v_total, score_percent = v_score,
         session_secret = null
   where id = p_attempt_id returning * into v_attempt;

  -- Compute growth if both BOC + EOC exist
  select * into v_test from public.tests where id = v_attempt.test_id;
  select * into v_other_attempt from public.test_attempts ta
    join public.tests t2 on t2.id = ta.test_id
    where ta.student_id = v_attempt.student_id
      and t2.course_id = v_test.course_id
      and t2.test_type <> v_test.test_type
      and ta.status = 'submitted' limit 1;

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
end $$;

-- 5) Teacher session RPCs --------------------------------------------------
create or replace function public.teacher_get_or_create_session(
  p_test_id uuid, p_section_id uuid, p_phase text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_phase test_phase_enum := p_phase::test_phase_enum;
  v_session public.test_sessions%rowtype;
  v_email text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()
      and role in ('super_admin','district_admin','campus_admin','teacher')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_email := (select email from auth.users where id = auth.uid());

  select * into v_session from public.test_sessions
    where test_id = p_test_id and course_section_id = p_section_id and phase = v_phase
      and status <> 'ended'
    order by created_at desc limit 1;
  if found then
    if v_session.proctor_email is null then
      update public.test_sessions set proctor_email = v_email where id = v_session.id;
    end if;
    return to_jsonb(v_session);
  end if;
  insert into public.test_sessions (test_id, course_section_id, phase, status, proctor_email)
  values (p_test_id, p_section_id, v_phase, 'waiting', v_email)
  returning * into v_session;
  return to_jsonb(v_session);
end $$;
revoke all on function public.teacher_get_or_create_session(uuid, uuid, text) from public;
grant execute on function public.teacher_get_or_create_session(uuid, uuid, text) to authenticated;

create or replace function public.teacher_session_state(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session public.test_sessions%rowtype;
  v_attempts jsonb;
  v_roster jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()
      and role in ('super_admin','district_admin','campus_admin','teacher')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_session from public.test_sessions where id = p_session_id;
  if not found then raise exception 'Session not found' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ta.id, 'student_db_id', s.id,
    'status', ta.status, 'is_paused', ta.is_paused,
    'paused_at', ta.paused_at, 'paused_reason', ta.paused_reason,
    'current_question_index', ta.current_question_index,
    'total_count', ta.total_count,
    'submitted_at', ta.submitted_at,
    'correct_count', ta.correct_count, 'score_percent', ta.score_percent,
    'student', jsonb_build_object('id', s.id, 'first_name', s.first_name,
                                  'last_name', s.last_name, 'student_id', s.student_id)
  ) order by s.last_name nulls last, s.first_name nulls last), '[]'::jsonb)
  into v_attempts
  from public.test_attempts ta
  join public.students s on s.id = ta.student_id
  where ta.session_id = p_session_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'first_name', s.first_name,
    'last_name', s.last_name, 'student_id', s.student_id
  ) order by s.last_name nulls last, s.first_name nulls last), '[]'::jsonb)
  into v_roster
  from public.student_enrollments se
  join public.students s on s.id = se.student_id
  where se.course_section_id = v_session.course_section_id
    and se.status = 'active' and s.is_active = true
    and not exists (select 1 from public.test_attempts ta where ta.session_id = p_session_id and ta.student_id = s.id);

  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'attempts', v_attempts,
    'roster_not_joined', v_roster
  );
end $$;
revoke all on function public.teacher_session_state(uuid) from public;
grant execute on function public.teacher_session_state(uuid) to authenticated;

create or replace function public.teacher_start_session(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_session public.test_sessions%rowtype;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()
      and role in ('super_admin','district_admin','campus_admin','teacher')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.test_sessions
     set status = 'running', started_at = coalesce(started_at, now())
   where id = p_session_id and status = 'waiting'
   returning * into v_session;
  if not found then raise exception 'Session is not in waiting state.' using errcode = '22023'; end if;

  update public.test_attempts
     set status = 'in_progress', started_at = coalesce(started_at, now())
   where session_id = p_session_id and status = 'waiting' and is_paused = false;
  return to_jsonb(v_session);
end $$;
revoke all on function public.teacher_start_session(uuid) from public;
grant execute on function public.teacher_start_session(uuid) to authenticated;

create or replace function public.teacher_end_session(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session public.test_sessions%rowtype;
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()
      and role in ('super_admin','district_admin','campus_admin','teacher')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_session from public.test_sessions where id = p_session_id;
  if not found then raise exception 'Session not found' using errcode = '22023'; end if;
  if v_session.status = 'ended' then return to_jsonb(v_session); end if;

  -- Auto-submit all in-progress, non-paused attempts in this session
  for v_id in
    select id from public.test_attempts
     where session_id = p_session_id and status = 'in_progress' and is_paused = false
  loop
    perform public._internal_score_and_submit(v_id);
  end loop;

  -- Lock anyone still in 'waiting' state -- they didn't get to start in time.
  update public.test_attempts
     set status = 'submitted', submitted_at = now(), session_secret = null,
         correct_count = 0, score_percent = 0
   where session_id = p_session_id and status = 'waiting';

  update public.test_sessions
     set status = 'ended', ended_at = now()
   where id = p_session_id returning * into v_session;
  return to_jsonb(v_session);
end $$;
revoke all on function public.teacher_end_session(uuid) from public;
grant execute on function public.teacher_end_session(uuid) to authenticated;

create or replace function public.teacher_pause_attempt(
  p_attempt_id uuid, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_attempt public.test_attempts%rowtype;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()
      and role in ('super_admin','district_admin','campus_admin','teacher')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.test_attempts
     set is_paused = true, paused_at = now(), paused_reason = p_reason,
         session_secret = null
   where id = p_attempt_id and status in ('in_progress','waiting') and is_paused = false
   returning * into v_attempt;
  if not found then raise exception 'Cannot pause this attempt.' using errcode = '22023'; end if;
  return to_jsonb(v_attempt);
end $$;
revoke all on function public.teacher_pause_attempt(uuid, text) from public;
grant execute on function public.teacher_pause_attempt(uuid, text) to authenticated;

select 'P2 waiting room + proctor RPCs ready' as status;
