-- =============================================================================
-- HPA — Sync Runs tracking
-- =============================================================================
-- Tracks every integration sync (OneRoster ZIP upload, future SFTP cron,
-- email send batches, etc.) with uniform status + row counts. Powers the
-- "Last successful sync" banners on Integrations and Dashboard pages.
-- Idempotent — safe to re-run.
-- =============================================================================

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  category text not null,                  -- e.g. 'oneroster_sftp', 'email'
  source text not null,                    -- 'manual_zip' | 'sftp_cron' | 'api'
  status text not null,                    -- 'success' | 'failed' | 'partial' | 'running'
  started_at timestamptz default now(),
  completed_at timestamptz,
  row_counts jsonb default '{}'::jsonb,    -- {students: 300, enrollments: 1200}
  error_message text,
  actor_id uuid references auth.users(id),
  actor_email text,
  details jsonb default '{}'::jsonb,       -- freeform: filename, remote path, etc.
  created_at timestamptz default now()
);

create index if not exists idx_sync_runs_cat_started
  on public.sync_runs (category, started_at desc);
create index if not exists idx_sync_runs_started
  on public.sync_runs (started_at desc);

alter table public.sync_runs enable row level security;

drop policy if exists sync_runs_staff_read on public.sync_runs;
create policy sync_runs_staff_read on public.sync_runs
  for select using (auth.role() = 'authenticated' and public.app_role() is not null);

drop policy if exists sync_runs_authenticated_insert on public.sync_runs;
create policy sync_runs_authenticated_insert on public.sync_runs
  for insert with check (auth.role() = 'authenticated');

-- Record a completed sync (success or failure). Called from the frontend
-- when a manual OneRoster ZIP import finishes, and from Edge Functions
-- after scheduled SFTP pulls.
create or replace function public.record_sync_run(
  p_category text,
  p_source text,
  p_status text,
  p_row_counts jsonb,
  p_error_message text default null,
  p_details jsonb default '{}'::jsonb,
  p_started_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public as $$
declare
  v_id uuid;
  v_started timestamptz := coalesce(p_started_at, now());
begin
  if p_category is null or length(trim(p_category)) = 0 then
    raise exception 'category required';
  end if;
  if p_status not in ('success', 'failed', 'partial', 'running') then
    raise exception 'invalid status %', p_status;
  end if;

  insert into public.sync_runs (
    category, source, status,
    started_at, completed_at,
    row_counts, error_message, actor_id, actor_email, details
  ) values (
    p_category, p_source, p_status,
    v_started,
    case when p_status in ('running') then null else now() end,
    coalesce(p_row_counts, '{}'::jsonb),
    p_error_message,
    auth.uid(), auth.email(),
    coalesce(p_details, '{}'::jsonb)
  ) returning id into v_id;

  return v_id;
end $$;

revoke all on function public.record_sync_run(text, text, text, jsonb, text, jsonb, timestamptz) from public;
revoke all on function public.record_sync_run(text, text, text, jsonb, text, jsonb, timestamptz) from anon;
grant execute on function public.record_sync_run(text, text, text, jsonb, text, jsonb, timestamptz) to authenticated;

-- Latest run per category — one row per category, most recent first.
create or replace function public.sync_runs_latest()
returns table (
  category text,
  source text,
  status text,
  started_at timestamptz,
  completed_at timestamptz,
  row_counts jsonb,
  error_message text,
  actor_email text,
  details jsonb
)
language sql
stable
security definer
set search_path = public as $$
  select distinct on (category)
    category, source, status,
    started_at, completed_at,
    row_counts, error_message, actor_email, details
  from public.sync_runs
  order by category, started_at desc;
$$;

revoke all on function public.sync_runs_latest() from public;
revoke all on function public.sync_runs_latest() from anon;
grant execute on function public.sync_runs_latest() to authenticated;

-- Recent run history (for audit / troubleshooting tabs). Limited to 100.
create or replace function public.sync_runs_recent(p_category text default null, p_limit int default 50)
returns setof public.sync_runs
language sql
stable
security definer
set search_path = public as $$
  select * from public.sync_runs
  where (p_category is null or category = p_category)
  order by started_at desc
  limit least(coalesce(p_limit, 50), 100);
$$;

revoke all on function public.sync_runs_recent(text, int) from public;
revoke all on function public.sync_runs_recent(text, int) from anon;
grant execute on function public.sync_runs_recent(text, int) to authenticated;

notify pgrst, 'reload schema';
select 'sync runs ready' as status;
