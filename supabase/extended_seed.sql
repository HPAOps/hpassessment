-- =============================================================================
-- HPA Course Growth Assessments — EXTENDED SEED (optional)
-- =============================================================================
-- Run AFTER full_setup.sql. Inserts the same demo dataset the React app uses
-- in Demo Mode (3 campuses, 22 courses, 5 teachers, 30 students, 5 tests,
-- ~42 questions, sample enrollments + assignments).
--
-- Idempotent: uses ON CONFLICT on the oneroster_*_sourced_id columns so it
-- can be re-run safely.
-- =============================================================================

-- --------------------------------------------------------------------- CAMPUSES
insert into public.campuses (oneroster_org_sourced_id, name, code) values
  ('OR-MHP', 'Madison Highland Prep', 'MHP'),
  ('OR-HP',  'Highland Prep',         'HP'),
  ('OR-HPW', 'Highland Prep West',    'HPW')
on conflict (oneroster_org_sourced_id) do update
  set name = excluded.name, code = excluded.code;

-- ----------------------------------------------------------------- SCHOOL YEAR
insert into public.school_years (oneroster_academic_session_sourced_id, name, start_date, end_date, is_active) values
  ('AS-2627', '2026-2027', '2026-08-03', '2027-05-21', true)
on conflict (oneroster_academic_session_sourced_id) do update set is_active = true;

insert into public.terms (oneroster_academic_session_sourced_id, name, start_date, end_date, school_year_id)
select v.sid, v.name, v.s, v.e, sy.id
from (values
  ('AS-2627-S1','Semester 1','2026-08-03','2026-12-18'),
  ('AS-2627-S2','Semester 2','2027-01-05','2027-05-21')
) v(sid, name, s, e)
join public.school_years sy on sy.oneroster_academic_session_sourced_id = 'AS-2627'
on conflict (oneroster_academic_session_sourced_id) do nothing;

-- --------------------------------------------------------------------- COURSES
-- 22 courses (Algebra 1A/1B + Algebra 2A/2B + Geometry A/B + Pre-Calc A/B +
-- Biology A/B + Chemistry A/B + Physics A/B + English 9A/9B + 10A/10B +
-- World History A/B + US History A/B)
insert into public.courses (oneroster_course_sourced_id, code, title, school_year_id)
select v.sid, v.code, v.title, sy.id
from (values
  ('OR-COURSE-1','ALG-1A','Algebra 1A'),
  ('OR-COURSE-2','ALG-1B','Algebra 1B'),
  ('OR-COURSE-3','ALG-2A','Algebra 2A'),
  ('OR-COURSE-4','ALG-2B','Algebra 2B'),
  ('OR-COURSE-5','GEO-A','Geometry A'),
  ('OR-COURSE-6','GEO-B','Geometry B'),
  ('OR-COURSE-7','PRE-A','Pre-Calculus A'),
  ('OR-COURSE-8','PRE-B','Pre-Calculus B'),
  ('OR-COURSE-9','BIO-A','Biology A'),
  ('OR-COURSE-10','BIO-B','Biology B'),
  ('OR-COURSE-11','CHE-A','Chemistry A'),
  ('OR-COURSE-12','CHE-B','Chemistry B'),
  ('OR-COURSE-13','PHY-A','Physics A'),
  ('OR-COURSE-14','PHY-B','Physics B'),
  ('OR-COURSE-15','ENG-9A','English 9A'),
  ('OR-COURSE-16','ENG-9B','English 9B'),
  ('OR-COURSE-17','ENG-10A','English 10A'),
  ('OR-COURSE-18','ENG-10B','English 10B'),
  ('OR-COURSE-19','WH-A','World History A'),
  ('OR-COURSE-20','WH-B','World History B'),
  ('OR-COURSE-21','US-A','US History A'),
  ('OR-COURSE-22','US-B','US History B')
) v(sid, code, title)
join public.school_years sy on sy.oneroster_academic_session_sourced_id = 'AS-2627'
on conflict (oneroster_course_sourced_id) do update
  set title = excluded.title, code = excluded.code;

-- ---------------------------------------------------------------- TEACHERS (5)
insert into public.teachers (oneroster_user_sourced_id, first_name, last_name, email, campus_id)
select v.sid, v.fn, v.ln, v.em, c.id
from (values
  ('OR-T-1','Alicia','Reyes',    'areyes@hpa.test',     'OR-MHP'),
  ('OR-T-2','Marcus','Tran',     'mtran@hpa.test',      'OR-HP'),
  ('OR-T-3','Priya', 'Iyer',     'piyer@hpa.test',      'OR-HPW'),
  ('OR-T-4','Jordan','Whitfield','jwhitfield@hpa.test', 'OR-MHP'),
  ('OR-T-5','Sofia', 'Becerra',  'sbecerra@hpa.test',   'OR-HP')
) v(sid, fn, ln, em, campus_sid)
join public.campuses c on c.oneroster_org_sourced_id = v.campus_sid
on conflict (oneroster_user_sourced_id) do update
  set first_name = excluded.first_name, last_name = excluded.last_name,
      email = excluded.email, campus_id = excluded.campus_id;

-- ----------------------------------------------------------- COURSE SECTIONS
-- Algebra 1A across 3 campuses + Algebra 1B across 2 + Biology A at MHP
insert into public.course_sections (oneroster_class_sourced_id, course_id, campus_id, term_id, section_code)
select v.sid, c.id, ca.id, t.id, v.section_code
from (values
  ('OR-CLS-ALG1A-MHP','OR-COURSE-1','OR-MHP','AS-2627-S1','ALG1A-101'),
  ('OR-CLS-ALG1A-HP', 'OR-COURSE-1','OR-HP', 'AS-2627-S1','ALG1A-201'),
  ('OR-CLS-ALG1A-HPW','OR-COURSE-1','OR-HPW','AS-2627-S1','ALG1A-301'),
  ('OR-CLS-ALG1B-MHP','OR-COURSE-2','OR-MHP','AS-2627-S2','ALG1B-101'),
  ('OR-CLS-ALG1B-HP', 'OR-COURSE-2','OR-HP', 'AS-2627-S2','ALG1B-201'),
  ('OR-CLS-BIOA-MHP', 'OR-COURSE-9','OR-MHP','AS-2627-S1','BIOA-101')
) v(sid, course_sid, campus_sid, term_sid, section_code)
join public.courses  c  on c.oneroster_course_sourced_id = v.course_sid
join public.campuses ca on ca.oneroster_org_sourced_id   = v.campus_sid
join public.terms    t  on t.oneroster_academic_session_sourced_id = v.term_sid
on conflict (oneroster_class_sourced_id) do update
  set course_id = excluded.course_id, campus_id = excluded.campus_id,
      term_id  = excluded.term_id,    section_code = excluded.section_code;

-- ------------------------------------------------ TEACHER → SECTION ASSIGNMENTS
insert into public.teacher_class_assignments (oneroster_enrollment_sourced_id, teacher_id, course_section_id)
select v.sid, t.id, cs.id
from (values
  ('OR-E-T-1','OR-T-1','OR-CLS-ALG1A-MHP'),
  ('OR-E-T-2','OR-T-2','OR-CLS-ALG1A-HP'),
  ('OR-E-T-3','OR-T-3','OR-CLS-ALG1A-HPW'),
  ('OR-E-T-4','OR-T-1','OR-CLS-ALG1B-MHP'),
  ('OR-E-T-5','OR-T-2','OR-CLS-ALG1B-HP'),
  ('OR-E-T-6','OR-T-4','OR-CLS-BIOA-MHP')
) v(sid, t_sid, cs_sid)
join public.teachers       t  on t.oneroster_user_sourced_id  = v.t_sid
join public.course_sections cs on cs.oneroster_class_sourced_id = v.cs_sid
on conflict (oneroster_enrollment_sourced_id) do update
  set teacher_id = excluded.teacher_id, course_section_id = excluded.course_section_id;

-- ----------------------------------------------------------------- STUDENTS (30)
-- IDs 100001..100030, distributed across 3 campuses (i % 3) and grades 9-12.
insert into public.students (oneroster_user_sourced_id, student_id, first_name, last_name, grade_level, campus_id, email)
select 'OR-S-' || sid, sid, fn, ln, 9 + ((i - 1) % 4), c.id,
       lower(fn) || '.' || lower(ln) || '@students.hpa.test'
from (
  select i,
         to_char(100000 + i, 'FM000000') as sid,
         fns.fn, lns.ln,
         (array['OR-MHP','OR-HP','OR-HPW'])[((i - 1) % 3) + 1] as campus_sid
  from generate_series(1, 30) i
  join lateral (
    select (array[
      'Liam','Ava','Noah','Mia','Ethan','Sophia','Mason','Isabella','Lucas','Olivia',
      'Logan','Emma','Aiden','Harper','Caleb','Charlotte','Jackson','Amelia','Carter','Evelyn',
      'Wyatt','Abigail','Elijah','Ella','Henry','Scarlett','Owen','Aria','Daniel','Layla'
    ])[i] as fn
  ) fns on true
  join lateral (
    select (array[
      'Garcia','Smith','Johnson','Lee','Brown','Davis','Martinez','Wilson','Anderson','Taylor',
      'Thomas','Hernandez','Moore','White','Clark','Lewis','Walker','Young','Allen','King',
      'Scott','Green','Baker','Hill','Adams','Nelson','Carter','Mitchell','Roberts','Turner'
    ])[i] as ln
  ) lns on true
) src
join public.campuses c on c.oneroster_org_sourced_id = src.campus_sid
on conflict (oneroster_user_sourced_id) do update
  set first_name = excluded.first_name, last_name = excluded.last_name,
      grade_level = excluded.grade_level, campus_id = excluded.campus_id,
      email = excluded.email;

-- ------------------------------------------------- STUDENT → SECTION ENROLLMENTS
-- Every student is enrolled in their campus's Algebra 1A section.
insert into public.student_enrollments (oneroster_enrollment_sourced_id, student_id, course_section_id, status)
select 'OR-E-' || s.student_id || '-A',
       s.id,
       (select cs.id from public.course_sections cs
          join public.campuses c2 on c2.id = cs.campus_id
          join public.courses  cr on cr.id = cs.course_id
          where c2.id = s.campus_id and cr.oneroster_course_sourced_id = 'OR-COURSE-1'
          limit 1),
       'active'
from public.students s
where s.oneroster_user_sourced_id like 'OR-S-%'
on conflict (oneroster_enrollment_sourced_id) do nothing;

-- Even-indexed students at MHP/HP also enrolled in Algebra 1B
insert into public.student_enrollments (oneroster_enrollment_sourced_id, student_id, course_section_id, status)
select 'OR-E-' || s.student_id || '-B',
       s.id,
       (select cs.id from public.course_sections cs
          join public.campuses c2 on c2.id = cs.campus_id
          join public.courses  cr on cr.id = cs.course_id
          where c2.id = s.campus_id and cr.oneroster_course_sourced_id = 'OR-COURSE-2'
          limit 1),
       'active'
from public.students s
where s.oneroster_user_sourced_id like 'OR-S-%'
  and (s.student_id::int) % 2 = 1                             -- about half
  and s.campus_id in (select id from public.campuses where oneroster_org_sourced_id in ('OR-MHP','OR-HP'))
on conflict (oneroster_enrollment_sourced_id) do nothing;

-- ---------------------------------------------------------------- TESTS (5)
-- Live windows: opens 30 days ago, closes 60 days from now (always live)
insert into public.tests (course_id, school_year_id, name, test_type, scope, question_count, is_published, opens_at, closes_at)
select c.id, sy.id, v.name, v.tt::test_type_enum, 'district', v.qc, true,
       current_date - interval '30 days', current_date + interval '60 days'
from (values
  ('OR-COURSE-1','Algebra 1A Beginning of Course','BOC',10),
  ('OR-COURSE-1','Algebra 1A End of Course',      'EOC',10),
  ('OR-COURSE-2','Algebra 1B Beginning of Course','BOC',8),
  ('OR-COURSE-2','Algebra 1B End of Course',      'EOC',8),
  ('OR-COURSE-9','Biology A Beginning of Course', 'BOC',6)
) v(course_sid, name, tt, qc)
join public.courses      c  on c.oneroster_course_sourced_id = v.course_sid
join public.school_years sy on sy.oneroster_academic_session_sourced_id = 'AS-2627'
where not exists (
  select 1 from public.tests t
  where t.course_id = c.id and t.test_type = v.tt::test_type_enum and t.school_year_id = sy.id
);

-- ---------------------------------------------------------------- QUESTIONS
-- Generate placeholder questions for each test (uses picsum.photos as image_url).
do $$
declare
  r record;
  qn int;
  letter answer_letter;
  letters answer_letter[] := array['A','B','C','D'];
begin
  for r in select t.id, t.question_count, t.name from public.tests t
           where t.school_year_id = (select id from public.school_years where oneroster_academic_session_sourced_id='AS-2627')
  loop
    for qn in 1..r.question_count loop
      letter := letters[((qn - 1) % 4) + 1];
      insert into public.questions (test_id, question_number, image_url, correct_answer, standard_tag, difficulty, is_active)
      values (r.id, qn,
              'https://picsum.photos/seed/' || replace(r.name,' ','-') || '-q' || qn || '/1000/640',
              letter,
              (array['A.SSE.1','A.REI.3','F.LE.1','S.ID.6','N.RN.2'])[((qn - 1) % 5) + 1],
              (array['easy','medium','hard'])[((qn - 1) % 3) + 1],
              true)
      on conflict (test_id, question_number) do nothing;
    end loop;
  end loop;
end $$;

-- Done. The student-id login and admin dashboards now have data. ✅
