-- =============================================================================
-- Student-ID login RPC
-- =============================================================================
-- The student app collects only a Student ID. This RPC validates it server-side
-- (so the anon key alone cannot enumerate students) and returns the minimum
-- profile + active enrollments so the React app can render the course picker.
--
-- The function is SECURITY DEFINER so it can read across RLS (the function
-- enforces its own checks). Grant execute to anon so the student-id input
-- works without a Supabase auth session.
-- =============================================================================

create or replace function public.student_lookup(p_student_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
  v_enrollments jsonb;
begin
  select * into v_student
  from public.students
  where student_id = p_student_id and is_active = true
  limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'enrollment_id', se.id,
    'course', jsonb_build_object('id', c.id, 'title', c.title, 'code', c.code),
    'section', jsonb_build_object('id', cs.id, 'section_code', cs.section_code),
    'campus',  jsonb_build_object('id', cmp.id, 'name', cmp.name),
    'teacher', case when t.id is null then null else
      jsonb_build_object('id', t.id, 'first_name', t.first_name, 'last_name', t.last_name)
    end
  )), '[]'::jsonb)
  into v_enrollments
  from public.student_enrollments se
  join public.course_sections cs on cs.id = se.course_section_id
  join public.courses c on c.id = cs.course_id
  left join public.campuses cmp on cmp.id = cs.campus_id
  left join public.teacher_class_assignments tca on tca.course_section_id = cs.id
  left join public.teachers t on t.id = tca.teacher_id
  where se.student_id = v_student.id and se.status = 'active';

  return jsonb_build_object(
    'found', true,
    'student', jsonb_build_object(
      'id', v_student.id,
      'student_id', v_student.student_id,
      'name', concat_ws(' ', v_student.first_name, v_student.last_name),
      'campus_id', v_student.campus_id
    ),
    'enrollments', v_enrollments
  );
end $$;

revoke all on function public.student_lookup(text) from public;
grant execute on function public.student_lookup(text) to anon, authenticated;
