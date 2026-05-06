# Phase C — OneRoster REST API Sync · Deployment Guide

This doc walks you through enabling automatic nightly roster sync with
Infinite Campus via the OneRoster v1.2 REST API. Everything is idempotent
and the secrets never leave Supabase.

---

## Architecture

```
            ┌─ pg_cron (Supabase) ── fires at 08:00 UTC & 03:00 UTC ──┐
            │                                                          │
    Super admin ─┐                                                     ▼
                 │  POST {base}/functions/v1/oneroster-api-sync
                 │  Authorization: Bearer <JWT>               ┌──────────────────┐
                 │                                            │  Edge Function   │
     ──► Integrations page "Run sync now" button ────────────►│ oneroster-api-   │
                                                              │     sync         │
                                                              └────────┬─────────┘
                                                                       │
                                          reads from app_secrets       │
                                          (via service-role RPC)       │
                                                                       ▼
                                                       ┌─ POST {token_url} ──► Bearer token
                                                       │
                                                       ▼
                                                       ┌─ GET /orgs
                                                       ├─ GET /academicSessions
                                                       ├─ GET /courses
                                                       ├─ GET /classes
                                                       ├─ GET /users
                                                       ├─ GET /enrollments
                                                       └─ (paginated)
                                                                       │
                                                                       ▼
                                                       upsert into campuses,
                                                       teachers, students, …
                                                                       │
                                                                       ▼
                                                       record_sync_run()
                                                       ─► sync_runs row
```

---

## Step 1 — Run the SQL

Run **both** scripts in order (in fresh SQL tabs):

1. `/app/supabase/sync_runs.sql` — creates `sync_runs` table + 3 RPCs.
2. `/app/supabase/oneroster_api_cron.sql` — creates:
    - `secrets_read_for_service(text)` — service-role-only secret reader
    - `cron_trigger_oneroster_sync()` — thin helper that POSTs to the Edge Function
    - Two `pg_cron` jobs: `hpa-oneroster-sync-morning` (08:00 UTC) and `hpa-oneroster-sync-evening` (03:00 UTC)
    - Adds the `oneroster_api_*` slots to `app_secrets`

Expected results:
- `sync runs ready`
- `oneroster api + cron ready`

## Step 2 — Deploy the Edge Function

Two source files exist (identical logic, different quoting):
- `/app/supabase/functions/oneroster-api-sync/index.ts` — for CLI deploy
- `/app/supabase/functions/oneroster-api-sync/index.dashboard.ts` — for paste
  into the Supabase Dashboard editor (uses ZERO double quotes; the dashboard
  editor mangles `"` on paste and breaks Deno parsing).

> **v6 (2026-02)**: Both files now use a chunked `upsert(...).select()`
> pipeline. Earlier versions did `from(t).select().in('col', [4000+ ids])`
> which exceeded the PostgREST URL length limit (~4KB), causing the sync
> to crash and `course_sections` / `enrollments` to drop to zero. The new
> pipeline never sends large IN clauses — every post-upsert id map is
> built from the rows the upsert itself returns, in 500-row batches.

### Option A — Supabase Dashboard (recommended)

1. Open **Supabase Dashboard → Edge Functions → `oneroster-api-sync`** (or
   click *Deploy a new function* and name it exactly `oneroster-api-sync`)
2. Open `/app/supabase/functions/oneroster-api-sync/index.dashboard.ts`
3. Select all + copy + paste into the dashboard editor
4. Click **Deploy**

### Option B — Supabase CLI (if installed)

```bash
cd /app
supabase functions deploy oneroster-api-sync --project-ref soaagmzmecutvlxfbscl
```

---

## Step 3 — Register the Edge Function URL & service key for cron

The cron job needs a target URL + a bearer token to invoke the function.
The URL pattern is:

```
https://soaagmzmecutvlxfbscl.supabase.co/functions/v1/oneroster-api-sync
```

The service-role key is in **Supabase Dashboard → Project Settings → API →
`service_role` secret**. Copy it (starts with `eyJ…`).

Run **one** SQL statement to store both:

```sql
-- Run as a super admin in the SQL editor. Replaces prior values.
select public.secret_set(
  'edge_oneroster_sync_url',
  'https://soaagmzmecutvlxfbscl.supabase.co/functions/v1/oneroster-api-sync',
  'internal',
  'URL for oneroster-api-sync Edge Function'
);

select public.secret_set(
  'edge_service_role_key',
  'PASTE_YOUR_SERVICE_ROLE_KEY_HERE',
  'internal',
  'Service-role JWT used by pg_cron to invoke Edge Functions'
);
```

> `secret_set` refuses to overwrite the value with an empty string, so
> if you want to *rotate* later just call it again with the new value.

## Step 4 — Configure the OneRoster API credentials

1. Sign in with Microsoft SSO (or break-glass `super@hpa.test`) as super admin
2. Go to **Admin → Integrations → Integrations tab**
3. Find **Infinite Campus — OneRoster REST API**, click **Configure**, and paste:
    - Client ID (e.g. `InfiniteCampus_xxxxxxxx-…`)
    - Client secret (the ROTATED value, not the old one you shared earlier)
    - Token URL (e.g. `https://hpacademies.infinitecampus.org/campus/oauth2/token?appName=hpa`)
    - Base URL (e.g. `https://hpacademies.infinitecampus.org/campus/api/oneroster/v1p2/hpa/ims/oneroster`)
4. Click **Save**

## Step 5 — Test with "Run sync now"

Still on the Integrations page, click the new **Run sync now** button on
the OneRoster card. Expected:

- Loading toast → Success toast with counts (`X students · Y teachers · …`)
- Card banner flips to green "Success" with timestamp
- Dashboard banner (top of `/admin/dashboard`) shows the same sync status

If it fails, the toast will show the exact reason (bad credentials, 401
from IC, empty orgs array, etc.). Fix and retry.

---

## Rollback

To pause the cron jobs without uninstalling anything:

```sql
select cron.unschedule('hpa-oneroster-sync-morning');
select cron.unschedule('hpa-oneroster-sync-evening');
```

To re-enable, re-run `/app/supabase/oneroster_api_cron.sql`.

---

## Security notes

- The `secrets_read_for_service()` RPC raises `42501` unless called with the
  `service_role` JWT. Browser-side authenticated users cannot invoke it,
  even with admin privileges.
- The Edge Function independently re-validates that the caller is either
  service_role (for cron) or a `super_admin` profile (for manual runs).
- Only `record_sync_run` results leak to the browser — never values from
  `app_secrets` or OneRoster response bodies.
