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
  if not (public.is_district_admin() or public.current_role() = 'campus_admin') then
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
