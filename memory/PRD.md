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

## Implemented (v1) — completion date 2026-02

- Student flow: ID login → course picker → teacher verify → test selector →
  image-based test (zoom, prev/next, navigator, autosave) → submit confirm.
- Auto-scoring with growth % (((EOC-BOC)/(100-BOC))*100).
- Random question order per attempt, preserved on the attempt record.
- Admin dashboards (District / Campus / Teacher) with Recharts (campus comparison,
  course BOC vs EOC, growth distribution).
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

- **P0**: Real Supabase wiring + creating staff users via Supabase auth.
- **P1**: Direct Infinite Campus API + scheduled SFTP roster sync.
- **P1**: PWA service worker + manifest for Chromebook kiosk install.
- **P1**: Question booklet auto-splitter (PDF/Docx → q01.png … qNN.png).
- **P2**: CSV / PDF report exports.
- **P2**: Standards-tagged item analysis dashboard.
- **P2**: Student accommodations (TTS, larger text, extra time per IEP).
- **P2**: Microsoft SSO for staff.
- **P3**: Longitudinal multi-year growth tracking.

## Open questions

- Which OneRoster `version` does Infinite Campus emit by default for HPA
  (1.1 or 1.2)? Mapping handles both; needs verification with real data.
- Will the district issue Chromebooks per student or shared kiosks?
  Affects whether to use Supabase auth tokens or Student-ID-only flow.
