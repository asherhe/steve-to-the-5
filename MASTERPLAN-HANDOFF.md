# Local demo follow-up — 2026-11-15

See `docs/verification/local-demo-update.md` for the current map controls, browser-only findings simulation, and (per its superseding note) the Barnard's Star saved example and removal of exact-field replay. The archive service must restart to serve additional retained fields. Sign-in is disabled by default; `VITE_LIVE_FINDINGS=1` explicitly activates the real adapter once configured.

---

# Local integration continuation — 2026-11-15

The work below the original backend checkpoint has now been implemented on `master-plan`.
See `docs/verification/masterplan-completion.md` for actual checks and remaining activation.
The user explicitly chose **local verification; Supabase is not ready**. No hosted database
was changed, no real auth session was used, and no commit/push/merge/deployment is authorized
by this implementation assignment.

The production app now mounts sign-in, candidate review, six-catalog report, composer,
participation leaderboard, public discussion, and community activity. Survey-aware replay
preserves WISE identity; auth and draft parameters are stripped from shared links. Original
reviewed frame marks are retained. The example opens an enlarged view with image controls;
CSS enlargement and overlays do not change saved scientific evidence.

New code starts in `web/src/viewer/App.tsx` and `web/src/findings/{Account,
CandidateReviewPane,ReviewReport,CommunityActivity}.tsx`. The existing viewer slots,
findings API/client, Time controls and main interface remain the integration boundaries.
Generated contract shapes are consumed without introducing a new wire format.
`review-effort-v1` weights and science corrections below remain unchanged.

Reproduce locally with `scripts/verify-masterplan.py`. Browser tests explicitly intercept
services; PGlite tests execute real migration SQL with simulated auth/PostgREST transport.
See `services/findings/README.md` for later Supabase activation and two-session checks.
Live Gaia/SIMBAD and a nonempty SkyBoT response were observed. CatWISE and VizieR remain
unavailable on bounded public probes; their UI states are failures, never false empty results.
Fresh five-target image detection/change claims remain outside these frontend checks.

---

# Masterplan checkpoint — 2026-11-15

The user asked to stop at a verified checkpoint, commit all work on `master-plan`,
and make continuation on another Codex account straightforward. **The complete
masterplan is not finished. This is the backend checkpoint.**

## Resume instruction

> Continue executing the masterplan from MASTERPLAN-HANDOFF.md. Read the original
> request and the science corrections first. The user confirmed that all six catalog
> checks belong in this implementation. Finish the frontend workflow, improve the
> example view, update the tutorial/product docs, and verify the integrated flow.
> Preserve the latest main's Gaia/SIMBAD reliability behavior and exact saved-image
> replay. Do not present participation points as rarity, composition or discovery.

Read `AGENTS.md`, `spherex-project-brief.md`, `spherex-agent-handoffs.md`,
`.agents/skills/reproducible-comparison/SKILL.md`, and
`docs/masterplan-request-2026-11-15.txt`. The last file is the original user request,
including its misconceptions; the corrections below take precedence for this work.
The user's latest direction was to pause at this checkpoint, not to finish the entire
UI before handing off. No agents were delegated. No deployment or push was requested.

## Repository state

- Working branch: `master-plan`.
- Pulled and fast-forwarded `origin/main` from `c4bd5f9` to `5c36016` (PR #15,
  Gaia search fixes). No merge conflicts. All changes below are based on that main.
- Main added Gaia ESA/AIP failover, SIMBAD CDS/Harvard failover, deadlines, cache,
  `servedBy` provenance and manual recovery. The new review reuses that machinery.
- Find the checkpoint commit with `git log -1 --oneline` after this handoff is committed.
  It is local unless a later session explicitly pushes it.

## Scientific decisions already surfaced to the user

The product focus is **nearby cold substellar-object candidates**, including brown
dwarfs and possible free-floating planetary-mass objects. Selecting a point does not
establish its nature, distance or novelty. Known stars remain useful controls and the
five challenge targets remain acceptance targets.

- Do not require DSS optical detection or Gaia absence. Very cold objects can be
  optically faint; a catalog neighbor may be an unrelated source. WISE presence is
  useful context, not a mandatory gate or automatic image detection.
- The all-sky wavelength cube combines observations and is not a dated spectrum.
  Pixel/display brightness cannot identify elements, molecules or temperature.
  Do not implement the requested arbitrary chemical scores or no-catalog-match ×2.
- Use “review candidate” / “submit for discussion,” never “confirmed discovery.”
- The implemented `review-effort-v1` score is a proposed participation policy, chosen
  after explaining the scientific conflict: +10 saved real dated image and position,
  +10 if the saved comparison has at least two distinct dates, +5 per completed
  catalog cone search, regardless of match count. Maximum 50. Partial/unavailable
  checks earn no catalog points. These exact weights were not separately approved by
  the user; label them transparently and allow future versioning.
- User explicitly answered: **“Include all six as review aids (Recommended)”**.
- VizieR is a catalog collection: this checkpoint searches **II/328/allwise only**.
  Never describe this as checking every VizieR catalog or proving novelty.
- Cone matching is not epoch-aware cross-identification. Gaia uses 2016.0 positions;
  UltracoolSheet uses its compiled J2000 positions. High proper motion can leave a
  120 arcsec default cone; the supported maximum is 300 arcsec. Preserve this caveat.
- SkyBoT uses the selected frame's true observation time and geocentric predictions,
  which are not spacecraft apparent positions. A combined WISE frame spans an interval.

Sources checked: [NASA on WISE 0855](https://www.nasa.gov/news-release/nasas-spitzer-and-wise-telescopes-find-close-cold-neighbor-of-sun/),
[SkyBoT API](https://ssp.imcce.fr/webservices/skybot/api/conesearch/),
[UltracoolSheet 2.1.0](https://zenodo.org/records/15802304),
[IRSA catalog-query tutorial](https://caltech-ipac.github.io/irsa-tutorials/seds-in-firefly/).
Preserve the compilation's original-paper references and acknowledgements when displaying
UltracoolSheet results. The background claim that volunteers discovered “most” brown
dwarfs has not been established; do not copy that claim into product text.

## Implemented in this checkpoint

1. `services/catalogs/app/review.py`: `GET /api/catalogs/review` takes `ra`, `dec`,
   `radiusArcsec` (5–300; default 120), and timezone-bearing `observedAtUtc`.
   It returns six independent checks: Gaia DR3, SIMBAD, CatWISE2020,
   UltracoolSheet 2.1.0 Main CSV, SkyBoT, VizieR AllWISE. Results distinguish
   `candidates`, `no_candidates`, `partial`, `unavailable`, `skipped`; retain bounded
   returned rows, column metadata where available, retrieval/source provenance and
   response hashes where available. At most 50 rows/check. Two reviews/process.
   Offline mode returns six skipped checks and cannot earn points.
2. `services/findings/review.py`, `api.py`: authenticated `POST /api/findings/reviews`
   validates immutable saved evidence, real-data provenance, selected frame/time and
   point inside saved WCS. It queries catalogs server-side, calculates points and
   persists the review. Client-supplied scores/identity are rejected.
3. `POST /api/findings` adds optional `reviewId` and `survey` (`spherex` default or
   `wise`). It binds the review to the session owner, exact comparison, coordinates,
   and a mark on the reviewed frame. Other findings remain supported and unranked.
4. `GET /api/findings/leaderboard?board=daily|allTime` returns real scored findings
   through a bounded SQL function. Daily means UTC. Legacy wire field `rarityScore`
   holds **participation points**; `tier` is null. Do not show the old rarity copy.
5. Threads add `survey` and nullable `candidateReview`, which retains the review
   snapshot independently of the unchanged image manifest. Existing reply/moderation
   behavior is preserved. Duplicate author/comparison/grid-pixel submissions are
   blocked by a database unique index. This is basic duplicate protection, not a
   complete anti-abuse or cross-comparison object-deduplication system.
6. `GET /api/findings/auth/config` exposes only the Supabase URL and publishable key,
   for the next UI integration step. The server key remains private.
7. Migration `20261115120000_findings_candidate_reviews.sql`: immutable review
   records, ownership/uniqueness, public thread snapshot and leaderboard RPC. Direct
   anon/authenticated table/RPC access remains denied. **Not applied to hosted Supabase.**
8. OpenAPI exports, generated TS types, representative fixtures and backend tests.
   Export scripts explicitly use UTF-8. Existing preset/name-vector reads were fixed
   for Windows, and the transport timing test warms Astropy before timing requests.

No archive selection, image rendering, comparison hashes or stored evidence files changed.

## Historical remaining work at the backend checkpoint

1. Wire the main app (`web/src/viewer/main.tsx`, `Viewer.tsx`) to the existing findings
   components. Currently it has **no production sign-in or composer** and still uses
   `createPlaceholderLeaderboard()`. Installing `@supabase/supabase-js` was explored
   and then removed because no UI code uses it yet; add it when implementing auth.
2. Add a candidate-review pane/slot for a point selected on a dated image. Explain
   the cold-object focus, guide long-wavelength exploration (roughly 4–5 µm; a hint,
   not a detection criterion), matched-date blinking, WISE context and optional DSS
   optical context. Offer sign-in before creating a persisted review; preserve drafts.
3. Call `/api/findings/reviews`, display all six check states, scope, radius, time,
   returned records and original-source links. Gaia detail continues through the
   existing inspector. Display the score breakdown and explicitly say no discovery
   has been verified. Catalog outages must not become empty results.
4. Extend findings UI types/client/composer with generated `reviewId`/`survey` fields.
   Keep the required original-frame mark. Confirm submission creates a finding and
   refreshes/opens its leaderboard entry and discussion.
5. Replace production leaderboard data with `/api/findings/leaderboard`, rename all
   rarity/rare-candidate copy to review/participation points, handle empty/error states,
   and open its thread as a discussion beneath/alongside the entry.
6. Preserve **survey identity in every link and replay path**. Current
   `web/src/findings/links.ts` strips `view=wise`; fix it and its tests. Viewer
   `showEntryEvidence` currently loads the active survey rather than the entry's
   survey; use `entry.survey` and the corresponding loader. Include anonymous thread
   links that resolve correctly after reload, even for WISE.
7. Fix example size. `openExample()` currently opens Time but not Compare details,
   the map can stay much wider than the 1 arcmin/10-pixel saved example, and panes
   default to 26rem. Frame the example footprint visibly, open an adequately sized
   responsive image view, and make it enlargable without changing scientific pixels,
   WCS, stretch or evidence identity. The example is a labelled teaching example,
   not necessarily the requested field or a cold-object detection.
8. Update `Tutorial.tsx`, pitch/user stories and engagement docs around this actual
   workflow. Main brief/handoffs have an additive checkpoint note; older “deferred”
   paragraphs still describe the old UI and must be reconciled when integration ships.
9. Add integrated UI/contract tests: sign-in return, create review → finding → rank →
   anonymous replay → second-account reply; stale point/frame invalidation; duplicate
   posting; outages; no synthetic ranking; correct WISE links. Render-check desktop
   and mobile. Finish live probes for CatWISE/VizieR and validate non-empty SkyBoT.
10. Real hosted auth/database and deployed-origin checks require actual configuration.
    Do not claim them from mocked tests. No credentials are configured in this checkout.
    Do not deploy/publish/push without the user's authorization.

## Reproduce verification

On this Windows machine the project-local catalog and archive environments already
exist. The archive environment satisfies the findings test dependencies; the verifier
prefers a findings environment if one exists, otherwise uses archive. PGlite 0.5.16 is
installed under the ignored `services/findings/.venv/node_modules`.

```powershell
git switch master-plan
git status --short
& services/archive/.venv/Scripts/python.exe scripts/verify-masterplan-checkpoint.py
```

For a fresh checkout/account with no environments (Python 3.12+, Node 20+):

```powershell
npm.cmd ci
py -3.12 -m venv services/catalogs/.venv
& services/catalogs/.venv/Scripts/python.exe -m pip install -r services/catalogs/requirements.txt
py -3.12 -m venv services/findings/.venv
& services/findings/.venv/Scripts/python.exe -m pip install -r services/findings/requirements.txt -c services/findings/constraints.txt
npm.cmd install --prefix services/findings/.venv --no-save --package-lock=false @electric-sql/pglite@0.5.16
& services/findings/.venv/Scripts/python.exe scripts/verify-masterplan-checkpoint.py
```

On macOS/Linux use `.venv/bin/python` and `npm` instead. `npm run dev` sets up the
archive environment when needed and runs viewer + catalogs + SPHEREx + WISE. Findings
remain opt-in: set names from `services/findings/.env.example`, apply the ordered SQL
migrations in your authorized database, and run `npm.cmd run dev:findings`.
The `.env.example` is documentation and is not automatically loaded. Do not paste
credentials into the handoff, fixtures, terminal logs or Git.

Regenerate schemas/types after contract edits:

```powershell
& services/catalogs/.venv/Scripts/python.exe scripts/export-catalog-contract.py
& services/findings/.venv/Scripts/python.exe scripts/export-findings-contract.py
npm.cmd run generate:catalog-types
npm.cmd run generate:findings-types
```

Use `npm.cmd` in Windows PowerShell: execution policy blocks `npm.ps1` here. The
restricted tool process also blocked esbuild spawning and some pytest temp files;
the same checks passed when authorized outside that process. The verification script
uses repository-local ignored temp directories and fails if PGlite is missing.

## Verification record

See `docs/verification/masterplan-checkpoint.md` for the final local test record and
`docs/verification/masterplan-catalog-smoke.json` for actual public-catalog outcomes.
The original browser workflow is not yet integrated or verified. Five-target archive
coverage and immutable replay have not been re-run in this checkpoint because archive
processing did not change; retain the prior records as historical, not new results.
