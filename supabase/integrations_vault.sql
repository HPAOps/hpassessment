-- =============================================================================
-- HPA — Integrations vault + secret management RPCs
-- =============================================================================
-- Stores third-party integration secrets (SFTP passwords, API keys, etc.)
-- with strict super-admin-only RLS. Values are never returned to any client;
-- they're only readable internally by SECURITY DEFINER RPCs and server-side
-- Edge Functions (service role). Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.app_secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  value text,
  category text,
  description text,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  updated_by_email text
);

alter table public.app_secrets enable row level security;

drop policy if exists "secrets_super_rw" on public.app_secrets;
create policy "secrets_super_rw" on public.app_secrets
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- List secrets — MASKED. Never returns the actual value.
create or replace function public.secrets_list()
returns table (
  name text, category text, description text,
  configured boolean,
  updated_at timestamptz, updated_by_email text
)
language sql stable security definer set search_path = public as $$
  select name, category, description,
         (value is not null and length(value) > 0) as configured,
         updated_at, updated_by_email
  from public.app_secrets
  order by category, name;
$$;
revoke all on function public.secrets_list() from public;
revoke all on function public.secrets_list() from anon;
grant execute on function public.secrets_list() to authenticated;

-- Set / rotate a secret. Super-admin only. Never returns the value.
create or replace function public.secret_set(
  p_name text, p_value text, p_category text, p_description text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin can manage secrets' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Secret name is required';
  end if;

  insert into public.app_secrets (name, value, category, description, updated_by, updated_by_email)
  values (p_name, nullif(p_value, ''), p_category, p_description, auth.uid(), auth.email())
  on conflict (name) do update
    set value       = coalesce(nullif(excluded.value, ''), app_secrets.value),
        category    = coalesce(excluded.category, app_secrets.category),
        description = coalesce(excluded.description, app_secrets.description),
        updated_at  = now(),
        updated_by  = auth.uid(),
        updated_by_email = auth.email();

  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'secret.set', p_name,
          jsonb_build_object('category', p_category));
end $$;
revoke all on function public.secret_set(text, text, text, text) from public;
revoke all on function public.secret_set(text, text, text, text) from anon;
grant execute on function public.secret_set(text, text, text, text) to authenticated;

-- Clear a secret value (keeps the slot so UI still shows it).
create or replace function public.secret_clear(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin' using errcode = '42501';
  end if;
  update public.app_secrets
     set value = null, updated_at = now(),
         updated_by = auth.uid(), updated_by_email = auth.email()
   where name = p_name;
  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'secret.clear', p_name, '{}'::jsonb);
end $$;
revoke all on function public.secret_clear(text) from public;
revoke all on function public.secret_clear(text) from anon;
grant execute on function public.secret_clear(text) to authenticated;

-- Fully delete a secret row.
create or replace function public.secret_delete(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin' using errcode = '42501';
  end if;
  delete from public.app_secrets where name = p_name;
  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'secret.delete', p_name, '{}'::jsonb);
end $$;
revoke all on function public.secret_delete(text) from public;
revoke all on function public.secret_delete(text) from anon;
grant execute on function public.secret_delete(text) to authenticated;

-- Whitelist — read (for Integrations > Staff Access tab)
create or replace function public.whitelist_list()
returns setof public.staff_whitelist
language sql stable security definer set search_path = public as $$
  select * from public.staff_whitelist order by role, email;
$$;
revoke all on function public.whitelist_list() from public;
revoke all on function public.whitelist_list() from anon;
grant execute on function public.whitelist_list() to authenticated;

-- Whitelist — delete
create or replace function public.whitelist_delete(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin' using errcode = '42501';
  end if;
  delete from public.staff_whitelist where lower(email) = lower(p_email);
  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'whitelist.delete', lower(p_email), '{}'::jsonb);
end $$;
revoke all on function public.whitelist_delete(text) from public;
revoke all on function public.whitelist_delete(text) from anon;
grant execute on function public.whitelist_delete(text) to authenticated;

-- Pre-seed the known integration slots so the UI can render them with
-- "Not configured" status.
insert into public.app_secrets (name, category, description) values
  ('oneroster_sftp_host',        'oneroster_sftp', 'Infinite Campus SFTP host (e.g. sftp.infinitecampus.com)'),
  ('oneroster_sftp_port',        'oneroster_sftp', 'SFTP port (default 22)'),
  ('oneroster_sftp_username',    'oneroster_sftp', 'SFTP username'),
  ('oneroster_sftp_password',    'oneroster_sftp', 'SFTP password'),
  ('oneroster_sftp_remote_path', 'oneroster_sftp', 'Remote path, e.g. /outbound/oneroster.zip'),
  ('sendgrid_api_key',           'email',          'SendGrid API key (for invitation emails)'),
  ('sendgrid_from_email',        'email',          'From address used for invitation emails')
on conflict (name) do nothing;

notify pgrst, 'reload schema';
select 'integrations vault ready' as status;
