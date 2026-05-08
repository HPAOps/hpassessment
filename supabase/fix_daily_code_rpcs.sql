-- =============================================================================
-- HPA -- Patch the daily-code RPCs.
-- 1. get_or_create_daily_code: idempotent under concurrent calls (use a
--    SELECT … FOR UPDATE + advisory lock so two simultaneous teachers
--    clicking "Code" can't both INSERT and trigger a 23505 unique violation).
-- 2. redeem_test_code: invalid-code raises with errcode 22023 so PostgREST
--    returns HTTP 400 (not 401) -- 401 was misleading observability tools
--    into thinking it was an auth failure.
-- =============================================================================

create or replace function public.get_or_create_daily_code(p_test_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_row public.test_codes%rowtype;
  v_code text;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid()
      and role in ('super_admin','district_admin','campus_admin','teacher')
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Use a transaction-scoped advisory lock so concurrent callers serialize
  -- on the (test, day) tuple. Eliminates the SELECT-then-INSERT race that
  -- caused 50% of clicks to throw 23505 against the unique index.
  perform pg_advisory_xact_lock(
    hashtext(p_test_id::text || ':' || v_today::text)
  );

  -- After acquiring the lock, re-check.
  select * into v_row from public.test_codes
   where test_id = p_test_id and valid_on_date = v_today
     and for_student_id is null and is_active = true
   order by created_at desc limit 1;
  if found then return to_jsonb(v_row); end if;

  v_code := public.generate_test_code(6);
  insert into public.test_codes (test_id, code, valid_on_date, source, created_by_email)
  values (p_test_id, v_code, v_today, 'auto',
          (select email from auth.users where id = auth.uid()))
  returning * into v_row;
  return to_jsonb(v_row);
end $$;
revoke all on function public.get_or_create_daily_code(uuid) from public;
grant execute on function public.get_or_create_daily_code(uuid) to authenticated;

-- redeem_test_code: invalid code -> HTTP 400 (errcode 22023) instead of 401.
create or replace function public.redeem_test_code(
  p_code text, p_student_db_id uuid, p_test_id uuid, p_section_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_normalized text := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  v_code public.test_codes%rowtype;
  v_today date := (now() at time zone 'America/Phoenix')::date;
begin
  if length(v_normalized) = 0 then
    raise exception 'Please enter the test code from your teacher.'
      using errcode = '22023';
  end if;

  select * into v_code from public.test_codes
   where upper(code) = v_normalized
     and is_active = true
     and test_id = p_test_id
     and valid_on_date = v_today
     and (for_student_id is null or for_student_id = p_student_db_id)
     and (for_student_id is null or used_at is null)
   order by created_at desc limit 1;

  if not found then
    raise exception 'That test code is not valid for today. Ask your teacher to confirm the code, or for a fresh one.'
      using errcode = '22023';
  end if;

  if v_code.for_student_id is not null then
    update public.test_codes
       set used_at = now(), used_by_student_id = p_student_db_id
     where id = v_code.id;
  end if;

  return public.start_or_get_attempt(p_student_db_id, p_test_id, p_section_id);
end $$;
revoke all on function public.redeem_test_code(text, uuid, uuid, uuid) from public;
grant execute on function public.redeem_test_code(text, uuid, uuid, uuid) to anon, authenticated;

select 'P1 daily-code RPC patches applied' as status;
