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
3. `supabase/migrations/20261114210000_findings_cluster_ra.sql`

Apply any pending migrations in order. The second fixes antipodal full-sky query roundoff. The third keeps cluster centers in the valid right ascension range when wrapping around 0°.

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

## Historical verification before candidate reviews

Local verification uses synthetic evidence and simulated Supabase Auth/PostgREST HTTP responses. All 21 Python tests passed with PGlite installed, including a cross-layer create/read/reply/replay/hide flow executing the actual migrations and SQL functions. The separate migration check passed access denials, coordinate/text limits, 100-item caps, newest-200 reply ordering, RA wrap, polar/antipodal coverage and moderation. `pip check` passed. The tested Starlette version emits a TestClient/httpx deprecation warning; the HTTP tests still pass.

The database-backed Python test explicitly skips if Node/PGlite is missing; a skipped test is not a full verification pass. PGlite is an isolated PostgreSQL-compatible database with stub Supabase roles, not a hosted Supabase test. Real Supabase sessions, PostgREST, concurrent hide/reply transactions, real archive evidence, browser replay and deployed behavior have not been verified in this checkout. No live environment values are configured. Five-target archive coverage and scientific comparability belong to Brief 1 and the coordinator, not this findings backend.


## Masterplan backend checkpoint — 2026-11-15

See `MASTERPLAN-HANDOFF.md` at the repository root. The fourth migration adds immutable
candidate-review snapshots and participation-point rankings. Apply it after the three
existing migrations; no hosted migration was executed in this checkpoint.

- `POST /api/findings/reviews`: authenticated `{comparisonId, survey?, frameId, ra, dec,
  radiusArcsec?}`. The saved WCS, frame date and real-data provenance are validated;
  catalog results and the server-calculated score are persisted before an ID is returned.
- `POST /api/findings`: accepts optional `reviewId` and `survey` (default `spherex`).
  The reviewed point must be marked on the original reviewed frame. A review can only
  be submitted by its owner for the same image and coordinates.
- `GET /api/findings/leaderboard?board=daily|allTime`: public, at most 100 visible
  entries, with UTC daily boundaries and stable score/date/ID ordering. `rarityScore`
  is a legacy wire name for participation points, not a scientific rarity measurement.
- Threads additionally return `survey` and nullable `candidateReview`.
- `GET /api/findings/auth/config` returns only the public URL/publishable key.

The catalog service must run with `CATALOGS_LIVE=1`; offline responses cannot earn points.
Set `SPHEREX_CATALOG_BASE_URL` and `WISE_COMPARISON_BASE_URL` as needed (defaults are
localhost ports 8010 and 8020). Browser integration is now complete locally; see the
activation section below. Hosted auth remains unverified.
Regenerate the shared schema using `scripts/export-findings-contract.py`, then
`npm run generate:findings-types`. `scripts/verify-masterplan-checkpoint.py` runs all
checkpoint checks and fails if the isolated database dependency is absent.

## Production browser integration and activation

The viewer includes the real findings client and participation workflow, enabled only with `VITE_LIVE_FINDINGS=1`. The default app uses a clearly labeled browser-only simulation without sign-in. Supabase is not
configured in the current local verification environment. Do not substitute fixture results
for a public leaderboard. The app will report sign-in/findings unavailable until configured.

To activate in your approved local/development Supabase instance:

1. Apply all four ordered `supabase/migrations/*_findings*.sql` migrations.
2. Export the server variables documented in `.env.example` into the terminal running
   `npm run dev:findings`. The example file is not loaded automatically. Keep the server key
   out of Vite environment variables, client bundles, logs and Git.
3. Enable email sign-in. Allow the local viewer origin and paths (for example
   `http://localhost:5173/**`) in Supabase Auth's redirect allowlist. The app uses PKCE email
   links; open the link in the same browser. If your email template includes a token, the
   **Email code** form verifies it in place. No passwords or privileged keys enter the UI.
4. Run `VITE_LIVE_FINDINGS=1 npm run dev` and `npm run dev:findings` in configured terminals. Confirm all six
   checks run live; a failed/partial check stays explicit and earns no catalog points.
5. Use two real sessions: review → post → rank → anonymous exact replay → sign in as the
   second user → reply. Verify signed-out write denial and moderation. Run
   `services/findings/verify_live.py --help` for the existing live checker without printing
   or pasting tokens.

Text drafts live in sessionStorage and stay in the originating tab (historical composer drafts expire after 24 hours).
The sign-in return URL restores the selected point and radius, plus its saved frame when present. Frame-backed selections are validated against their saved WCS. It never includes a client score. User-facing links strip auth and review
return parameters. Email is not a public author display name.

`test_review_database_flow.py` runs the real router and migration SQL through PGlite and
simulated auth/PostgREST/catalog transport. It verifies review ownership, score computation,
WISE identity, original marks, anonymous reads, two authors, duplicates and moderation.
This complements browser contract tests and is not hosted Auth/PostgREST verification.

## Point scoring — point-check-v3 (2026-11-15)

New point reviews now use v4: a saved real WISE blink is required; known objects
can earn SPHEREx, tentative absorption-pattern and WISE variability bonuses.
See [spectral points](../../docs/spectral-points.md) for the current contract,
thresholds, required durable evidence directory and additive migration. The v3
details below describe historical reports, which remain readable and ranked.

`POST /api/findings/points/review` takes `{ra, dec, radiusArcsec=30, frame?}`. `frame`, when
present, is `{survey, comparisonId, frameId}` and supplies the saved observation time for
SkyBoT and supported stellar proper-motion checks after the server verifies the real frame and point. No loaded frames are required for
reference-map submissions. Catalog results are recomputed by the server; clients never send
scores, identities, image bytes or brightness measurements.

| Result | Points |
|---|---|
| Any catalog returns a source row (`candidates` or `partial`) | 10 (`known`), immediately; no image download or brightness step |
| No returned matches, at most two of the other catalogs unavailable (Gaia DR3 not required), no other incomplete searches, bright in any two of SPHEREx/WISE/DSS/NEOSSat | 20 (`uncatalogued`) |
| Fewer than two bright surveys or incomplete catalog checks | 0 (`uncatalogued` / `incomplete`), still postable |

Undated reference points skip SkyBoT explicitly; that expected skip does not prevent the
20-point rule. Up to two `unavailable` catalogs are tolerated when no catalog returns a match; their failures remain visible. More than two unavailable catalogs, unexpected skips, and empty `partial` searches stay incomplete. A catalog source in a
cone is not automatically the source in a selected pixel. Likewise brightness across surveys
does not establish identity, novelty, motion or scientific significance.

Gaia DR3 is optional for the 20-point rule. A Gaia check that could not complete (ESA down,
or the AIP mirror rate-limiting) neither blocks the points nor counts toward the two
tolerated outages; the review says Gaia could not be checked. A Gaia source in the cone still
classifies the point as a known object (10). This rule is part of `point-check-v4`.

`cutouts.py` fetches bounded FITS directly: SPHEREx DR1 SIA/IBE, AllWISE W2 IBE, STScI DSS2 red,
and calibrated NEOSSat COR/CORD through CADC. Capped SPHEREx metadata can supply a bounded image sample, labeled as incomplete in each
measurement; it never becomes an empty-coverage result. Four archives run independently, with 45 s per
survey, at most two images each and a 12 MB response cap. Their `no_coverage` and `unavailable`
states remain distinct. Published raw NEOSSat previews do not supply calibrated brightness.
`brightness.py` uses the image's own WCS: peak within 1.5 px against a median/MAD background
annulus (at least 8–25 arcsec), with SPHEREx variance and flag masks. At least 5 sigma counts
as bright. Multiple frames from one survey count once. This is a local contrast rule, not
photometry or a validated detection. Measurements use the same sky coordinate in every cutout; they do not track a moving object between survey dates.

The response includes `scoreVersion`, classification, reasons, optional catalog `identity`,
per-source `brightness`, the six `catalogReview` checks and an optional `duplicate`. The UI
shows the server score, source links and explicit gaps, then collects a title and note.
`POST /api/findings` sends `{ra, dec, title, note, reviewId}` with no comparison or frame marks.
A point finding is deliberately distinct from immutable saved image evidence. Its optional
frame reference remains in its saved review. Historical frame-backed reviews/links still replay.

Migration `20261115150000_findings_point_check_scores.sql` ranks only `point-check-v3`, allows
null comparison/field width, and checks both catalog identity and angular separation within
15 arcsec under a lock (`spherex_submit_point_finding`). Reviews return a duplicate early;
posting also returns 409 `already_on_leaderboard` if another user wins the race. The UI blocks
known duplicates, links their discussions and keeps drafts after a racing 409. No hosted
migration is applied by local verification.

The demo follows the same point-only flow, queries the live catalog service when available,
awards only known-object 10 or unmeasured 0, and stores posts in localStorage. It never
simulates 20-point brightness. Same-object/15-arcsec duplicate checks are serialized with a
same-origin Web Lock where supported; this is browser-local simulation, not public database
enforcement. The production flow derives identity from real authenticated sessions.

Verification commands:

```sh
PYTHONDONTWRITEBYTECODE=1 services/findings/.venv/bin/python -m pytest services/findings/tests -q
node services/findings/tests/check_migration.cjs
npm --prefix web test -- src/findings/tests/point-workflow.test.tsx
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs VIEWER_TEST_URL=http://127.0.0.1:5189 node web/src/viewer/point-review.browser.mjs
```

The server-produced `fixtures/point-flow.json` is synthetic. Browser auth/catalog/findings
responses are intercepted; SQL checks use isolated PGlite. Neither proves hosted Supabase or
live archive end-to-end behavior. See `docs/verification/point-check-v3-completion.md` for this
run's source checks, remaining archive failures and activation requirements.

Dated catalog review now expands Gaia, SIMBAD and CatWISE search cones by 15 arcsec/year
from their reference epochs, retrieves at most 2,000 rows, then filters predicted positions
at the selected frame time. A reached row cap is `partial`, even if filtering leaves no rows.
Gaia uses epoch 2016.0; SIMBAD uses J2000; CatWISE uses the motion-fit `ra_pm`/`dec_pm` at
MJD 57170 with arcsec/year motions converted to mas/year. Published coordinates remain
in the report; `predictedRa`, `predictedDec`, `positionAtUtc`, `positionBasis` and
`separationArcsec` annotate rows. Predictions exclude parallax/perspective acceleration.
Missing motion components, UltracoolSheet and VizieR AllWISE retain published coordinates;
this is a bounded review aid, not a complete epoch-correct cross-identification.
Historical saved reports remain unchanged; the updated tolerance is recorded in new report
reasons under the existing point-check-v3 participation score contract.

## Local demo scoring (no Supabase)

`FINDINGS_LOCAL_DEMO=1` starts this service without Supabase and exposes a single route,
`POST /api/findings/demo/points/review`. It runs the same point review as the live
`/points/review`: the six-catalog check, survey cutouts and brightness, SPHEREx spectra and the
required WISE blink. So the local demo can award every score, including 20 points and the
bonuses. It needs no sign-in, writes nothing to a database and does no leaderboard duplicate
check; the browser keeps the demo's posts. Spectral evidence is still saved under
`SPHEREX_POINT_EVIDENCE_DIR`, as the scoring rules require. `SPHEREX_COMPARISON_BASE_URL`
defaults to `http://127.0.0.1:8000` in this mode.

`npm run dev` starts this service in demo mode whenever `SUPABASE_URL` is not set, and
`npm run dev:findings` does the same. If it is not running, the browser demo falls back to a
catalog-only simulation and says why.

The demo route is unauthenticated and fetches survey images on request. It is for local
development only: never set `FINDINGS_LOCAL_DEMO` on a deployed server.
