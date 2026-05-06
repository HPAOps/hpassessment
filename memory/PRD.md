# HPA Course Growth Assessments — Product Requirements

## Original problem statement

A web application called HPA Course Growth Assessments for Highland Prep Academies
to administer Beginning of Course (BOC) and End of Course (EOC) assessments
across multiple campuses. Backend: Supabase (Postgres + Auth + Storage + RLS).
Source-of-truth roster: Infinite Campus OneRoster ZIP exports. Image-based
test items, randomized question order per attempt, BOC→EOC growth %, role
based dashboards (district/campus/teacher), FERPA-conscious, Chromebook-friendly.

## Architecture chosen (v1)

- **React-only frontend** that talks directly to Supabase via the JS client.
- **Demo Mode** (active when env vars are unset) — runs the entire app on
  an in-memory + localStorage store with realistic seed data, so the user
  can experience the full UX immediately.
- **Supabase artifacts** in `/app/supabase/` — schema, RLS, storage, seed,
  and SECURITY DEFINER RPCs for the student flow.
- **No FastAPI backend** is used by the frontend (the template's MongoDB
  server is left untouched but unused).

## User personas

| Persona | Goal |
|---------|------|
| Student | Quickly take the right test for the right course on a Chromebook. |
| Teacher | See completion + growth for my students; reset attempts. |
| Campus Admin | Monitor my campus's completion + growth; reset attempts. |
| District Admin | Compare campuses, courses, teachers; manage tests + imports. |
| Super Admin | Everything + settings + role management. |

## Phase A — Microsoft SSO (completed 2026-02)

- Multi-tenant Microsoft Entra ID OAuth for staff login.
- `staff_whitelist` table + `handle_oauth_signup` trigger: unknown emails
  are rejected at Supabase Auth level, known emails get a `profiles` row
  with the pre-assigned role/campus/teacher mapping.
- Break-glass email/password login retained for emergencies.

## v2 simplifications (in progress 2026-02)

- Item 1: OneRoster sync now filters out non-active users at mapping time.
- Item 2: Users page → Staff tab now reads from `staff_whitelist` (real
  signed-in staff + auto-synced teachers), no more demo array.
- Item 3: New `v2_simplifications.sql` deletes seed students, teachers,
  tests, courses, sections, terms, and seed campuses (`OR-S-`, `OR-T-`,
  `OR-COURSE-`, etc.).
- Item 4: Tests are course-level (1 test = many sections at many campuses);
  Tests page shows section count badge per test.
- Item 5: `OneRoster Import` removed from nav (route still works for fallback).
- Item 6: Single test row carries BOTH `boc_opens_at/closes_at` + `eoc_opens_at/closes_at`.
  `test_attempts.phase` enum (BOC|EOC) auto-set from current date.
  `submit_attempt` pairs BOC/EOC by SAME `test_id` for growth calc.
- Item 7: `delete_test(uuid)` RPC + UI button (super_admin only, full cascade).
- **Status**: code complete; pending user execution of `v2_simplifications.sql`
  and Edge Function redeploy.

## Phase C — OneRoster REST API sync (completed 2026-02)

- Pivoted from SFTP to OneRoster v1.2 REST API after Infinite Campus
  provided OAuth 2.0 client_credentials rather than SFTP access.
- Supabase Edge Function `oneroster-api-sync` (Deno) fetches orgs,
  academicSessions, courses, classes, users, enrollments; upserts into
  operational tables; records a `sync_runs` row.
- `app_secrets` slots: `oneroster_api_client_id`, `oneroster_api_client_secret`,
  `oneroster_api_token_url`, `oneroster_api_base_url`. Service-role-only
  read via `secrets_read_for_service(text)`.
- `pg_cron` schedule: 08:00 UTC (1 AM AZ) + 03:00 UTC (8 PM AZ). Stored
  Edge Function URL + service key in `app_secrets` so nothing is hardcoded.
- Frontend: "Run sync now" button on the OneRoster card (super_admin only)
  with live toast + row-count summary.
- **v6 (2026-02)**: Replaced bulk `.in('col', [4000+ ids])` lookups with a
  chunked `upsert(...).select(...)` pipeline (`upsertChunked` helper) so id
  maps are harvested from the upsert response itself in 500-row batches.
  Fixes the PostgREST URL-length crash on real-world rosters and lets
  `course_sections` / `student_enrollments` / `teacher_class_assignments`
  populate cleanly. `staff` table is upserted alongside `teachers`/`students`.
- **Status**: code complete. Pending user redeploy of `index.dashboard.ts`
  to the Supabase Dashboard and a fresh "Run sync now" to verify.

## Phase B — Secrets vault + Integrations admin (completed 2026-02)

- `public.app_secrets` table (super-admin RLS), pre-seeded with OneRoster
  SFTP and SendGrid slots.
- RPCs: `secrets_list()` (masked), `secret_set()`, `secret_clear()`,
  `secret_delete()`, `whitelist_list()`, `whitelist_delete()`.
- Secret values are never returned to the browser; only `configured: bool`
  status + last-rotated metadata. Every write logs to `audit_logs`.
- `/admin/integrations` UI with three tabs: **Integrations** (OneRoster SFTP,
  SendGrid), **Staff Access** (whitelist CRUD), **SSO** (Microsoft status).
- Verified end-to-end: super admin login → page loads → RPCs return data →
  Configure dialog opens → whitelist renders 7 existing rows.

## Phase D — OneRoster reliability + Sections page (2026-02)

- **v6 → v10 sync hardening** (`oneroster-api-sync` Edge Function):
  - v6: chunked `upsert(...).select()` to kill PostgREST URL-length crash on
    4000+ ids (replaces big `.in()` lookups).
  - v7: per-reason drop counters (`*_missing_student`, `*_missing_section`,
    `*_missing_both`) + permissive secondary-role fallback.
  - v8: aides routed to `staff` (not `teachers`); enrollment-derived `school`
    used as primary candidate to fix users whose `primaryOrg` is the
    auto-generated district office.
  - v9: multi-candidate campus resolution (enrollments → primary role org →
    other roles → primaryOrg → orgs[]); rescue pass re-classifies users
    referenced by `role=student` enrollments even if their primary role is
    guardian/relative/empty.
  - v10: process `tobedeleted` users with `is_active=false` so their
    enrollments still link; deterministic `sync_runs.details.campus_resolution`
    diagnostic dump (orphan sample, candidate sid frequency, status
    breakdown).
- **Campuses page accuracy fix** — `listStudents()` was capped at Supabase's
  default 1000-row limit, silently truncating per-campus totals. Added
  `getCampusCounts()` that uses per-campus `count: 'exact', head: true`
  filtered to `is_active = true`. Counts now match Clever's source-of-truth.
- **`teachers.oneroster_role`** column + reclassification SQL moved 18 aides
  from `teachers` to `staff`.
- **`question-images` storage bucket** SQL ready (snake_case policies, public
  read for `anon` student flow).
- **.docx image extraction** — added auto-numbered list mode to
  `docxImages.js`. Word's `<w:numPr>` paragraph references are now detected
  when literal "1)" markers don't exist in the text. Verified against the
  Biology booklet (42 questions, 42 images, clean 1:1 mapping).

## Phase E — Sections page (2026-02)

- New `/admin/sections` index page and `/admin/sections/:id` roster page.
- Visibility enforced by existing RLS:
  - **super_admin** / **district_admin** — every section
  - **campus_admin** — only sections at their campus
  - **teacher** — only sections in their `teacher_class_assignments`
- Index columns: course title + code, section code, campus, teacher(s),
  enrollment count, "Roster →" link.
- Roster columns (per the user's request): last name, first name, Student ID,
  grade level. Filter active students only. Search by name or Student ID.
- Nav: new top-level "Sections" item visible to all 4 staff roles.
- Reuses RPC-free Supabase REST joins (`course_sections.select(courses,
  campuses, teacher_class_assignments(teachers), student_enrollments(count))`)
  so no new DB migrations needed.

## Implemented (v1) — completion date 2026-02

- Student flow: ID login → course picker → teacher verify → test selector →
  image-based test (zoom, prev/next, navigator, autosave) → submit confirm.
  **End-to-end verified by testing agent (iteration_2).**
- Auto-scoring with growth % (((EOC-BOC)/(100-BOC))*100).
- Random question order per attempt, preserved on the attempt record.
- Admin dashboards (District / Campus / Teacher) with Recharts (campus comparison,
  course BOC vs EOC, growth distribution). **Campus admin scoping verified.**
- OneRoster ZIP import wizard (jszip + papaparse) with parse → preview → commit.
- Test import wizard (booklet + answer key + question images / ZIP).
- Question Bank manager (per-test grid, replace, bulk filename matching).
- Answer Key editor (table + bulk paste).
- Reports: per-student, by course, by teacher, question analysis with
  most-common-wrong, missing-BOC/EOC lists.
- Audit log (filterable).
- Settings (district-wide toggles) with super-admin reset for demo data.
- Campuses + Users browse pages.
- Test preview page (admin walks through the test).
- Full Supabase artifacts: schema.sql, rls_policies.sql, storage_buckets.sql,
  seed.sql, student_login.sql RPC, score_attempt.sql RPCs (start, save, submit,
  reset).

## Backlog (v2)

- **P0**: PWA service worker + manifest for Chromebook kiosk install.
- **P1**: Question booklet auto-splitter (PDF/Docx → q01.png … qNN.png).
- **P2**: CSV / PDF report exports.
- **P2**: Standards-tagged item analysis dashboard.
- **P2**: Student accommodations (TTS, larger text, extra time per IEP).
- **P3**: Longitudinal multi-year growth tracking.

## Open questions

- Which OneRoster `version` does Infinite Campus emit by default for HPA
  (1.1 or 1.2)? Mapping handles both; needs verification with real data.
- Will the district issue Chromebooks per student or shared kiosks?
  Affects whether to use Supabase auth tokens or Student-ID-only flow.
