# Planet X and SPHEREx — shared project brief

This brief summarizes the SPHEREx viewer as it stands in this repository. It reflects the
current design across every component with equal weight: the three Python services
(archive, catalogs, findings), the Supabase schema, and the four web modules (viewer,
inspector, findings UI, leaderboard). The `docs/` folder holds the pitch, the challenge
compliance assessment, and the exploratory engagement/game direction; read it alongside
this brief. Where this brief and the implementation disagree, the implementation and the
per-owner READMEs are authoritative; surface material conflicts to the coordinator rather
than silently changing a contract.

## Masterplan checkpoint (2026-11-15)

The current user has authorized the cold-object review/engagement workflow and explicitly
included all six catalog review aids. This supersedes the deferral of that workflow only.
The backend checkpoint provides persisted catalog-review snapshots and participation-point
leaderboard routes; the production frontend is still the earlier placeholder and has not
been integrated. Read `MASTERPLAN-HANDOFF.md` for the exact implemented scope, scientific
corrections, setup, verification, and remaining work. No discovery, composition, physical
temperature or catalog-exhaustiveness inference is authorized by these scores. WISE playback
already exists and is preserved. Hosted migration, auth and deployment remain unverified.

## What we are building

NASA Space Apps 2026 asks for a public web tool where anyone enters right ascension and
declination, sees real SPHEREx images of that sky patch, and plays them over time to spot
movement or brightness changes. The five test targets are Barnard's Star, Epsilon Indi B,
WISE 0855 (08h55m10.831s, −07°14′42.53″), RW Aurigae and R Draconis. Record the result for
every target, including coverage gaps and ambiguous changes. [Official challenge](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)

The audience is citizen scientists and amateur astronomers, plus classrooms and newcomers.
The pain point is getting from a coordinate to a trustworthy comparison without manually
finding FITS files, aligning frames and checking observation conditions. A finding is a
reproducible observation or question, never a claimed discovery. Catalog lookups and user
comments are evidence for discussion.

The map is the workspace. Aladin Lite provides navigation over a SPHEREx all-sky reference
layer (with an optional DSS optical reference). Dated SPHEREx cutouts play in a matched
monochrome comparison, and the inspector, discussion and time controls open as draggable
panels over the map. Readers browse anonymously; signed-in users post or reply. A link is
the invitation mechanism.

## The components, with equal weight

The product is five owned slices around one shared contract. Each is summarized here; each
slice's README carries the exact interface, limits and verification.

### 1. SPHEREx archive and image preparation — `services/archive/**`, `fixtures/archive/**`

A standalone FastAPI service that discovers exposures, prepares matched monochrome frames,
stores immutable evidence, and replays it. It queries IRSA SIA2 over DR1 and QR3 Wide
Survey collections directly over HTTPX with explicit byte limits, timeout, retry and
VOTable-error handling (no account required; downloads restricted to HTTPS IRSA SPHEREx
paths).

- Routes: `GET /api/comparisons?ra&dec&fovArcmin` (anonymous build), `GET
  /api/comparisons/{id}` (exact saved replay, never queries IRSA), and
  `GET /api/comparisons/{id}/assets/{name}` (immutable PNG or original FITS with ETag).
- Domain statuses (HTTP 200): `ready`, `single_epoch`, `no_coverage`, `no_comparable_pair`,
  `upstream_unavailable`. HTTP errors are `{code, message}`: 422 `INVALID_REQUEST`,
  404 `NOT_FOUND`, 429 `BUILD_BUSY`, 503 `PROCESSING_LIMIT`, 500 `EVIDENCE_CORRUPT`,
  409 `EVIDENCE_CONFLICT`. An incomplete search never fabricates a negative result.
- Preparation policy (provisional quick-look, serialized per manifest, not detection
  criteria): 6.2 arcsec/pixel north-up ICRS TAN grid; one exposure per frame; conservative
  cutout bound measured against real detector WCS; three coverage thresholds (geometric
  0.98, valid 0.80, common-valid 0.75); documented SOURCE/FULLSAMPLE flags only; ZODI model
  subtracted with no per-frame normalization; wavelength agreement within 0.25 of the
  narrower local bandwidth and a shared detector; WCS-only registration with a
  background-source alignment check that is reported, never a positional correction.
- Bounded work: one build per process (second request → 429), 180 s deadline, bounded
  candidates/cutouts, retries with backoff, 20 MB per response.
- Identity: the comparison ID is a SHA-256 over field, settings, grid, stretch, source
  hashes, implementation fingerprint and search record, so any changed threshold or code
  yields a new ID while saved evidence still replays exactly.
- Storage: content-addressed blobs plus a checksummed manifest published atomically; no
  overwrite of a conflicting ID; replay verifies integrity and never repairs by refetching.
- Retained real examples: a live WISE 0855 comparison (`real_archive`) and an earlier
  curated tutorial pair (`saved_real_example`), plus synthetic fixtures and a five-target
  coverage log.

### 2. Map, playback and display — `web/src/viewer/**`

The app shell and the only module that mounts the others. A full-screen Aladin Lite map
with an instrument-bar header, a one-line search, draggable floating panes, a bottom
spectral-ruler dock and map tools.

- Reference imagery: the SPHEREx DR1 all-sky HiPS cube. A bright low-resolution overview is
  the base layer; higher-resolution detail tiles paint on top. The spectral ruler selects
  any non-blank cube slice (6 bands × 17 channels; blank dichroic slices 50–51 excluded) and
  the reference layer follows it by setting the HiPS frequency. A DSS2 colour HiPS is
  available as an optical reference toggle (not SPHEREx). The canvas clears to the near-black
  map colour, and a dark cover and fade hide Aladin's own load flash.
- Comparison playback (`usePlayback` + `ComparisonPlayback` + `TimeControls`): frames are
  sorted chronologically and preloaded as decoded images; blink between two chosen
  endpoints, step, or play all, with a speed control. Playback pauses on hidden tab, on
  frame-load failure, and when the panel closes. One shared stretch and the wavelength range
  are shown; per-frame date, wavelength, release, valid-pixel fraction and alignment label
  appear with quality flags.
- Dated sky overlay (`DatedSkyOverlay`): the rendered dated PNGs are placed back on the sky
  by their saved FITS WCS as raster layers, with a dashed footprint, frame marks and a
  predicted-Gaia marker drawn on a transparent canvas. No new stretch is introduced.
- Search: a single search box resolves a challenge preset, a decimal/sexagesimal RA/Dec
  pair, or an object name (via the resolver). An advanced form sets field width explicitly
  within the archive's 1–30 arcmin bounds. "Compare this field" uses the current viewport.
- Panels are draggable, stackable, collapsible windows (`FloatingPane`) hosting the search,
  the comparison details, and the Gaia inspector slot, plus the leaderboard.
- Replay: `?comparison=<id>` and `?finding=<id>` restore the exact saved evidence, and the
  viewer exposes copy-link actions.
- Beginner help: a first-run tutorial (`Tutorial` / `useTutorial`, dismissal stored in
  `localStorage`, reopened by a "How this works" button) and inline `InfoTip` disclosures
  next to unfamiliar terms (RA/Dec, field width, wavelength, shared stretch, valid pixels,
  alignment, blink, and Gaia terms).
- The production adapter (`production.ts`) implements search, saved replay and name lookup
  against same-origin `/api` routes using types generated from the archive OpenAPI; a
  development fixture harness runs under `?fixtures=1`.

### 3. Catalog service and source inspector — `services/catalogs/**`, `web/src/inspector/**`

A FastAPI catalog service, offline by default (bundled fixtures) with opt-in live Gaia DR3.

- Routes: `GET /api/resolve?name` (bundled presets, optional SIMBAD when live),
  `GET /api/catalogs/nearby?ra&dec&radiusArcsec` (bounded Gaia DR3 cone search),
  `GET /api/catalogs/gaia/{sourceId}` (full astrometry plus optional uncertainties, radial
  velocity, BP/RP, provenance), and `GET /api/health` (liveness and mode). Errors are `{code, message}`:
  400 `invalid_request`, 404 `not_found`, 503 `upstream_unavailable` (distinct from an empty
  result). Bounds: radius ≤ 300 arcsec, ≤ 200 rows, 20 s TAP timeout. No credentials.
- The inspector (`SourceInspector`) is a slot component: given a sky position and optional
  selected-frame metadata, it lists nearby sources (idle / loading / matched / ambiguous /
  unmatched / unavailable states) and shows observed position, reference epoch, proper
  motion, parallax and photometry with units. When a frame is selected it propagates the
  catalog position to the observation date and labels it a prediction, kept distinct from the
  observed image, and emits a mark action. It owns no map windowing.

### 4. Findings backend and auth — `services/findings/**`, `supabase/**`

A FastAPI router mounted in the shared app, backed by Supabase (Postgres + Auth), owning
`/api/findings`.

- Routes: `GET /api/findings?ra&dec&radiusDeg&zoom` (bounded viewport returning pins or
  clusters; ≤ 100 items; zoom < 8 returns 5° grid clusters, higher zoom returns pins),
  `POST /api/findings` (authenticated create), `GET /api/findings/{id}` (public thread with
  evidence, author display name and most-recent 200 replies), and
  `POST /api/findings/{id}/replies` (authenticated). Errors are `{code, message}`.
- Validation and privacy: titles ≤ 120 chars, notes/replies ≤ 2,000, ≤ 20 marks per finding,
  marks must reference a frame of the saved comparison. Posting never regenerates evidence;
  it uses the archive's saved-comparison loader. Public reads expose display names (falling
  back to "Sky observer") and evidence; emails stay private. Writes derive identity from the
  Supabase session; the server key stays server-side; the two tables and SQL functions deny
  direct browser access, including authenticated clients.
- Schema: three ordered migrations under `supabase/migrations/` create the findings/reply
  tables and viewport SQL functions, with fixes for antipodal full-sky roundoff and cluster
  right-ascension wrapping around 0°. Moderation is a coordinator SQL `hidden_at` action.

### 5. Findings UI and map activity — `web/src/findings/**`

Fixture-testable React components that render in a standalone harness and, at integration,
inside the viewer's inspector/discussion slots.

- An activity toggle, a cluster/pin data adapter, a selected-pin discussion panel with
  replies, a signed-in composer and a reply form. It accepts a comparison ID and sky
  selection as props and talks to `/api/findings` through its own client, never to Supabase.
- "Show evidence" restores the exact frames and annotations; "Copy link" includes both the
  comparison and finding IDs. Titles, notes, names and replies render as plain text.

### 6. Rarity leaderboard (engagement placeholder) — `web/src/leaderboard/**`

An engagement-layer panel, currently placeholder data because no scoring system exists. An
entry references immutable saved evidence by ID and is never evidence itself; a rarity score
and tier are game signals, not measurements or discoveries. Boards are "Today" and
"All time"; entries carry a rank, display name, score, tier, explainable reasons, a sky
position and an optional comparison/finding reference, and the panel labels placeholder data
plainly and frames entries as candidates worth a closer look. See
`docs/engagement-social-integration.md` for the fuller, deferred game direction.

## Shared conventions

JSON uses camelCase; coordinates are ICRS decimal degrees; timestamps are UTC ISO 8601;
angular and wavelength units appear in field names; external source IDs are strings;
nullable measurements use `null`. Validate finite coordinates, Dec in [−90, 90], RA in
[0, 360) and positive bounded search sizes; the viewer normalizes sexagesimal input. Errors
use `{code, message}`. `comparison` and `finding` query parameters drive exact replay. A
findings pin and a selected image position share the same sky coordinates.

## Scope and scientific context

- **Core challenge (built).** RA/Dec input, adjustable field, fetched and played real dated
  SPHEREx images, one shared brightness scale, timestamps and wavelength labels, one matched
  monochrome range per comparison, with coverage and quality issues surfaced where they
  affect interpretation.
- **Team MVP (built or placeholder).** Gaia inspector, findings backend and UI with
  reproducible comparison links, an optional map activity layer, and the engagement
  leaderboard as a labeled placeholder. No separate feed or invitation inbox.
- **Deferred.** Verified false-colour presets, a spectrum panel, difference images, WISE
  historical imagery, a curated NEOSSat example, and the scored rarity game. A validated
  molecular detection product would be required for any chemical map; physical temperature
  requires further inference. The spectral ruler already lets users explore the infrared
  reference layer across wavelengths as a teaching aid, but it is a reference display, not a
  per-date measurement.
- **Time and wavelength.** DR1 covers Surveys 1 and 2 (roughly May 2025 to mid-May 2026);
  QR3 provides later observations. Query both and use actual observation timestamps. The
  all-sky cube is a wavelength product formed from combined observations, not dated frames;
  dated spectral images power playback. Gaia DR3 astrometry is referenced to epoch 2016.0,
  and any position propagated to a SPHEREx date is labeled a prediction. The current time
  series is short (a few epochs per target, growing with each release), so motion/variability
  claims are deliberately avoided.

## Engagement and education (exploratory, deferred)

The viewer intentionally includes light engagement and learning hooks today — the first-run
tutorial, the inline term explainers, the spectral-ruler exploration, and the leaderboard
placeholder — framed as teaching cues, never as scientific claims. The fuller game concept
(rarity scoring, daily challenges, a permanent candidate leaderboard with per-entry
discussion) is captured in `docs/engagement-social-integration.md` and
`docs/challenge-compliance-assessment.md`. It remains exploratory: "rare" or "interesting"
are engagement signals, labels seen by the public must not imply a discovery, and any new
persisted field, route or schema is a coordinator-owned change.

## Architecture and integration

React 19 + TypeScript (Vite) for the viewer app shell; the inspector and findings UI build
under React 18 in their own standalone harnesses and are consumed through typed slots.
Aladin Lite is the map. Python/FastAPI with Astropy backs archive and catalog work; findings
uses FastAPI over hosted Supabase (Postgres + Auth). The browser requests HiPS tiles
directly; the archive fetches and caches small FITS cutouts and renders PNGs; the catalog
service returns bounded Gaia results. In deployment, route `/api/comparisons`,
`/api/resolve`, `/api/catalogs/*` and `/api/findings` to their services behind one
same-origin entry point, with a proxy timeout above the archive build deadline and broad
CORS disabled. [Aladin](https://cds-astro.github.io/aladin-lite/) · [IRSA access](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/) · [Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3)

Each owner runs their slice with fixtures independently; live integration depends on data
but frontend implementation does not. The coordinator owns the shared schema, generated
types, root dependencies, app entry points, deployment and merges, and any contract change.

## Demo acceptance

A fresh visitor opens the public map, enters a coordinate or selects a known target, sees
two or more aligned dated frames when coverage supports it, and understands what changed. A
signed-in user posts from the selected point. A second visitor opens the thread anonymously,
restores exactly that comparison and signs in to reply. Verify the five challenge targets,
missing coverage, archive failure, signed-out write denial, and replay of a saved comparison.
Attribute the applicable SPHEREx release and link the source observations. DR1 spectral-image
DOI 10.26131/IRSA678; use the appropriate QR3 citation for QR3 observations.
[DR1 overview](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html)

## Verification status (as recorded in-repo)

Each slice is verified against fixtures and partial live checks; none claims a full deployed
end-to-end pass. Archive: 77 unit/regression tests and a local HTTP smoke test passed; a
live five-target run gave comparisons for Epsilon Indi B, WISE 0855 and R Draconis and
`PROCESSING_LIMIT` for Barnard's Star and RW Aurigae (the time-ordered sampling is a poor way
to find wavelength matches, and most discovered exposures were never requested — not evidence
that no pair exists). Catalogs: offline fixture suite passes; live Gaia is unverified in this
checkout. Findings: Python tests pass with PGlite (an isolated Postgres-compatible stub), but
real Supabase sessions, concurrent hide/reply, browser replay and deployed behavior are
unverified. Viewer/inspector/findings UI: fixture and contract tests pass; some browser
checks require the team's hardware-GL Chrome. Treat every checked-in verification record as
historical until rerun, and distinguish synthetic fixtures, saved real examples, live archive
checks and deployed checks. No discovery, composition, temperature or significant variability
is claimed from imagery alone.
