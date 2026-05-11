-- =============================================================================
-- HPA -- Staff whitelist: editable first/last name + accept name in upsert RPC
-- =============================================================================
-- The whitelist now stores its own first_name/last_name so super admins can
-- override the OneRoster-imported name (or supply one when adding manually).
-- The frontend already falls back to teachers.first_name/last_name when these
-- are null.
--
-- Idempotent.
-- =============================================================================

alter table public.staff_whitelist
  add column if not exists first_name text,
  add column if not exists last_name text;

-- Replace whitelist_upsert to accept the two new optional columns.
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
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin can edit whitelist' using errcode = '42501';
  end if;
  insert into public.staff_whitelist (
    email, role, campus_id, teacher_id, tenant_hint,
    first_name, last_name, created_by
  )
  values (
    lower(p_email), p_role, p_campus_id, p_teacher_id, p_tenant_hint,
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

  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'whitelist.upsert', lower(p_email),
          jsonb_build_object('role', p_role::text, 'tenant', p_tenant_hint));
end $$;

revoke all on function public.whitelist_upsert(text, user_role, uuid, uuid, text, text, text) from public;
grant execute on function public.whitelist_upsert(text, user_role, uuid, uuid, text, text, text) to authenticated;

select 'Whitelist name columns ready' as status;
