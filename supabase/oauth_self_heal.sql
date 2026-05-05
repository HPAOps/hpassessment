-- =============================================================================
-- HPA — OAuth callback self-heal RPC + clearer whitelist errors
-- =============================================================================
-- Solves the "partial auth.users row but no profile" edge case caused by
-- earlier failed trigger runs or whitelist changes. Called from the
-- /staff/oauth-callback page after Supabase finishes the OAuth redirect.
--
-- If the current authenticated user has a matching whitelist entry, this
-- RPC creates/updates their profile and returns it. Otherwise it raises a
-- clear "email not authorized" error so the frontend can show it verbatim.
-- Idempotent — safe to re-run.
-- =============================================================================

create or replace function public.ensure_profile_from_whitelist()
returns public.profiles
language plpgsql
security definer
set search_path = public as $$
declare
  v_user auth.users%rowtype;
  v_wl public.staff_whitelist%rowtype;
  v_profile public.profiles%rowtype;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Return existing profile if already provisioned
  select * into v_profile from public.profiles where id = auth.uid();
  if found then
    return v_profile;
  end if;

  -- Need to look up the auth.users row to pull email + metadata
  select * into v_user from auth.users where id = auth.uid();
  if not found then
    raise exception 'Auth user not found' using errcode = '42501';
  end if;

  -- Whitelist check (case-insensitive)
  select * into v_wl from public.staff_whitelist
    where lower(email) = lower(v_user.email);
  if not found then
    raise exception 'Email % is not authorized for HPA Growth Assessments. Ask a super admin to add you on Admin → Integrations → Staff Access.', v_user.email
      using errcode = '42501';
  end if;

  v_name := coalesce(
    v_user.raw_user_meta_data->>'name',
    v_user.raw_user_meta_data->>'full_name',
    trim(concat_ws(' ', v_user.raw_user_meta_data->>'given_name', v_user.raw_user_meta_data->>'family_name')),
    v_user.email
  );

  insert into public.profiles (id, email, name, role, campus_id, teacher_id, is_active)
  values (v_user.id, v_user.email, v_name, v_wl.role, v_wl.campus_id, v_wl.teacher_id, true)
  on conflict (id) do update
    set email = excluded.email, name = excluded.name, role = excluded.role,
        campus_id = excluded.campus_id, teacher_id = excluded.teacher_id,
        updated_at = now()
  returning * into v_profile;

  -- FERPA audit entry
  begin
    insert into public.audit_logs (actor_id, actor_email, action, target, details)
    values (auth.uid(), v_user.email, 'auth.sso.self_heal', v_user.email,
            jsonb_build_object('role_assigned', v_wl.role::text));
  exception when others then null;
  end;

  return v_profile;
end $$;

revoke all on function public.ensure_profile_from_whitelist() from public;
revoke all on function public.ensure_profile_from_whitelist() from anon;
grant execute on function public.ensure_profile_from_whitelist() to authenticated;

notify pgrst, 'reload schema';
select 'oauth self-heal ready' as status;
