-- =============================================================================
-- HPA — OneRoster REST API pivot (Phase C)
-- =============================================================================
-- Adds the OneRoster v1.2 REST API secret slots and a SECURITY DEFINER RPC
-- that returns the decrypted values to the service-role Edge Function only.
-- Also installs the pg_cron schedule (1 AM + 8 PM AZ time = 08:00 + 03:00 UTC).
-- Safe to re-run.
-- =============================================================================

-- 1) Secret slots for REST API (replaces SFTP fields in UI; SFTP rows remain
--    harmless if left over — Integrations page only reads the ones in the
--    frontend catalog).
insert into public.app_secrets (name, category, description) values
  ('oneroster_api_client_id',     'oneroster_api', 'OneRoster OAuth 2.0 client ID'),
  ('oneroster_api_client_secret', 'oneroster_api', 'OneRoster OAuth 2.0 client secret'),
  ('oneroster_api_token_url',     'oneroster_api', 'OAuth token URL (e.g. https://.../campus/oauth2/token?appName=hpa)'),
  ('oneroster_api_base_url',      'oneroster_api', 'OneRoster 1.2 base URL (e.g. https://.../campus/api/oneroster/v1p2/hpa/ims/oneroster)')
on conflict (name) do nothing;

-- 2) RPC that reads raw secret values — callable only by the postgres/service
--    role (Edge Function runtime) via pg_net headers. NOT granted to
--    authenticated users. The auth check uses current_setting('role').
create or replace function public.secrets_read_for_service(p_category text)
returns table(name text, value text)
language plpgsql
security definer
set search_path = public as $$
begin
  -- Only the service_role (or direct postgres admin) may call this. Normal
  -- browser-authenticated users will be blocked here even if they invoke it.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'secrets_read_for_service is restricted to service role'
      using errcode = '42501';
  end if;
  return query
    select s.name, s.value from public.app_secrets s
     where s.category = p_category
       and s.value is not null
       and length(s.value) > 0;
end $$;

revoke all on function public.secrets_read_for_service(text) from public, anon, authenticated;
-- service_role bypasses RLS and has implicit execute on public funcs by default,
-- but we make the grant explicit for clarity:
grant execute on function public.secrets_read_for_service(text) to service_role;

-- 3) Enable the pg_net + pg_cron extensions (Supabase ships them preinstalled).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- 4) Store the Edge Function URL + service-role token in app_secrets so the
--    cron job can invoke the function without hardcoding anything.
insert into public.app_secrets (name, category, description) values
  ('edge_oneroster_sync_url',   'internal', 'Full URL to oneroster-api-sync Edge Function'),
  ('edge_service_role_key',     'internal', 'Supabase service_role key used by pg_cron to call Edge Functions')
on conflict (name) do nothing;

-- 5) Helper function that pg_cron will call. Reads the URL + key at runtime so
--    we never hardcode secrets. Idempotent: re-running does nothing harmful.
create or replace function public.cron_trigger_oneroster_sync()
returns void
language plpgsql
security definer
set search_path = public, extensions as $$
declare
  v_url text;
  v_key text;
begin
  select value into v_url from public.app_secrets where name = 'edge_oneroster_sync_url';
  select value into v_key from public.app_secrets where name = 'edge_service_role_key';
  if v_url is null or v_key is null then
    raise notice 'cron_trigger_oneroster_sync skipped: edge URL or service key not configured';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object('source', 'cron')
  );

  insert into public.audit_logs (actor_email, action, target, details)
  values ('system@cron', 'oneroster.cron.fired', 'oneroster-api-sync',
          jsonb_build_object('url', v_url));
end $$;

revoke all on function public.cron_trigger_oneroster_sync() from public, anon, authenticated;

-- 6) (Re)install the two daily schedules. AZ (MST, no DST) = UTC-7.
--    1 AM AZ = 08:00 UTC · 8 PM AZ = 03:00 UTC
do $$
begin
  perform cron.unschedule('hpa-oneroster-sync-morning');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('hpa-oneroster-sync-evening');
exception when others then null;
end $$;

select cron.schedule(
  'hpa-oneroster-sync-morning',
  '0 8 * * *',
  $$select public.cron_trigger_oneroster_sync();$$
);
select cron.schedule(
  'hpa-oneroster-sync-evening',
  '0 3 * * *',
  $$select public.cron_trigger_oneroster_sync();$$
);

notify pgrst, 'reload schema';
select 'oneroster api + cron ready' as status;
