-- =============================================================================
-- HPA — Cleanup duplicate SEED-* placeholder rows (optional)
-- =============================================================================
-- The original full_setup.sql seed inserted a tiny placeholder set
-- (SEED-MHP, SEED-HP, SEED-HPW + 2 SEED courses + SEED-SY-2627). Then
-- extended_seed.sql inserted the canonical OR-* rows. This script removes
-- the orphan SEED-* placeholders so the operational tables match the spec
-- counts (3 campuses / 22 courses).
-- =============================================================================

delete from public.courses
 where oneroster_course_sourced_id in ('SEED-COURSE-1','SEED-COURSE-2');

delete from public.school_years
 where oneroster_academic_session_sourced_id = 'SEED-SY-2627';

delete from public.campuses
 where oneroster_org_sourced_id in ('SEED-MHP','SEED-HP','SEED-HPW');

select
  (select count(*) from public.campuses)  as campuses,
  (select count(*) from public.courses)   as courses,
  (select count(*) from public.students)  as students,
  (select count(*) from public.teachers)  as teachers,
  (select count(*) from public.tests)     as tests;
