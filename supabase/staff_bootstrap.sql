-- =============================================================================
-- HPA Course Growth Assessments — Staff bootstrap (run AFTER creating users)
-- =============================================================================
-- Step 1: In Supabase Dashboard → Authentication → Users → "Add user", create
--         the 4 staff users. Use any password you want (a separate one per role
--         is fine). Copy each user's UUID from the Users table.
-- Step 2: Replace the four UUID placeholders below and run this script.
-- =============================================================================

-- ⬇⬇⬇  REPLACE THESE FOUR UUIDs WITH REAL auth.users.id VALUES  ⬇⬇⬇
-- super_admin
insert into public.profiles (id, email, name, role, campus_id)
values ('00000000-0000-0000-0000-000000000001'::uuid,
        'super@hpa.test', 'Sam Powell', 'super_admin', null)
on conflict (id) do update
  set email = excluded.email, name = excluded.name, role = excluded.role, campus_id = excluded.campus_id;

-- district_admin
insert into public.profiles (id, email, name, role, campus_id)
values ('00000000-0000-0000-0000-000000000002'::uuid,
        'district@hpa.test', 'Diana Reyes', 'district_admin', null)
on conflict (id) do update
  set email = excluded.email, name = excluded.name, role = excluded.role, campus_id = excluded.campus_id;

-- campus_admin (Madison Highland Prep — uses the Madison campus.id)
insert into public.profiles (id, email, name, role, campus_id)
values ('00000000-0000-0000-0000-000000000003'::uuid,
        'madison@hpa.test', 'Marcus Cole', 'campus_admin',
        (select id from public.campuses where oneroster_org_sourced_id = 'OR-MHP'))
on conflict (id) do update
  set email = excluded.email, name = excluded.name, role = excluded.role, campus_id = excluded.campus_id;

-- teacher (Alicia Reyes at Madison — uses teachers.id with sourcedId 'OR-T-1')
insert into public.profiles (id, email, name, role, campus_id, teacher_id)
values ('00000000-0000-0000-0000-000000000004'::uuid,
        'teacher@hpa.test', 'Alicia Reyes', 'teacher',
        (select id from public.campuses where oneroster_org_sourced_id = 'OR-MHP'),
        (select id from public.teachers where oneroster_user_sourced_id = 'OR-T-1'))
on conflict (id) do update
  set email = excluded.email, name = excluded.name, role = excluded.role,
      campus_id = excluded.campus_id, teacher_id = excluded.teacher_id;
-- ⬆⬆⬆  END USER UUIDs  ⬆⬆⬆

-- Quick sanity check — should return 4 rows
select email, role, campus_id, teacher_id from public.profiles order by role;
