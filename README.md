# HPA Course Growth Assessments

A Supabase-backed React web app for Highland Prep Academies that administers
**Beginning of Course (BOC)** and **End of Course (EOC)** assessments,
ingests OneRoster data from Infinite Campus, and reports BOC→EOC growth.

> **Demo Mode is on by default.** The app ships with a complete in-memory
> dataset so you can preview every flow immediately. Add Supabase credentials
> when you're ready to go live.

---

## Quick start (demo)

The frontend is already running on port 3000 (CRA + craco) under the
preview URL. Visit it and try:

| Path | Login |
|------|-------|
| `/` (Student) | Student ID `100001` … `100030` |
| `/staff/login` | `super@hpa.test` / `Hpa12345!` |
| Other staff demo accounts | `district@hpa.test`, `madison@hpa.test`, `teacher@hpa.test` (same password) |

You can also click any `Reset demo data` button under
**Settings** if Super Admin has signed in.

## Going live with Supabase

1. Read `/app/supabase/README.md`.
2. Run `schema.sql`, `rls_policies.sql`, `storage_buckets.sql`, `seed.sql`,
   then the two RPC files in `/app/supabase/functions/`.
3. Set the two env vars in `/app/frontend/.env`:
   ```
   REACT_APP_SUPABASE_URL=https://<project>.supabase.co
   REACT_APP_SUPABASE_ANON_KEY=<anon public key>
   ```
4. `sudo supervisorctl restart frontend`.

## Deployment checklist (Chromebook)

- Web is already PWA-ready on the responsive 1366×768 layout.
- Pin the URL on managed Chromebooks via **Kiosk** or **Managed Guest Session**.
- Enable Supabase **Auth → Email confirmations OFF** for staff if your
  district issues accounts manually.

## Key flows

- **Student**: enter Student ID → pick course → verify teacher → take BOC/EOC →
  auto-save → submit → confirmation.
- **Admin / District / Campus / Teacher**: dashboard with KPIs + comparison
  charts + question analysis.
- **OneRoster Import**: upload a ZIP from Infinite Campus's
  `EXEC extract_V1P1OneRoster*` procedures. The wizard parses & previews the
  counts, then upserts into operational tables by `sourcedId`.
- **Test Import**: upload booklet + answer key together, optionally a ZIP of
  question images named `q01.png`, `q02.png`, … then commit.

## Tech

- React 19 + react-router-dom 7
- @supabase/supabase-js 2 (with graceful demo-mode fallback)
- jszip + papaparse for OneRoster + answer key parsing in the browser
- Tailwind 3 + shadcn/ui + Recharts + sonner toasts
- Bricolage Grotesque (display) + Outfit (body) — no Inter
