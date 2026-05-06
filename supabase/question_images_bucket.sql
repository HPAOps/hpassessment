-- =============================================================================
-- HPA -- question-images bucket creation (idempotent)
-- =============================================================================
-- Run this in the Supabase SQL editor (super_admin) any time you see image
-- upload errors in TestImport.jsx ("bucket not found"). It is safe to re-run.
--
-- Why PUBLIC? Students take tests via Student-ID-only (anon). The frontend
-- (api.js) calls getPublicUrl() to render images during the test, which only
-- works on a public bucket. Question images are NOT sensitive (only answer
-- keys are, and those live in the separate `answer-keys` bucket which stays
-- strictly private).
-- =============================================================================

-- 1) Create the bucket as PUBLIC and bump it to public if it already exists.
insert into storage.buckets (id, name, public)
values ('question-images', 'question-images', true)
on conflict (id) do update set public = true;

-- 2) Drop any existing policies on this bucket so we start clean.
do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'qimages: district write',
        'qimages: district update/delete',
        'qimages: authenticated read',
        'qimages: public read'
      )
  loop
    execute format('drop policy if exists %I on storage.objects;', p.policyname);
  end loop;
end$$;

-- 3) Re-create the policies. Public read so anon students can render images.
create policy "qimages: public read" on storage.objects
  for select to public
  using (bucket_id = 'question-images');

create policy "qimages: district write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-images' and public.is_district_admin());

create policy "qimages: district update/delete" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-images' and public.is_district_admin())
  with check (bucket_id = 'question-images' and public.is_district_admin());

create policy "qimages: district delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-images' and public.is_district_admin());

select 'question-images bucket ready (public read, district-admin write)' as status;
