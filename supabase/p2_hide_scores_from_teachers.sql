-- =============================================================================
-- HPA -- Hide scores from teachers in teacher_session_state.
--
-- Teachers monitor progress (current_question_index / total_count) but must
-- NOT see correct_count or score_percent. Admins still see everything.
-- Idempotent.
-- =============================================================================

create or replace function public.teacher_session_state(p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_session public.test_sessions%rowtype;
  v_role text;
  v_is_teacher boolean;
  v_attempts jsonb;
  v_roster jsonb;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('super_admin','district_admin','campus_admin','teacher') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_is_teacher := (v_role = 'teacher');

  select * into v_session from public.test_sessions where id = p_session_id;
  if not found then raise exception 'Session not found' using errcode = '22023'; end if;

  -- Teachers get progress (current_question_index, total_count, status)
  -- but NOT the score fields. Admins get the full payload.
  if v_is_teacher then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', ta.id, 'student_db_id', s.id,
      'status', ta.status, 'is_paused', ta.is_paused,
      'paused_at', ta.paused_at, 'paused_reason', ta.paused_reason,
      'current_question_index', ta.current_question_index,
      'total_count', ta.total_count,
      'submitted_at', ta.submitted_at,
      'student', jsonb_build_object('id', s.id, 'first_name', s.first_name,
                                    'last_name', s.last_name, 'student_id', s.student_id)
    ) order by s.last_name nulls last, s.first_name nulls last), '[]'::jsonb)
    into v_attempts
    from public.test_attempts ta
    join public.students s on s.id = ta.student_id
    where ta.session_id = p_session_id;
  else
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
  end if;

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
    'roster_not_joined', v_roster,
    'viewer_role', v_role
  );
end $$;
revoke all on function public.teacher_session_state(uuid) from public;
grant execute on function public.teacher_session_state(uuid) to authenticated;

select 'teacher_session_state now strips scores for teachers' as status;
