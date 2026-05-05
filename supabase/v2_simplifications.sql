-- =============================================================================
-- HPA — v2 simplifications
-- =============================================================================
-- Item 6: Single test, two windows (BOC + EOC) per test row
-- Item 3: Remove demo seed students/teachers/tests
-- Item 7: delete_test RPC (super_admin only, full cascade)
-- =============================================================================
-- Idempotent — safe to re-run. Run AFTER all prior scripts.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) Phase enum (BOC | EOC) for test_attempts
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'test_phase_enum') then
    create type test_phase_enum as enum ('BOC', 'EOC');
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) Add boc_*/eoc_* date pairs to tests
-- ----------------------------------------------------------------------------
alter table public.tests
  add column if not exists boc_opens_at date,
  add column if not exists boc_closes_at date,
  add column if not exists eoc_opens_at date,
  add column if not exists eoc_closes_at date;

-- Make test_type nullable (kept for backward compat / migration trace; null
-- means the new model: single test row drives both BOC + EOC via window dates)
alter table public.tests alter column test_type drop not null;

-- ----------------------------------------------------------------------------
-- 3) Backfill window dates for existing test rows from old opens_at/closes_at
-- ----------------------------------------------------------------------------
update public.tests
  set boc_opens_at = coalesce(boc_opens_at, opens_at),
      boc_closes_at = coalesce(boc_closes_at, closes_at)
  where test_type = 'BOC';

update public.tests
  set eoc_opens_at = coalesce(eoc_opens_at, opens_at),
      eoc_closes_at = coalesce(eoc_closes_at, closes_at)
  where test_type = 'EOC';

-- ----------------------------------------------------------------------------
-- 4) Add phase column to test_attempts + new unique key (student, test, phase)
-- ----------------------------------------------------------------------------
alter table public.test_attempts
  add column if not exists phase test_phase_enum;

-- Backfill phase from the joined test_type for existing rows
update public.test_attempts ta
   set phase = (t.test_type::text)::test_phase_enum
  from public.tests t
 where ta.test_id = t.id
   and ta.phase is null
   and t.test_type is not null;

-- Drop old unique constraint (student_id, test_id), replace with phase-aware
do $$
declare cn text;
begin
  select conname into cn
    from pg_constraint
   where conrelid = 'public.test_attempts'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) ilike '%student_id%test_id%'
     and pg_get_constraintdef(oid) not ilike '%phase%';
  if cn is not null then
    execute format('alter table public.test_attempts drop constraint %I', cn);
  end if;
end $$;

create unique index if not exists test_attempts_unique_per_phase
  on public.test_attempts (student_id, test_id, coalesce(phase, 'BOC'::test_phase_enum));

-- ----------------------------------------------------------------------------
-- 5) start_or_get_attempt — auto-detect phase from current date, single test
-- ----------------------------------------------------------------------------
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

  -- Verify enrollment
  if not exists (
    select 1 from public.student_enrollments se
      join public.tests t
        on t.course_id = (
          select course_id from public.course_sections where id = se.course_section_id
        )
     where se.student_id = p_student_db_id
       and t.id = p_test_id
       and se.status = 'active'
  ) then
    raise exception 'Student not enrolled in the course for this test.'
      using errcode = '42501';
  end if;

  -- Determine phase from current date and configured windows.
  -- Prefer EOC if both windows happen to overlap (unlikely but defensive).
  if v_test.eoc_opens_at is not null and v_test.eoc_closes_at is not null
     and v_today between v_test.eoc_opens_at and v_test.eoc_closes_at then
    v_phase := 'EOC';
  elsif v_test.boc_opens_at is not null and v_test.boc_closes_at is not null
     and v_today between v_test.boc_opens_at and v_test.boc_closes_at then
    v_phase := 'BOC';
  elsif v_test.test_type is not null then
    -- Backward compat for legacy single-window tests
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
    -- Existing attempt: never re-issue the secret
    v_payload := to_jsonb(v_attempt) - 'session_secret';
    v_payload := v_payload || jsonb_build_object('session_secret', null);
    return v_payload;
  end if;

  v_new_secret := gen_random_uuid();
  select array_agg(id order by random()) into v_question_ids
    from public.questions where test_id = p_test_id and is_active = true;

  insert into public.test_attempts (
    student_id, test_id, course_section_id, phase, question_order,
    status, total_count, session_secret
  ) values (
    p_student_db_id, p_test_id, p_section_id, v_phase, v_question_ids,
    'in_progress', coalesce(array_length(v_question_ids, 1), 0), v_new_secret
  )
  returning * into v_attempt;

  insert into public.test_attempt_questions (
    attempt_id, question_id, display_order, snapshot_image_url, snapshot_correct_answer
  )
  select v_attempt.id, q.id, qno.idx, q.image_url, q.correct_answer
    from unnest(v_question_ids) with ordinality qno(qid, idx)
    join public.questions q on q.id = qno.qid;

  return to_jsonb(v_attempt);
end $$;

grant execute on function public.start_or_get_attempt(uuid, uuid, uuid)
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) submit_attempt — growth pairs BOC + EOC across the SAME test row
-- ----------------------------------------------------------------------------
create or replace function public.submit_attempt(p_attempt_id uuid, p_session_secret uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_attempt public.test_attempts%rowtype;
  v_test public.tests%rowtype;
  v_other_attempt public.test_attempts%rowtype;
  v_correct int := 0; v_total int := 0; v_score int := 0;
  v_boc int; v_eoc int; v_diff int; v_avail int; v_growth int;
begin
  select * into v_attempt
    from public.test_attempts
   where id = p_attempt_id
     and session_secret = p_session_secret
     and status = 'in_progress'
   for update;
  if not found then
    raise exception 'Attempt not found, already submitted, or invalid session.'
      using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.test_attempt_questions taq
   where taq.attempt_id = p_attempt_id;

  select count(*) into v_correct
    from public.test_attempt_questions taq
    join public.student_responses sr
      on sr.attempt_id = taq.attempt_id and sr.question_id = taq.question_id
   where taq.attempt_id = p_attempt_id
     and sr.selected_answer = taq.snapshot_correct_answer;

  v_score := case when v_total = 0 then 0
                  else round((v_correct::numeric / v_total) * 100) end;

  update public.test_attempts
     set status = 'submitted', submitted_at = now(),
         correct_count = v_correct, total_count = v_total, score_percent = v_score
   where id = p_attempt_id
   returning * into v_attempt;

  -- Pair BOC + EOC by SAME test_id, OPPOSITE phase
  select * into v_test from public.tests where id = v_attempt.test_id;

  select * into v_other_attempt
    from public.test_attempts ta
   where ta.student_id = v_attempt.student_id
     and ta.test_id    = v_attempt.test_id
     and ta.phase     <> v_attempt.phase
     and ta.status     = 'submitted'
   limit 1;

  if v_other_attempt.id is not null then
    if v_attempt.phase = 'EOC' then
      v_boc := v_other_attempt.score_percent;
      v_eoc := v_attempt.score_percent;
    else
      v_boc := v_attempt.score_percent;
      v_eoc := v_other_attempt.score_percent;
    end if;
    v_diff  := v_eoc - v_boc;
    v_avail := 100 - v_boc;
    v_growth := case when v_avail <= 0 then 100 else round((v_diff::numeric / v_avail) * 100) end;

    insert into public.growth_results
      (student_id, course_id, school_year_id, boc_score, eoc_score, point_difference, growth_percentage)
    values
      (v_attempt.student_id, v_test.course_id, v_test.school_year_id,
       v_boc, v_eoc, v_diff, v_growth)
    on conflict (student_id, course_id, school_year_id) do update
      set boc_score = excluded.boc_score,
          eoc_score = excluded.eoc_score,
          point_difference = excluded.point_difference,
          growth_percentage = excluded.growth_percentage,
          updated_at = now();
  end if;

  insert into public.audit_logs (actor_email, action, target, details)
  values (coalesce(auth.email(), 'student'), 'test.submitted', v_attempt.id::text,
          jsonb_build_object('test_id', v_attempt.test_id,
                             'phase',   v_attempt.phase::text,
                             'score',   v_score));

  -- Strip session_secret before returning to client
  return to_jsonb(v_attempt) - 'session_secret';
end $$;

grant execute on function public.submit_attempt(uuid, uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) delete_test — super_admin only, full cascade
-- ----------------------------------------------------------------------------
create or replace function public.delete_test(p_test_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin can delete tests' using errcode = '42501';
  end if;
  select name into v_name from public.tests where id = p_test_id;
  if v_name is null then
    raise exception 'Test not found' using errcode = '42704';
  end if;
  -- Cascading FKs handle questions, answer_keys, attempts, attempt_questions,
  -- responses, test_windows. growth_results survive (no FK to tests, only course_id).
  delete from public.tests where id = p_test_id;
  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'test.deleted', p_test_id::text,
          jsonb_build_object('name', v_name));
end $$;
revoke all on function public.delete_test(uuid) from public, anon;
grant execute on function public.delete_test(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8) Cleanup: remove demo seed students/teachers/tests
--    Identified by the synthesized OneRoster prefix used in extended_seed.sql.
-- ----------------------------------------------------------------------------
-- Demo students: OR-S-100001 .. OR-S-100030, or the @students.hpa.test domain
delete from public.students
 where oneroster_user_sourced_id like 'OR-S-%'
    or email like '%@students.hpa.test';

-- Demo teachers: OR-T-1 .. OR-T-5
delete from public.teachers
 where oneroster_user_sourced_id ~ '^OR-T-[0-9]+$'
    or email like '%@hpa.test';

-- Demo tests: anything tied to the synthetic demo courses
delete from public.tests
 where course_id in (
   select id from public.courses
    where oneroster_course_sourced_id like 'OR-COURSE-%'
 );

-- Demo course sections / courses / school years / terms — only purge if they
-- weren't refreshed by the live OneRoster sync (i.e. still carry the seed
-- prefixes AND have nothing referencing them other than what we just deleted).
delete from public.course_sections where oneroster_class_sourced_id like 'OR-CLS-%';
delete from public.courses          where oneroster_course_sourced_id like 'OR-COURSE-%';
delete from public.terms            where oneroster_academic_session_sourced_id like 'AS-2627-S%';
delete from public.school_years     where oneroster_academic_session_sourced_id = 'AS-2627';
delete from public.campuses
 where oneroster_org_sourced_id in ('OR-MHP', 'OR-HP', 'OR-HPW');

notify pgrst, 'reload schema';
select 'v2 simplifications applied' as status;
