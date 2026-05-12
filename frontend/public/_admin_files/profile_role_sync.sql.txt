-- =============================================================================
-- HPA -- Make staff_whitelist the AUTHORITATIVE source of profile roles
-- =============================================================================
-- Bug: when an admin changed a user's role in the staff_whitelist, the user's
-- existing `profiles` row was NOT updated, so the user kept their old role
-- (e.g. someone created as super_admin and later demoted to teacher kept
-- super_admin access).
--
-- This patch:
--   (1) Recreates `whitelist_upsert` so it ALSO syncs the matching profile
--       row whenever a whitelist entry changes (role / campus / teacher_id).
--   (2) Recreates `whitelist_delete` so removing a whitelist entry also
--       deactivates the matching profile (sets is_active=false), preventing
--       the user from authenticating further.
--   (3) Adds a one-shot `_resync_all_profiles_from_whitelist()` helper and
--       calls it once so any pre-existing mismatches are fixed in place.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

-- 1) whitelist_upsert with name params (Phase J added these) + profile sync
create or replace function public.whitelist_upsert(
  p_email text,
  p_role user_role,
  p_campus_id uuid default null,
  p_teacher_id uuid default null,
  p_tenant_hint text default null,
  p_first_name text default null,
  p_last_name text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(p_email);
  v_auth_user_id uuid;
  v_old_role user_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin can edit whitelist' using errcode = '42501';
  end if;

  -- Upsert the whitelist entry first.
  insert into public.staff_whitelist (
    email, role, campus_id, teacher_id, tenant_hint,
    first_name, last_name, created_by
  )
  values (
    v_email, p_role, p_campus_id, p_teacher_id, p_tenant_hint,
    nullif(p_first_name, ''), nullif(p_last_name, ''), auth.uid()
  )
  on conflict ((lower(email))) do update
    set role = excluded.role,
        campus_id = excluded.campus_id,
        teacher_id = excluded.teacher_id,
        tenant_hint = excluded.tenant_hint,
        first_name = coalesce(excluded.first_name, public.staff_whitelist.first_name),
        last_name  = coalesce(excluded.last_name,  public.staff_whitelist.last_name),
        updated_at = now();

  -- Find the matching auth.users row (case-insensitive). If present, the
  -- profile row exists too (created by either the OAuth trigger or
  -- ensure_profile_from_whitelist on first sign-in).
  select id into v_auth_user_id from auth.users
    where lower(email) = v_email limit 1;

  if v_auth_user_id is not null then
    -- Capture old role for the audit entry.
    select role into v_old_role from public.profiles where id = v_auth_user_id;

    update public.profiles
       set role       = p_role,
           campus_id  = p_campus_id,
           teacher_id = p_teacher_id,
           is_active  = true,
           updated_at = now()
     where id = v_auth_user_id;

    if (v_old_role is null or v_old_role <> p_role) then
      insert into public.audit_logs (actor_id, actor_email, action, target, details)
      values (auth.uid(), auth.email(), 'profile.role.synced', v_email,
              jsonb_build_object(
                'from_role', coalesce(v_old_role::text, '<new>'),
                'to_role', p_role::text,
                'source', 'whitelist_upsert'
              ));
    end if;
  end if;

  -- Always-on audit row for the whitelist edit itself.
  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'whitelist.upsert', v_email,
          jsonb_build_object('role', p_role::text, 'tenant', p_tenant_hint));
end $$;

revoke all on function public.whitelist_upsert(text, user_role, uuid, uuid, text, text, text) from public;
grant execute on function public.whitelist_upsert(text, user_role, uuid, uuid, text, text, text) to authenticated;

-- 2) whitelist_delete also deactivates the matching profile (so the user
--    can no longer access protected RPCs) and logs the change.
create or replace function public.whitelist_delete(p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(p_email);
  v_auth_user_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin can edit whitelist' using errcode = '42501';
  end if;

  delete from public.staff_whitelist where lower(email) = v_email;

  select id into v_auth_user_id from auth.users where lower(email) = v_email limit 1;
  if v_auth_user_id is not null then
    update public.profiles set is_active = false, updated_at = now()
     where id = v_auth_user_id;
  end if;

  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'whitelist.delete', v_email,
          jsonb_build_object('deactivated_profile', v_auth_user_id is not null));
end $$;
revoke all on function public.whitelist_delete(text) from public;
grant execute on function public.whitelist_delete(text) to authenticated;

-- 3) One-shot resync of ALL profiles to match current whitelist roles.
--    Any user whose `profiles.role` does not match `staff_whitelist.role`
--    is corrected, and an audit row is written for each correction.
do $$
declare
  r record;
  v_corrections int := 0;
begin
  for r in
    select
      au.id as user_id,
      au.email,
      p.role as old_role,
      wl.role as new_role,
      wl.campus_id as new_campus,
      wl.teacher_id as new_teacher
    from public.profiles p
    join auth.users au on au.id = p.id
    join public.staff_whitelist wl on lower(wl.email) = lower(au.email)
    where p.role <> wl.role
  loop
    update public.profiles
       set role = r.new_role,
           campus_id = r.new_campus,
           teacher_id = r.new_teacher,
           updated_at = now()
     where id = r.user_id;
    v_corrections := v_corrections + 1;
    insert into public.audit_logs (actor_email, action, target, details)
    values ('system', 'profile.role.resync', r.email,
            jsonb_build_object(
              'from_role', r.old_role::text,
              'to_role', r.new_role::text,
              'source', 'one_shot_resync'
            ));
  end loop;
  raise notice 'Corrected % profile role(s)', v_corrections;
end $$;

notify pgrst, 'reload schema';
select 'Profile-from-whitelist sync ready' as status;
