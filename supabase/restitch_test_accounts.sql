-- =============================================================================
-- HPA -- Re-stitch test staff accounts after the first OneRoster sync.
--
-- The original `staff_bootstrap.sql` set teacher@hpa.test.teacher_id to
--   (select id from public.teachers where oneroster_user_sourced_id = 'OR-T-1')
-- and madison@hpa.test.campus_id to a campus with `oneroster_org_sourced_id =
-- 'OR-MHP'`. Both sourcedIds are seed-only sentinels; once the real OneRoster
-- sync ran, the teachers/campuses tables were replaced and those FKs went null.
--
-- This script picks any real OneRoster row that "looks like Madison" (or any
-- Madison teacher with assignments) and points the seeded test profiles at
-- them. Idempotent.
-- =============================================================================

-- 1) Pin madison@hpa.test to whichever campus name contains "Madison".
update public.profiles
   set campus_id = (
     select id from public.campuses
      where lower(name) like '%madison%'
      order by created_at nulls last
      limit 1
   )
 where email = 'madison@hpa.test'
   and (campus_id is null or campus_id not in (select id from public.campuses));

-- 2) Pin teacher@hpa.test to a real teacher who actually has at least one
--    section assigned (otherwise RLS would still hide everything from them).
--    Prefer a teacher at Madison; fall back to ANY teacher with assignments.
update public.profiles
   set teacher_id = (
     select t.id from public.teachers t
       join public.teacher_class_assignments tca on tca.teacher_id = t.id
       left join public.campuses c on c.id = t.campus_id
      where t.is_active is not false
      order by case when lower(coalesce(c.name, '')) like '%madison%' then 0 else 1 end,
               t.last_name, t.first_name
      limit 1
   ),
       campus_id = coalesce(
         (select campus_id from public.teachers t
            where t.id = (
              select t2.id from public.teachers t2
                join public.teacher_class_assignments tca on tca.teacher_id = t2.id
                left join public.campuses c on c.id = t2.campus_id
               where t2.is_active is not false
               order by case when lower(coalesce(c.name, '')) like '%madison%' then 0 else 1 end,
                        t2.last_name, t2.first_name
               limit 1
            )),
         campus_id
       )
 where email = 'teacher@hpa.test';

-- 3) Sanity report — show post-stitch state + assignment count for the
--    teacher account so we can see if their Sections page should now work.
with t as (
  select p.email, p.role, p.campus_id, p.teacher_id, c.name as campus_name,
         tea.first_name || ' ' || tea.last_name as teacher_name,
         (select count(*) from public.teacher_class_assignments
           where teacher_id = p.teacher_id) as assigned_sections
    from public.profiles p
    left join public.campuses c on c.id = p.campus_id
    left join public.teachers tea on tea.id = p.teacher_id
   where p.email in ('super@hpa.test', 'district@hpa.test',
                     'madison@hpa.test', 'teacher@hpa.test')
)
select * from t order by email;
