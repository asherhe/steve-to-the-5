# Brief 4 · Findings backend

Mount `services.findings.create_router(supabase, load_saved_comparison)` in the shared FastAPI app. The router owns `/api/findings`. Construct `Supabase` with a lifespan-managed `httpx.AsyncClient`, the project URL, publishable key and server key. The archive loader takes a comparison ID and returns the persisted manifest with its matching `id` and immutable `frames[].id`. Return `None` for a missing comparison. Use the archive owner's saved comparison lookup so posting never regenerates evidence. The public thread returns the comparison ID and marks for replay through the archive service.

The HTTP request and response shapes are in the handoff. See `fixtures/responses.json` for synthetic frontend examples. The application shell owns the Supabase browser session and sends its access token as `Authorization: Bearer <access token>` for writes. Display titles, notes, names and replies as plain text. Return links with both the finding and comparison IDs using the shared shell's query parameters.

## Local verification

Run from the repository root in Windows PowerShell.

```powershell
py -3.12 -m venv services/findings/.venv
services/findings/.venv/Scripts/python.exe -m pip install -r services/findings/requirements.txt
services/findings/.venv/Scripts/python.exe -m unittest discover -s services/findings/tests -p 'test_*.py' -v
```

The smoke tests use fixture evidence and stub Supabase HTTP responses. The migration checks use an isolated PostgreSQL-compatible PGlite database with stub Supabase roles and an `auth.users` table.

```powershell
npm.cmd install --prefix services/findings/.venv --no-audit --no-fund @electric-sql/pglite
node services/findings/tests/check_migration.cjs
```

## Coordinator setup

Apply `supabase/migrations/20261114190000_findings.sql` to the team's Supabase project. This service uses server-only access to the two tables and SQL functions. The public API returns display names and evidence. Supabase Auth verifies sessions before writes, and the API derives author identity from the authenticated user. Keep the server key out of the browser and use the publishable key for sign-in. Optional auth display names fall back to **Sky observer**.

To run just this service, configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVER_KEY` and `SPHEREX_COMPARISON_BASE_URL` in the server environment. The comparison base URL points to the archive service and excludes `/api/comparisons`.

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
