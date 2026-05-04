# Supabase setup for HPA Course Growth Assessments

This folder contains every SQL artifact you need to spin up the Supabase backend.
The React frontend in `/app/frontend` is already wired to call Supabase using
`REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` env vars. Until those
are set, the app runs in **Demo Mode** with an in-memory dataset.

## 1. Create a Supabase project
1. Go to <https://supabase.com> → **New project**.
2. Pick a strong DB password and a region close to your school.

## 2. Run the SQL scripts (in order)
Open the **SQL Editor** in the Supabase dashboard and run each file:

1. `schema.sql`        – tables, enums, indexes
2. `rls_policies.sql`  – Row Level Security helpers + policies
3. `storage_buckets.sql` – buckets + storage policies
4. `seed.sql`          – seed campuses & placeholder courses
5. `functions/student_login.sql`  – `student_lookup(text)` RPC
6. `functions/score_attempt.sql`  – attempt/scoring RPCs

> Tip: each script is idempotent — safe to re-run.

## 3. Create staff accounts
For each staff role (super_admin / district_admin / campus_admin / teacher):

```sql
-- 1. Create the auth user (Supabase Dashboard → Authentication → Users → "Add user")
--    OR via the Auth API. Then insert their profile:
insert into public.profiles (id, email, name, role, campus_id)
values (
  '<auth.users.id>',
  'super@hpa.test',
  'Sam Powell',
  'super_admin',
  null
);
```

Repeat for each user. Campus admins must set `campus_id`. Teachers must set
`teacher_id` (the operational `teachers.id`).

## 4. Wire the frontend
Edit `/app/frontend/.env`:

```
REACT_APP_SUPABASE_URL=https://<project>.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<anon public key>
```

Restart the frontend (`sudo supervisorctl restart frontend`). The "Demo Mode"
badge in the header will disappear once both vars are set.

## 5. Optional — Edge Functions (v2)
The `student_lookup`, `start_or_get_attempt`, `save_response`, and
`submit_attempt` RPCs handle the hot paths securely. You can also wrap
OneRoster ingest in a Supabase Edge Function for scheduled/SFTP imports.

## 6. Buckets
- `oneroster-imports` – original OneRoster ZIPs (district-only)
- `test-booklets`     – original quiz files (district-only)
- `answer-keys`       – original answer key files (**never** student-readable)
- `question-images`   – question imagery (signed URL access for students)
- `import-files`      – scratch files

## 7. FERPA notes
- All student-data tables enable RLS; default policies deny everything.
- Answer keys are isolated in `public.answer_keys` and `storage.bucket = 'answer-keys'`
  with district-only policies so students can never read them.
- Audit log records imports, key changes, and resets.
- Use the `student_lookup` RPC for the Student-ID-only login flow so the
  anon key cannot enumerate students.
