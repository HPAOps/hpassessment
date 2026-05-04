-- =============================================================================
-- Storage buckets + policies
-- =============================================================================
-- Run in Supabase SQL editor AFTER rls_policies.sql.
-- Buckets:
--   oneroster-imports   — original OneRoster ZIP files (PRIVATE)
--   test-booklets       — original quiz booklet files (PRIVATE)
--   answer-keys         — original answer key files (PRIVATE)
--   question-images     — individual question images (PRIVATE, signed URLs)
--   import-files        — temporary parsing scratch (PRIVATE)
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('oneroster-imports', 'oneroster-imports', false),
  ('test-booklets',     'test-booklets',     false),
  ('answer-keys',       'answer-keys',       false),
  ('question-images',   'question-images',   false),
  ('import-files',      'import-files',      false)
on conflict (id) do nothing;

-- District admins may upload/read all assessment-related buckets.
create policy "oneroster: district rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'oneroster-imports' and public.is_district_admin())
  with check (bucket_id = 'oneroster-imports' and public.is_district_admin());

create policy "booklets: district rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'test-booklets' and public.is_district_admin())
  with check (bucket_id = 'test-booklets' and public.is_district_admin());

-- Answer keys: NEVER readable except district admins.
create policy "answer-keys: district rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'answer-keys' and public.is_district_admin())
  with check (bucket_id = 'answer-keys' and public.is_district_admin());

-- Question images:
--   * District admins: full read/write
--   * Authenticated users (incl. students via signed URL): read-only.
create policy "qimages: district write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-images' and public.is_district_admin());

create policy "qimages: district update/delete" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-images' and public.is_district_admin())
  with check (bucket_id = 'question-images' and public.is_district_admin());

create policy "qimages: authenticated read" on storage.objects
  for select to authenticated
  using (bucket_id = 'question-images');

create policy "import-files: district rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'import-files' and public.is_district_admin())
  with check (bucket_id = 'import-files' and public.is_district_admin());
