-- =============================================================================
-- Seed data — minimal, safe-to-run-anytime placeholders.
-- =============================================================================
-- Insert initial campuses and a small set of placeholder courses so the app
-- has something visible before OneRoster import. Real data will overwrite
-- via the OneRoster import pipeline (matched by oneroster_*_sourced_id).
-- =============================================================================

insert into public.campuses (oneroster_org_sourced_id, name, code) values
  ('SEED-MHP', 'Madison Highland Prep', 'MHP'),
  ('SEED-HP',  'Highland Prep',         'HP'),
  ('SEED-HPW', 'Highland Prep West',    'HPW')
on conflict (oneroster_org_sourced_id) do nothing;

insert into public.school_years (oneroster_academic_session_sourced_id, name, start_date, end_date, is_active) values
  ('SEED-SY-2627', '2026-2027', '2026-08-03', '2027-05-21', true)
on conflict (oneroster_academic_session_sourced_id) do nothing;

insert into public.courses (oneroster_course_sourced_id, code, title, school_year_id)
select v.sid, v.code, v.title, sy.id
from (values
  ('SEED-COURSE-1','ALG1A','Algebra 1A'),
  ('SEED-COURSE-2','ALG1B','Algebra 1B')
) v(sid, code, title)
join public.school_years sy on sy.oneroster_academic_session_sourced_id = 'SEED-SY-2627'
on conflict (oneroster_course_sourced_id) do nothing;

-- Default settings row already inserted by schema.sql.
