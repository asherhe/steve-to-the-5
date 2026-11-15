# Local masterplan completion — 2026-11-15

Later viewer changes are recorded in [local-demo-update.md](local-demo-update.md). That update replaces the small saved example and adds a local findings simulation.

Implementation continues the backend checkpoint `a9f962a` on `master-plan`, based on
main's Gaia/SIMBAD reliability merge `5c36016`. The user chose **local verification;
Supabase is not ready**. Changes remain uncommitted. No hosted database, real account,
commit, push, merge or deployment was performed.

## Delivered workflow

The production app now connects the existing viewer slots to email sign-in, candidate
review, six independent catalog results, posting, participation rankings, public
threads and optional community pins/clusters. A selected point must belong to a loaded
real saved frame. Synthetic/reference imagery cannot be ranked. Review state is discarded
when its frame, point, radius, survey or account changes; stale responses cannot restore it.

The server owns the score and posting identity. `review-effort-v1` remains the provisional
policy from the checkpoint: 10 points for real saved evidence and a point, 10 for two or
more dates, and 5 per completed catalog search, up to 50. Partial, failed and skipped checks
earn no catalog points. Match count never changes the score. The legacy `rarityScore` wire
name remains unchanged, while the UI says participation points.

Six results retain their independent states, scope, radius, observation time, bounded
returned records, column units/descriptions, upstream links and provenance. VizieR means
AllWISE II/328 only. The guide distinguishes catalog neighbors, identified sources,
image detections and validated discoveries. Optical detection, Gaia absence and WISE
presence are not gates. No chemical, temperature or novelty scoring was implemented.

Saved evidence links retain survey identity and discard auth/review-return parameters.
Finding-only WISE links resolve the finding before requesting the correct saved store.
Conflicting IDs, invalid survey identity and mismatched review snapshots fail visibly.
The original reviewed mark stays locked to its recorded frame. Sign-in return restores
the exact saved comparison/frame/point; text drafts remain in sessionStorage for 24 hours.

The saved real example opens an enlarged, responsive image with independent blink/step
controls. It uses the original image dimensions, WCS, dates, wavelength, stretch and assets.
Mobile panes stay below the instrument bar; the action row scrolls horizontally. The
latest main interface and fullscreen map remain intact. Tutorial, brief, handoffs and
engagement/user-story documents now describe the implemented workflow.

## Verification executed

| Check | Result |
|---|---|
| Catalog pytest | 136 passed; one existing Starlette TestClient deprecation warning |
| Findings unittest | 32 passed, including the new router → migration SQL review/rank/thread flow |
| PGlite migration checker | All four migrations passed access-denial, immutability, ownership, duplicate, UTC-board and moderation checks |
| Inspector/findings Vitest | 106 passed across 8 files |
| Viewer node tests | 43 passed |
| Root and web TypeScript | Passed |
| Vite production build | Passed; large Aladin bundle warning remains |
| Production Chromium browser | Eight workflow scenarios passed at desktop and 390×844 touch viewport |
| Git whitespace check | Passed |
| Root npm audit | Zero vulnerabilities after updating the existing concurrently dependency to 9.2.5 |

The browser scenarios cover the enlarged saved example and blink with Time closed;
sign-in return; review failure/retry and posting; board refresh and public discussion;
copy/reopen in a fresh anonymous mobile session and a second simulated user's reply;
WISE finding-only and copied-link routing; mismatched/missing IDs; stale review response
rejection; and broken-image retry. Mobile tour controls receive real touch events and pane
handles receive keyboard movement. The page has no horizontal overflow.

Browser services (Auth, catalogs, findings) are intercepted. The actual Supabase browser
client and production bundle run against simulated HTTP; retained real SPHEREx PNG bytes
are used for replay. The WISE routing case reuses that geometry to test store selection,
**not** actual WISE imagery. No requests post findings to a real service. External map
network is deliberately blocked; Aladin's own telemetry fetch failures are recorded
separately, with no unexpected application errors. This does not verify live map tiles.
Screenshots and full local output are ignored artifacts under
`.local-test-temp/masterplan-browser/` and `.local-test-temp/masterplan-*.log`.

The database integration executes the real FastAPI router and all migration SQL in
PGlite, with simulated Auth/PostgREST/catalog transports. It checks anonymous write denial,
server scoring with an unavailable catalog, ownership, WISE identity, original-frame
marks, duplicate rejection, public snapshots, a second author's reply and moderation.
This is not real Supabase Auth/PostgREST or concurrent hosted-transaction verification.

## Public catalog probes

The current probe used the retained real example center (RA 304.693508808°, Dec
+42.4436872991°), a 120 arcsec cone and the saved frame time
2025-10-30T17:30:35.064000Z. See
[`masterplan-completion-catalog-smoke.json`](masterplan-completion-catalog-smoke.json)
for actual retrieval times, endpoints and response fingerprints where provided.

| Catalog | Observed outcome |
|---|---|
| Gaia DR3 | AIP answered; 50 displayed rows, correctly partial |
| SIMBAD | Harvard answered; 3 nearby records |
| CatWISE2020 | Unavailable; bounded follow-up POST and documented GET probes timed out |
| UltracoolSheet 2.1.0 | Valid empty cone in this field; the checkpoint separately recorded a nonempty WISE 0855 cone |
| SkyBoT | Valid empty cone at the example; separate predicted-object cone returned 1 record |
| VizieR AllWISE | Unavailable; bounded follow-up connection timed out |

The SkyBoT follow-up first queried a documentation seed field, then used a returned
prediction to test a 120 arcsec cone at the same observation time. It is not a detection
in a SPHEREx image. A geocentric prediction is not a spacecraft apparent position.
CatWISE/VizieR success remains unverified; failures remain explicit, never cached or
scored as empty searches. CDS's [service notice](https://cds.unistra.fr/) reported degraded
SIMBAD/VizieR/Aladin availability when checked. IRSA timeouts were observed locally;
this is not a claim of a global IRSA outage.

## Reproduce locally

Install the declared root/web dependencies and project-local Python/PGlite dependencies
as described in `MASTERPLAN-HANDOFF.md`. From the repository root:

```sh
python3 scripts/verify-masterplan.py
```

For the production browser checks, start a preview in another terminal after the build:

```sh
npm run preview -- --host 127.0.0.1 --port 5188
```

Use an installed Playwright module and Chromium/Chrome:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  python3 scripts/verify-masterplan.py --browser-url http://127.0.0.1:5188
```

The public read-only probe is opt-in and requires network access:

```sh
services/catalogs/.venv/bin/python scripts/probe-review-catalogs.py
```

To try the app manually, run `npm run dev`, open `http://localhost:5173`, open **Time**,
then **Open saved real example**. Blink, open Compare details, select an image point and
choose **Review this point**. Without Supabase the sign-in pane reports unavailable;
there is no simulated public leaderboard. The browser script is the reproducible local
verification of the full signed-in path while Supabase is unavailable.

## Remaining activation and scientific limits

- Configure an approved local/development Supabase instance, apply all four migrations,
  enable email sign-in and allow the viewer redirect URL. Follow
  `services/findings/README.md`; start `npm run dev:findings` separately. Then run the real
  two-session review → post → rank → anonymous replay → reply and moderation checks.
  Email delivery, PKCE link return and hosted token refresh remain unverified.
- Retry CatWISE and VizieR when reachable. Their successful live response paths are
  covered by fixtures, not proven by this session's public probes.
- No archive selection/rendering code, stored evidence, generated contract or migration
  changed in this continuation. No fresh five-target archive builds or target
  motion/brightness demonstrations were performed. Existing coverage/inspection records
  retain their original limitations. Completion of this UI does not establish target
  visibility, chemical composition, temperature, rarity or a discovery.
- Deployment remains outside the user's local-only scope. Basic duplicate protection is
  not a complete anti-abuse policy or all-sky identity deduplication system. Participation
  weights remain provisional and documented, not a scientific ranking.
