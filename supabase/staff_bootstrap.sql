-- =============================================================================
-- HPA Course Growth Assessments — Staff bootstrap
-- =============================================================================
-- UUIDs filled in from the Supabase Users table.
-- All four users share the password: HPATestUser123
-- =============================================================================

-- super_admin
insert into public.profiles (id, email, name, role, campus_id)
values ('7c9c11c0-0678-42c4-bed6-cb9d1ee5e15e'::uuid,
        'super@hpa.test', 'Sam Powell', 'super_admin', null)
on conflict (id) do update
  set email = excluded.email, name = excluded.name,
      role = excluded.role, campus_id = excluded.campus_id;

-- district_admin
insert into public.profiles (id, email, name, role, campus_id)
values ('f44a0f51-2739-4947-a977-63cba5193428'::uuid,
        'district@hpa.test', 'Diana Reyes', 'district_admin', null)
on conflict (id) do update
  set email = excluded.email, name = excluded.name,
      role = excluded.role, campus_id = excluded.campus_id;

-- campus_admin (scoped to Madison Highland Prep)
insert into public.profiles (id, email, name, role, campus_id)
values ('7777d772-966f-4412-9ab0-561decf667e0'::uuid,
        'madison@hpa.test', 'Marcus Cole', 'campus_admin',
        (select id from public.campuses where oneroster_org_sourced_id = 'OR-MHP'))
on conflict (id) do update
  set email = excluded.email, name = excluded.name,
      role = excluded.role, campus_id = excluded.campus_id;

-- teacher (Alicia Reyes at Madison)
insert into public.profiles (id, email, name, role, campus_id, teacher_id)
values ('6c0cb44b-bce6-4bbb-a747-8c2871e0723d'::uuid,
        'teacher@hpa.test', 'Alicia Reyes', 'teacher',
        (select id from public.campuses where oneroster_org_sourced_id = 'OR-MHP'),
        (select id from public.teachers where oneroster_user_sourced_id = 'OR-T-1'))
on conflict (id) do update
  set email = excluded.email, name = excluded.name, role = excluded.role,
      campus_id = excluded.campus_id, teacher_id = excluded.teacher_id;

-- Sanity check — should return 4 rows
select email, role::text as role, campus_id, teacher_id
from public.profiles
order by email;
