# Implementation contract and the five owned slices

Read `spherex-project-brief.md` first. This file is the shared interface and the per-owner
map for the repository as it stands. It describes the routes and components that now exist,
not just a plan; each owner's README carries the exact request/response detail, limits and
verification. JSON uses camelCase, coordinates are ICRS decimal degrees, timestamps are UTC
ISO 8601, angular and wavelength units appear in field names, and external source IDs are
strings. Nullable measurements use `null`. Validate finite coordinates, Dec in [−90, 90],
RA in [0, 360), and positive bounded search sizes. The viewer normalizes sexagesimal input.
Malformed requests, missing records and unauthorized writes use an error body
`{code, message}`. The coordinator owns the shared OpenAPI/generated types, root
dependencies, app entry points, deployment and merges; route any contract change through it.

## Masterplan integration (2026-11-15)

User-authorized additive work on `master-plan`, based on `origin/main` at `5c36016`:
`GET /api/catalogs/review`, `POST /api/findings/reviews`,
`GET /api/findings/leaderboard`, and `GET /api/findings/auth/config` are implemented.
Finding writes add optional `reviewId` and `survey`; threads add `candidateReview` and
`survey`. See generated schemas in `fixtures/catalogs/openapi.json` and
`services/findings/fixtures/openapi.json`, the fourth findings migration, and
`MASTERPLAN-HANDOFF.md`. The coordinator performed the shared edits in this session.
The new score measures documented review effort; it is not rarity or detection evidence.
Frontend integration now mounts auth, candidate review, composer, public ranking, discussion and community activity. WISE links select the correct evidence store. The local completion record is `docs/verification/masterplan-completion.md`; real Supabase and hosted auth remain unconfigured by user direction.

## Shared interface (as implemented)

| Operations | Request and response |
|---|---|
| GET /api/comparisons?ra&dec&fovArcmin | Returns `{status, comparison, diagnostics}`. Status is `ready`, `single_epoch`, `no_coverage`, `no_comparable_pair` or `upstream_unavailable`. `comparison`, when present, has `{id, field, wavelengthRangeUm, stretch, grid, frames}` plus additive fields (observation IDs, detector, time bounds, bandwidths, source hashes, per-frame and common coverage, resolved `config`, limitations, provenance). Field is `{ra, dec, fovArcmin}`; `grid` carries dimensions and a FITS celestial WCS. Each frame has `{id, observedAtUtc, wavelengthUm, release, imageUrl, sourceUrl, qualityFlags}` plus time bounds, validity and alignment. Manifest and rendered assets are stored durably before a shareable ID is returned. |
| GET /api/comparisons/{id} | The saved manifest and immutable asset references, exactly as stored; never queries IRSA. Republishing data or changing default selection does not change a prior comparison. |
| GET /api/comparisons/{id}/assets/{name} | Immutable PNG or original FITS bytes with ETag; image URLs are same-origin relative paths. |
| GET /api/resolve?name | `{name, ra, dec}` from bundled presets; external SIMBAD lookup is live-only and enabled by the root dev runner unless explicitly opted out. |
| GET /api/catalogs/nearby?ra&dec&radiusArcsec | `{sources}`; each row `{sourceId, ra, dec, refEpoch, pmRaCosDecMasYr, pmDecMasYr, parallaxMas, gMag, separationArcsec}`. Empty result is distinct from an error. |
| GET /api/catalogs/gaia/{sourceId} | Astrometry plus available uncertainties, radial velocity, BP/RP magnitude and provenance; optional fields may be `null`. |
| GET /api/health | Catalog liveness and mode (offline fixtures vs live). |
| GET /api/findings?ra&dec&radiusDeg&zoom | Bounded `{items}` (≤ 100), each a pin `{id, ra, dec, title}` or cluster `{ra, dec, count, zoomTo}`. Zoom < 8 returns 5° grid clusters; higher zoom returns pins. |
| POST /api/findings | Authenticated `{comparisonId, ra, dec, title, note, marks?}`; optional marks are `{frameId, ra, dec}`. IDs validated against the saved comparison. Returns `{id}`. |
| GET /api/findings/{id}, POST /api/findings/{id}/replies | GET returns public evidence, author display name and most-recent 200 replies. POST takes `{text}`, derives author identity from auth, returns the reply. |

Frontend slots are fixture-tested React components. The viewer app shell exposes field
selection, sky click, active frame, map zoom, marker selection and overlay registration via
controlled props and callbacks, and hosts the inspector and discussion in draggable panes.
The inspector and findings UI also run in standalone harnesses during development. Query
parameters `comparison` and `finding` drive exact replay and thread opening. A findings pin
and a selected image position use the same sky coordinates.

## The five owned slices

Each slice is owned end to end and verified independently against fixtures. Keep edits inside
the assigned paths, preserve other contributors' work, and send shared changes to the
coordinator. The engagement leaderboard (`web/src/leaderboard/**`) is owned alongside the viewer app shell; it is not one of the five core
owners.

### 1. SPHEREx archive and image preparation — `services/archive/**`, `fixtures/archive/**`

A standalone FastAPI service implementing both comparison routes, the assets route, and
durable immutable evidence storage. It queries IRSA SIA2 over DR1 and QR3 Wide Survey
collections directly over HTTPX (no account; downloads restricted to HTTPS IRSA SPHEREx
paths), selects comparable exposures by wavelength, flags and WCS, registers them on one
ICRS TAN grid at 6.2 arcsec/pixel, and renders one fixed shared stretch. Returns actual dates
and release/source links. Domain statuses are listed above; HTTP errors are `{code, message}`
(422 `INVALID_REQUEST`, 404 `NOT_FOUND`, 429 `BUILD_BUSY`, 503 `PROCESSING_LIMIT`,
500 `EVIDENCE_CORRUPT`, 409 `EVIDENCE_CONFLICT`). An incomplete search never yields a
fabricated negative. Bounded work: one build per process, 180 s deadline, bounded
candidates/cutouts, retries with backoff, 20 MB per response. IDs are content hashes; storage
is content-addressed with an atomic checksummed manifest and no conflicting overwrite.
Retained: a live WISE 0855 example, a curated tutorial pair, synthetic fixtures, a five-target
coverage log and an OpenAPI export at `fixtures/archive/openapi.json`. Full detail and limits:
`services/archive/README.md` and `services/archive/INTEGRATION.md`.

### 2. Map, playback, display and app shell — `web/src/viewer/**`

Owns the Aladin Lite base map, the SPHEREx all-sky HiPS reference layer and the DSS optical
toggle, the spectral-ruler slice selection, one-line and advanced coordinate/preset/name
search, the field control (1–30 arcmin), matched monochrome playback (`usePlayback`,
`ComparisonPlayback`, `TimeControls`), the dated sky overlay, the draggable panel host
(`FloatingPane`) and marker primitives, and the beginner tutorial and inline term explainers.
It consumes the inspector and findings/discussion slots and the activity layer via typed
props, with real findings adapters in production and fixtures in development. The production adapter (`production.ts`) implements
search, saved replay and name lookup against same-origin `/api` routes using types generated
from the archive OpenAPI. It renders changing fields, fetch progress, empty results and
saved-example states, preserves exact framing while stepping, and restores evidence from a
copied link. As the app shell it mounts the other slices. Detail: `web/src/viewer/README.md`.

### 3. Catalog service and source inspector — `services/catalogs/**`, `web/src/inspector/**`

A FastAPI catalog service (offline fixtures by default, opt-in live Gaia DR3 TAP) implementing
name resolution, bounded Gaia DR3 cone search, exact source-ID detail and a health route.
Errors are `{code, message}` (400 `invalid_request`, 404 `not_found`, 503
`upstream_unavailable`, distinct from an empty result); radius ≤ 300 arcsec, ≤ 200 rows, 20 s
TAP timeout, no credentials. The inspector (`SourceInspector`) is a slot component taking a
sky position and optional selected-frame metadata; it presents catalog position, reference
epoch, proper motion, parallax and photometry with units through idle/loading/matched/
ambiguous/unmatched/unavailable states, propagates a selected-frame position and labels it
`predicted`, and emits a mark action. No shared map-windowing edits. Detail:
`services/catalogs/README.md`, `services/catalogs/docs/API.md`, `web/src/inspector/README.md`.

### 4. Findings backend and auth — `services/findings/**`, `supabase/**`

A FastAPI router (`create_router(supabase, load_saved_comparison)`) mounted in the shared app,
owning `/api/findings` and backed by Supabase (Postgres + Auth). Implements the viewport,
create, thread and reply routes with viewport SQL functions; four ordered migrations create
the tables and functions with antipodal-roundoff and RA-wrap fixes. Public reads expose
display names ("Sky observer" fallback) and evidence with emails private; writes derive
identity from the session. Validates evidence references and limits (title ≤ 120,
note/reply ≤ 2,000, ≤ 20 marks referencing the saved comparison), renders text as plain text,
and gives the coordinator a SQL `hidden_at` hide action. The server key stays server-side; the
tables/RPCs deny direct browser access. Detail: `services/findings/README.md`.

### 5. Findings UI and map activity — `web/src/findings/**`

Owns the activity toggle, the cluster/pin data adapter, the selected-pin discussion panel, the
signed-in composer and reply form. It uses stub marker callbacks and fixture API responses in
a standalone harness, accepts a comparison ID and sky selection as props from the app shell,
and talks to `/api/findings` through its own client (never Supabase directly). "Show evidence"
restores exact frames and annotations; "Copy link" includes both IDs and the WISE/SPHEREx survey. It handles loading,
no-findings, failed-write and sign-in-return states.

## Merge and demo order

The coordinator wires archive + map first, then the catalog inspector, then the findings
backend + UI, with the participation leaderboard and discussion mounted beside the app shell. Test contracts
against fixtures before merging and smoke test real data after the first join. Before release,
verify on the deployed origin with a cold request and a simulated archive failure, and use two
browser sessions to prove public read, auth, posting and reply. Log actual coverage for each
required target and show one observed change with metadata and source links. Treat every
checked-in verification record as historical until rerun, and keep synthetic fixtures, saved
real examples, live archive checks and deployed checks clearly distinct.

## Additive five-target naming contract

The catalog schema and representative responses are now exported in `fixtures/catalogs`,
with generated inspector types. `/api/resolve` preserves `name`, `ra`, `dec` and adds
optional `identity` and `positionProvenance`. Gaia nearby/detail rows may add a verified
identity by exact release-specific source ID; absence stays null. Naming is display
context, never part of an archive evidence hash or recorded finding mark. See
`docs/common-names.md` for component ambiguity, errors, source limits and regeneration.

Checkpoint 1 adds `incomplete_name` (400) within the existing error-body shape and a
`source-identities.json` representative fixture using the existing ObjectIdentity
schema. Ba source identity is separate from the B target preset. R Dra gains a verified
DR3 association; unresolved RW component bindings remain absent. Generation and contract
checks cover the new fixtures. No archive or findings contract change is introduced.


Main/common-name integration preserves the nearby route's
`X-SPHEREx-Catalog-Mode` response header and the inspector's live/fixture guard.
The frontend `MarkAction` retains required `astrometry` for frame-time recomputation
and optional `displayName`/`refEpoch` metadata for verified source labels. This is
viewer/inspector display state, not a change to saved finding marks or archive evidence.
Barnard's curated search position retains main's newer center with an explicit
prediction epoch; its original reference position is recorded separately in the
snapshot. See `docs/common-names.md` and the dated integration verification report.

## Additive catalog reliability contract

Approved by the catalog owner and coordinator. Additive and optional; existing fixtures
remain valid. `SourceProvenance` gains `servedBy`, `retrievedAtUtc` and `fromCache`;
`NearbyResponse` gains an optional `provenance`; `NameProvenance` gains `servedBy`. The
dataset identity (`dataRelease` = Gaia DR3) is unchanged: `servedBy` only names the archive
that answered (ESA, or the AIP mirror during an outage). `/api/catalogs/nearby`,
`/api/catalogs/gaia/{id}` and `/api/resolve` accept `retry=true` for a manual recovery
probe. `/api/resolve` adds `not_found_in_mirror` (404) within the existing error-body shape.
The OpenAPI export, representative responses and generated inspector types were regenerated
together. No archive, findings or saved-evidence contract change. See
`services/catalogs/README.md` for failover, deadlines, cooldown and cache behaviour.

## Additive blink reliability contract (2026-11-15)

User-authorized coordinator work on `fix/archive-blink-latency` adds optional
`progressId`/`refresh` parameters and typed progress/cancel routes to SPHEREx, and
`mode=blink|timeline` (default blink) plus `refresh` to WISE. The ComparisonResponse
and immutable replay contracts remain unchanged. `X-Comparison-Source` describes
transport delivery separately from saved provenance. Shared schemas and viewer types
are regenerated together; WISE now has its own schema export under `fixtures/wise`.
Exact-field persistent result indexes never replace or migrate immutable evidence.
SPHEREx uses footprint similarity to prioritize downloads, followed by the existing
pixel-level compatibility checks. WISE defaults to two visits of up to three exposures,
with the longer time-lapse explicit. DSS is reference-only. Current verification and
remaining live-archive limitations are recorded in `docs/verification/blink-latency.md`.

The demo-priority follow-up authorizes static unWISE neo11 metadata as a WISE discovery
index, with direct original L1b cutouts and IBE fallback. This is a bounded exposure
subset; metadata tables join source cutouts in the immutable evidence store. No
coadd images replace dated exposures. WISE now serves a retained real W2 example by
ID or its exact field/profile/band, labelled `saved-example`; explicit refresh bypasses
it. Both default app factories and CLI startup include that store. Current-code offline
reprocessing is available through `scripts/reproduce_wise_example.py`.
