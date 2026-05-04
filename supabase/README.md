# Supabase setup for HPA Course Growth Assessments

Your project: **https://soaagmzmecutvlxfbscl.supabase.co**
SQL editor: https://supabase.com/dashboard/project/soaagmzmecutvlxfbscl/sql/new

---

## TL;DR — paste these three scripts in order

| Order | File | What it does |
|------:|------|--------------|
| 1 | `full_setup.sql` | Schema, RLS, storage buckets, RPC functions, minimal seed (idempotent) |
| 2 | `extended_seed.sql` | 22 courses, 5 teachers, 30 students (IDs 100001–100030), 5 tests, ~42 questions |
| 3 | `staff_bootstrap.sql` | Inserts 4 staff `profiles` rows — **edit the 4 UUIDs first** |

Between **2** and **3** you create the staff auth users in the dashboard (see below).

---

## 1. Run `full_setup.sql`

1. Open https://supabase.com/dashboard/project/soaagmzmecutvlxfbscl/sql/new
2. Open `/app/supabase/full_setup.sql` in this workspace, copy its contents,
   paste into the editor, and **Run**.
3. Confirm you see **Success. No rows returned.** (or similar, with no errors).

This creates:
- All tables: `profiles`, `campuses`, `school_years`, `terms`, `courses`,
  `course_sections`, `teachers`, `students`, `student_enrollments`,
  `teacher_class_assignments`, `tests`, `test_windows`, `questions`,
  `question_images`, `answer_keys`, `test_imports`, `test_import_files`,
  `test_attempts`, `test_attempt_questions`, `student_responses`,
  `growth_results`, `audit_logs`, `app_settings` + the 11 OneRoster
  staging tables.
- ENUMs: `user_role`, `test_type_enum`, `attempt_status`, `answer_letter`.
- RLS policies on every sensitive table (district_admin / campus_admin /
  teacher / student scoping; answer_keys district-only).
- Storage buckets: `oneroster-imports`, `test-booklets`, `answer-keys`,
  `question-images`, `import-files` + their access policies.
- RPCs: `public.student_lookup(text)`, `public.start_or_get_attempt(uuid,uuid,uuid)`,
  `public.save_response(uuid,uuid,answer_letter)`, `public.submit_attempt(uuid)`,
  `public.reset_attempt(uuid,text)`.
- Seed: 3 campuses (Madison Highland Prep, Highland Prep, Highland Prep West),
  Algebra 1A + 1B placeholder courses, 2026–2027 school year.

## 2. Run `extended_seed.sql` (recommended)

Same SQL editor → paste `/app/supabase/extended_seed.sql` → **Run**.

Adds:
- 22 courses (Algebra 1A/1B, Algebra 2A/2B, Geometry A/B, Pre-Calc A/B,
  Biology A/B, Chemistry A/B, Physics A/B, English 9A/9B/10A/10B,
  World History A/B, US History A/B)
- 5 teachers (Alicia Reyes, Marcus Tran, Priya Iyer, Jordan Whitfield,
  Sofia Becerra) with campus assignments
- 6 course sections + teacher assignments
- 30 students (Student IDs `100001`–`100030`) distributed across the
  3 campuses, each enrolled in their campus's Algebra 1A; about half
  also in Algebra 1B
- 5 tests (Algebra 1A BOC + EOC, Algebra 1B BOC + EOC, Biology A BOC),
  windows live (today − 30 days → today + 60 days)
- ~42 questions (placeholder picsum.photos images, deterministic
  correct answers cycled A/B/C/D)

## 3. Create staff auth users

Authentication → Users → **Add user** four times. For each, choose any
password you like. Copy the resulting **UUID** from the Users table.

Suggested emails (or use anything you like — they're just labels):
- `super@hpa.test` — super admin
- `district@hpa.test` — district admin
- `madison@hpa.test` — campus admin (Madison Highland Prep)
- `teacher@hpa.test` — teacher (Alicia Reyes at Madison)

> Tip: if Email confirmations are on, either disable them in
> Authentication → Settings, or click "Send invite" then mark the user
> confirmed manually.

## 4. Run `staff_bootstrap.sql`

Open `/app/supabase/staff_bootstrap.sql` and replace the four
`00000000-0000-0000-0000-00000000000X` UUIDs with the real `auth.users.id`
values you just copied. Then paste + **Run**.

The final `select` at the bottom should return **4 rows**.

## 5. Flip the React app to live mode

Edit `/app/frontend/.env`:

```
REACT_APP_SUPABASE_URL=https://soaagmzmecutvlxfbscl.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOi...   # already set
REACT_APP_FORCE_DEMO=false
```

Restart the frontend so it picks up the new env:

```
sudo supervisorctl restart frontend
```

The "Demo Mode" badge in the top-right of the admin shell will disappear.

---

## How RLS works in this app

- `auth.uid()` → looks up `public.profiles` to derive role + scope
- Helper functions: `public.app_role()`, `public.is_super_admin()`,
  `public.is_district_admin()`, `public.current_campus_id()`,
  `public.current_teacher_id()`
- Students use the **anon key only** (no auth user). The student-id flow
  goes through `public.student_lookup(text)` which is `SECURITY DEFINER`
  and grants execute to `anon, authenticated` so it bypasses RLS for
  exactly what's needed.
- Answer keys live in `public.answer_keys` and the `answer-keys` bucket;
  both are locked to `is_district_admin()` only.

## Troubleshooting

- **Policy already exists** errors on re-run: drop the policy first
  (`drop policy "<name>" on <table>;`) or drop the schema and re-run.
- **`current_role` reserved word** errors: should not happen — the
  helper is named `app_role()` to avoid the Postgres built-in.
- Storage upload errors: confirm the bucket policies created (each
  bucket has `for all to authenticated using (bucket_id = '…' and …)`).

## Files in this folder

```
schema.sql              ← part of full_setup.sql (Sec. 1)
rls_policies.sql        ← part of full_setup.sql (Sec. 2)
storage_buckets.sql     ← part of full_setup.sql (Sec. 3)
functions/
  student_login.sql     ← part of full_setup.sql (Sec. 4)
  score_attempt.sql     ← part of full_setup.sql (Sec. 4)
seed.sql                ← part of full_setup.sql (Sec. 5)
full_setup.sql          ← consolidated, paste this
extended_seed.sql       ← optional, adds demo data
staff_bootstrap.sql     ← edit UUIDs, then paste
README.md               ← this file
```
