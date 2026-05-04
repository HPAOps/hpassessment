-- =============================================================================
-- HPA — Microsoft SSO staff whitelist + auto-provisioning + tenant enforcement
-- =============================================================================
-- Run AFTER configuring the Supabase Azure provider (Auth → Providers → Azure).
-- This lets ONLY pre-approved staff emails sign in via Microsoft, regardless
-- of which tenant the email belongs to. Also auto-creates the matching
-- public.profiles row the first time they authenticate.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Staff whitelist table
-- ---------------------------------------------------------------------------
create table if not exists public.staff_whitelist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role user_role not null default 'teacher',
  campus_id uuid references public.campuses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  tenant_hint text,                         -- optional note, e.g. 'MHP' / 'HPW'
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_staff_whitelist_email_lower
  on public.staff_whitelist ((lower(email)));

alter table public.staff_whitelist enable row level security;

drop policy if exists "whitelist_super_rw" on public.staff_whitelist;
drop policy if exists "whitelist_district_read" on public.staff_whitelist;

create policy "whitelist_super_rw" on public.staff_whitelist
  for all using (public.is_super_admin()) with check (public.is_super_admin());
create policy "whitelist_district_read" on public.staff_whitelist
  for select using (public.is_district_admin());

-- ---------------------------------------------------------------------------
-- 2) Trigger: on new auth.users (from Microsoft SSO), create profile row.
-- Rejects users whose email isn't on the whitelist.
-- Also logs tenant ID to audit_logs for FERPA audit trail.
-- ---------------------------------------------------------------------------
create or replace function public.handle_oauth_signup()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_wl public.staff_whitelist%rowtype;
  v_provider text;
  v_tenant text;
  v_name text;
begin
  -- Only act on OAuth sign-ups (provider != 'email'). Email/password users
  -- are bootstrapped manually via staff_bootstrap.sql and already have profiles.
  v_provider := coalesce(new.raw_app_meta_data->>'provider', 'email');
  if v_provider = 'email' then
    return new;
  end if;

  -- Allow only the Azure/Microsoft provider for now (future-proofing)
  if v_provider not in ('azure', 'microsoft') then
    raise exception 'Sign-in provider % is not allowed. Contact your district admin.', v_provider
      using errcode = '42501';
  end if;

  -- Extract Azure tenant from the issuer claim, e.g.
  --   https://login.microsoftonline.com/{tid}/v2.0
  v_tenant := substring(coalesce(new.raw_user_meta_data->>'iss',''),
                        'login\.microsoftonline\.com/([0-9a-f\-]{36})');

  -- Whitelist check (case-insensitive email)
  select * into v_wl from public.staff_whitelist
  where lower(email) = lower(new.email);

  if not found then
    raise exception 'Email % is not authorized for HPA Growth Assessments. Please contact your district admin.', new.email
      using errcode = '42501';
  end if;

  v_name := coalesce(
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'full_name',
    trim(concat_ws(' ', new.raw_user_meta_data->>'given_name', new.raw_user_meta_data->>'family_name')),
    new.email
  );

  -- Create / update the profile
  insert into public.profiles (id, email, name, role, campus_id, teacher_id, is_active)
  values (new.id, new.email, v_name, v_wl.role, v_wl.campus_id, v_wl.teacher_id, true)
  on conflict (id) do update
    set email = excluded.email, name = excluded.name, role = excluded.role,
        campus_id = excluded.campus_id, teacher_id = excluded.teacher_id,
        updated_at = now();

  -- FERPA audit entry (never fails the signup)
  begin
    insert into public.audit_logs (actor_id, actor_email, action, target, details)
    values (new.id, new.email, 'auth.sso.signup', new.email,
            jsonb_build_object(
              'provider', v_provider,
              'tenant_id', v_tenant,
              'role_assigned', v_wl.role::text
            ));
  exception when others then null;
  end;

  return new;
end $$;

-- Attach trigger to auth.users
drop trigger if exists on_auth_user_created_oauth on auth.users;
create trigger on_auth_user_created_oauth
  after insert on auth.users
  for each row execute function public.handle_oauth_signup();

-- ---------------------------------------------------------------------------
-- 3) Helper RPC for the super-admin UI to manage the whitelist
-- ---------------------------------------------------------------------------
create or replace function public.whitelist_upsert(
  p_email text, p_role user_role,
  p_campus_id uuid, p_teacher_id uuid, p_tenant_hint text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only super admin can edit whitelist' using errcode = '42501';
  end if;
  insert into public.staff_whitelist (email, role, campus_id, teacher_id, tenant_hint, created_by)
  values (lower(p_email), p_role, p_campus_id, p_teacher_id, p_tenant_hint, auth.uid())
  on conflict ((lower(email))) do update
    set role = excluded.role, campus_id = excluded.campus_id,
        teacher_id = excluded.teacher_id, tenant_hint = excluded.tenant_hint,
        updated_at = now();

  insert into public.audit_logs (actor_id, actor_email, action, target, details)
  values (auth.uid(), auth.email(), 'whitelist.upsert', lower(p_email),
          jsonb_build_object('role', p_role::text, 'tenant', p_tenant_hint));
end $$;
revoke all on function public.whitelist_upsert(text, user_role, uuid, uuid, text) from public, anon;
grant execute on function public.whitelist_upsert(text, user_role, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Seed whitelist with the 4 existing test accounts so they keep working
--    when we migrate them off email/password later. Safe no-op if re-run.
-- ---------------------------------------------------------------------------
insert into public.staff_whitelist (email, role, campus_id, teacher_id, tenant_hint)
values
  ('super@hpa.test',    'super_admin',    null, null, 'break-glass'),
  ('district@hpa.test', 'district_admin', null, null, 'break-glass'),
  ('madison@hpa.test',  'campus_admin',
     (select id from public.campuses where oneroster_org_sourced_id = 'OR-MHP'),
     null, 'Madison HP'),
  ('teacher@hpa.test',  'teacher',
     (select id from public.campuses where oneroster_org_sourced_id = 'OR-MHP'),
     (select id from public.teachers where oneroster_user_sourced_id = 'OR-T-1'),
     'Madison HP')
on conflict ((lower(email))) do nothing;

notify pgrst, 'reload schema';
select 'microsoft sso staff whitelist ready' as status;
