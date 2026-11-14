# Brief 4 · Findings backend

Mount `services.findings.create_router(supabase, load_saved_comparison)` in the shared FastAPI app. The router owns `/api/findings`. Construct `Supabase` with a lifespan-managed `httpx.AsyncClient`, the project URL, publishable key and server key. The archive loader takes a comparison ID and returns the persisted manifest with its matching `id` and immutable `frames[].id`. Return `None` for a missing comparison. Use the archive owner's saved comparison lookup so posting never regenerates evidence. The public thread returns the comparison ID and marks for replay through the archive service.

The HTTP request and response shapes are in the handoff. See `fixtures/responses.json` for synthetic frontend examples. The application shell owns the Supabase browser session and sends its access token as `Authorization: Bearer <access token>` for writes. Display titles, notes, names and replies as plain text. Return links with both the finding and comparison IDs using the shared shell's query parameters.

## Local verification

Run from the repository root in Windows PowerShell.

```powershell
py -3.12 -m venv services/findings/.venv
services/findings/.venv/Scripts/python.exe -m pip install -r services/findings/requirements.txt -c services/findings/constraints.txt
```

`constraints.txt` records the tested Python package versions. Node.js is needed only for database verification. Install the tested PGlite version before running the complete suite:

```powershell
npm.cmd install --prefix services/findings/.venv --no-audit --no-fund @electric-sql/pglite@0.5.16
node services/findings/tests/check_migration.cjs
services/findings/.venv/Scripts/python.exe -m unittest discover -s services/findings/tests -p 'test_*.py' -v
services/findings/.venv/Scripts/python.exe -m pip check
```

## Coordinator setup

Apply these migrations to the team's Supabase project, in order:

1. `supabase/migrations/20261114190000_findings.sql`
2. `supabase/migrations/20261114200000_findings_viewport_roundoff.sql`

If the first migration is already applied, apply only the second. It fixes antipodal full-sky query roundoff without changing saved evidence or access permissions.

This service uses server-only access to the two tables and SQL functions. The public API returns display names and evidence. Supabase Auth verifies sessions before writes, and the API derives author identity from the authenticated user. Keep the server key out of the browser and use the publishable key for sign-in. Optional auth display names fall back to **Sky observer**.

To run just this service, configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVER_KEY` and `SPHEREX_COMPARISON_BASE_URL` in the server environment. See [.env.example](.env.example) for names and placeholder values; the application does not automatically load env files. Missing or blank values fail at startup with configuration names only. The comparison base URL points to the archive service and excludes `/api/comparisons`.

```powershell
services/findings/.venv/Scripts/python.exe -m uvicorn services.findings.main:create_app --factory --port 8014
```

A viewport returns at most 100 items. Zoom levels below 8 return 5-degree grid clusters and higher zooms return pins. Threads return their most recent 200 replies in chronological order. Titles are limited to 120 characters, notes and replies to 2,000, and each finding to 20 marks. Marks must reference a frame from the saved comparison. This slice exposes create and reply operations. Any future edit endpoint must verify account ownership.

To hide a finding, the coordinator can use the Supabase SQL editor. Replace the example UUID with the actual finding ID. This hides the pin and thread and blocks new replies.

```sql
update public.spherex_findings
set hidden_at = now()
where id = '11111111-1111-4111-8111-111111111111';
```

Before the demo, use the shared app with a real saved archive comparison and two real Supabase accounts. Verify public thread access, signed-out write denial, exact replay, and a signed-in reply from the second account. Coordinate router mounting and generated types with the app shell owner.

## Integration handoff

- Keep the app shell and shared schema changes with the coordinator. This checkout has no shared OpenAPI file or frontend app to edit. The findings router's generated OpenAPI documents its actual `{code, message}` errors, including validation, auth, missing records and unavailable services.
- Mount the router in the same-origin shared API and pass the archive owner's persisted-manifest lookup. Do not pass an archive search/render function. A missing comparison returns `None`; archive outages should raise `ApiError(503, "comparison_unavailable", "Saved evidence is temporarily unavailable.")`.
- Keep the `httpx.AsyncClient` open for the application's lifespan. The standalone factory demonstrates HTTP archive access and closes its client on shutdown. No keys or user tokens are forwarded to the archive.
- Configure Supabase browser sign-in and permitted return URLs in the shared app. The browser uses the publishable key and sends its user access token on writes. Render titles, notes, display names and replies as text nodes, never HTML. The backend preserves plain text; HTML-looking text is not interpreted by this service.
- Build copied links in the app shell as `?comparison=<comparisonId>&finding=<findingId>` using the returned thread data. Brief 4 retains the exact comparison and mark IDs; the archive owner retains the manifest and image assets.
- Finding and reply bodies reject client-provided identity fields. The tables/RPCs intentionally deny direct browser access, including authenticated browser clients. All public reads and verified writes go through this API. The SQL editor hide action above is the coordinator's moderation tool.

## Live acceptance command

Use this against the **integrated API origin** that serves both `/api/comparisons` and `/api/findings`. It creates one clearly labeled test finding and a reply; the finding ID is printed as soon as creation succeeds so it can be hidden even if a later check fails. Use a test/staging project first.

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for the same project as the server. Set these additional environment variables (tokens are entered without echoing or putting them in shell history):

```powershell
$env:SPHEREX_SMOKE_BASE_URL = 'https://YOUR_INTEGRATED_APP_ORIGIN'
$env:SPHEREX_SMOKE_COMPARISON_ID = 'YOUR_REAL_SAVED_COMPARISON_ID'
$env:SPHEREX_SMOKE_RA = 'YOUR_SELECTED_RA_IN_DEGREES'
$env:SPHEREX_SMOKE_DEC = 'YOUR_SELECTED_DEC_IN_DEGREES'
$env:SPHEREX_SMOKE_TOKEN_A = [System.Net.NetworkCredential]::new('', (Read-Host 'Account A access token' -AsSecureString)).Password
$env:SPHEREX_SMOKE_TOKEN_B = [System.Net.NetworkCredential]::new('', (Read-Host 'Account B access token' -AsSecureString)).Password
services/findings/.venv/Scripts/python.exe -m services.findings.verify_live
Remove-Item Env:SPHEREX_SMOKE_TOKEN_A,Env:SPHEREX_SMOKE_TOKEN_B
```

Choose coordinates inside a real saved comparison with at least two frames. The script verifies the tokens belong to two different signed-in accounts, anonymous reads, anonymous write denial, missing evidence rejection, post/reply persistence, public privacy, map pins/clusters, and an unchanged saved manifest. Use fresh sessions; expired sessions fail the check. The script needs no server key. At a highly saturated coordinate, the public viewport's 100-item cap may exclude a test pin; inspect that case before treating it as data loss.

Then open `?comparison=<saved ID>&finding=<printed ID>` in a second browser session and visually confirm the same images, dates and annotations. Test signed-out rendering and sign-in return. Use the coordinator's SQL hide action; confirm the pin disappears, thread reads return 404 and replies return 404. Repeat on the deployed origin. The HTTP command compares manifest content, not image bytes or visual alignment; archive asset retention/immutability remains Brief 1's responsibility.

## Verification status

Local verification uses synthetic evidence and simulated Supabase Auth/PostgREST HTTP responses. All 21 Python tests passed with PGlite installed, including a cross-layer create/read/reply/replay/hide flow executing the actual migrations and SQL functions. The separate migration check passed access denials, coordinate/text limits, 100-item caps, newest-200 reply ordering, RA wrap, polar/antipodal coverage and moderation. `pip check` passed. The tested Starlette version emits a TestClient/httpx deprecation warning; the HTTP tests still pass.

The database-backed Python test explicitly skips if Node/PGlite is missing; a skipped test is not a full verification pass. PGlite is an isolated PostgreSQL-compatible database with stub Supabase roles, not a hosted Supabase test. Real Supabase sessions, PostgREST, concurrent hide/reply transactions, real archive evidence, browser replay and deployed behavior have not been verified in this checkout. No live environment values are configured. Five-target archive coverage and scientific comparability belong to Brief 1 and the coordinator, not this findings backend.
