# Five-target common names

The latest main fullscreen map, instrument bar and floating Time interface are retained. Name search filters the five
challenge targets locally; selecting a suggestion or preset requests that explicit
identity. Other full identifiers use `/api/resolve` only on submission and only when
`CATALOGS_LIVE=1` and `CATALOGS_EXTERNAL_RESOLVE=1`. Coordinate input remains independent
of naming-service availability. HiPS tiles and new archive images still require their
own services; offline naming does not promise offline imagery.

## Meaning and sources

A **common name** is an established human-readable name (Barnard’s Star), not an invented
label. A **canonical designation** is the product's reviewed scientific designation.
An **alias** denotes that same object/component. A **catalog ID** carries a catalog and
release and stays a string. Display uses common name, reviewed readable designation,
then catalog ID/coordinates. A resolver's primary identifier need not be our display name.
WISE 0855 is a shortened designation, not a newly assigned proper name.

The versioned snapshot in `services/catalogs/fixtures/catalogs/presets.json` is shared by
Python and the browser. Its references cover SIMBAD names/cross-IDs, the published
Epsilon Indi Ba/Bb system, AAVSO VSX RW Aur context, and the existing AAVSO R Dra preset.
R Dra now has a verified DR3 cross-identification; its field center remains the prior
AAVSO reference position. The snapshot's review time is separate
from every image observation time. Unknown field-center epochs remain null.

SIMBAD supplies object identifiers; Gaia DR3 supplies astrometry at its reference epoch.
VSX/GCVS supplies variable-star designations, SIMPLE and primary literature support
brown-dwarf component context, and IAU WGSN can verify proper-name claims. Verified
Gaia DR3 enrichment covers Barnard's Star, R Draconis and the distinct Epsilon Indi Ba
component. Ba is an inspector identity, not a sixth preset or an alias of the B pair.
RW Aur A/B bindings remain absent because primary sources conflict on component scope.
General all-sky naming and Solar System bodies are deferred. Solar System ephemerides
would require JPL Horizons body identity, observation time, observer and coordinate
conventions. WISE 0855 is not handled as a Solar System body.

## Search behavior

Whitespace/case, curly apostrophes, Unicode minus/dashes, epsilon variants and approved
compact GJ/HIP IDs normalize consistently in Python and TypeScript. Signs and decimal
parts in coordinate designations are preserved. Suggestions start at two characters,
are bounded to five, and rank exact names/aliases before prefixes/substrings. Enter on a
partial query asks for an explicit selection; Arrow keys/Enter and touch select a row.
Escape dismisses suggestions without closing the search panel. No external keystroke
queries, wildcard queries or fuzzy automatic identity selection are performed.

Bare Epsilon Indi is not an alias of B. Lowercase terminal `b` can mean a planet and
requires explicit selection of B; B is the Ba/Bb brown-dwarf pair, not A, Ba or Bb.
RW Aur component A/B queries do not silently resolve to the system preset. Unsupported
truncated WISE identifiers are not accepted as exact aliases. `barnard` is a filter,
not an unconditional astronomical identifier.

`incomplete_name` (400) identifies a partial curated query and asks for explicit
selection or a full designation; it is checked before any external lookup.
`ambiguous_name` (409) requests component clarification; `resolver_disabled` (503) explains the
local list's scope; `not_found` (404) means an enabled external lookup returned no
identity; `upstream_unavailable` (503) and invalid-response messages preserve coordinate
fallbacks. A missing name is never presented as evidence for a new object.

External resolution uses current lowercase degree-valued astroquery SIMBAD responses,
canonical IDs and identifier aliases. Each HTTP hop has an eight-second timeout; this
is not a total deadline for the multi-request lookup. A process-local 256-entry cache
keeps successful resolutions for 24 hours and confirmed misses for five minutes.
Mode/snapshot version are part of the cache key. Outages/ambiguity are never cached as
misses. Bundled references change only with explicit snapshot review and restart/rebuild.

## Identity, map labels and evidence

The requested target is separate from the inspected Gaia source. Names attach to Gaia
rows by exact verified DR3 ID, never by nearest coordinates. A single nearby row is
still an unassociated candidate until cross-identified. Synthetic catalog responses
have no real name enrichment, even where they reuse a familiar numeric source ID.

Map labels distinguish the search field's center from the inspected catalog/predicted
position. Reference epochs and predicted states remain explicit. Prediction requires
finite epoch and both proper-motion components. The existing linear approximation
omits parallax/perspective terms; its position is not an image detection or identity proof.

Name resolution, source-identification confidence, comparable image coverage, and
visible target detection are separate. The UI never infers detection from a name or
catalog link. Labels are request-scoped: coordinate searches and saved replay clear
prior target context, and late canceled requests cannot restore old names/coordinates.

Names do not enter archive manifests, hashes, frame/image IDs, dates, wavelength,
stretch, finding IDs or recorded marks. Old saved links remain coordinate-labeled;
no name is guessed from proximity and no target-hint parameter is introduced.

## Acceptance matrix

| Target | Name and alias acceptance | Identity guard | Existing archive outcome (not a new check) |
|---|---|---|---|
| Barnard’s Star | Apostrophe/case variants, GJ699, HIP87937, Gaia DR3 ID | Verified DR3 4472832130942575872; epoch-aware predictions remain separate | Processing limit; not a no-coverage claim |
| Epsilon Indi B | Explicit B, eps Ind B, epsilon variants | Clarify bare system/lowercase b; never relabel A/Ba/Bb as B | Retained 3.63 µm pair, alignment verified; identity ambiguous |
| WISE 0855 | Short name, full WISE and verified WISEA identifier | Nearby Gaia stars remain unrelated candidates | Retained 1.55 µm pair; target not expected detectable there |
| RW Aurigae | RW Aur and expanded name | A/B are separate from system context | Processing limit; no visibility claim |
| R Draconis | R Dra, expanded name, HIP81014, HD149880 and verified DR3 ID | Verified DR3 1648328016354496384; do not substitute its different DR2 ID | 3.25 µm pair, alignment unverified; core masked |

Coverage details remain the archive owner's `services/archive/README.md` and coverage
log. Naming does not repair those image-selection/detection gaps.

## Verification and local review

```sh
PYTHONDONTWRITEBYTECODE=1 services/catalogs/.venv/bin/python -m pytest -q -p no:cacheprovider services/catalogs/tests
npm run check
npm --prefix web run typecheck
npm --prefix web test
node --test web/src/viewer/*.test.mjs
npm run build
npm run dev:viewer
```

Open `http://127.0.0.1:5173/?fixtures=1`. Search `HIP879`, select Barnard’s Star with
ArrowDown/Enter, and try each preset. Search `epsilon indi` then explicitly select B.
`Fixture timeout`, `Fixture disabled`, `Fixture malformed`, an unknown query and
`Fixture slow` exercise failure/stale-response handling. Start the slow lookup and
immediately select another target. Change Archive response to Archive unavailable,
select a named target, then open a saved fixture; the replay must shed the prior name.
Synthetic images remain the same known-grid example, not detections of the named targets.

With Playwright installed (or `PLAYWRIGHT_MODULE` set to its module path):

```sh
node web/src/viewer/harness/names.browser.mjs
node web/src/viewer/harness/evidence.browser.mjs
```

`VIEWER_TEST_URL` overrides the origin. Browser checks block all external traffic,
exercise desktop/mobile names and replay, and verify production local-name fallback
with a mocked archive response. The final map check mocks Aladin and verifies distinct
field-center/source label payloads; it does not claim real HiPS rendering. Python tests mock all external SIMBAD calls, validate
the shared schema/snapshot, cache behavior, source-ID joins and an Astropy angular
propagation reference. These checks do not claim live SIMBAD, Gaia or archive verification.

For offline service/proxy review, run `CATALOGS_LIVE=0 npm run dev:gaia`. Main’s
development runner enables live Gaia by default; direct service configuration still
defaults to fixtures. External SIMBAD resolution remains separately opt-in through
`CATALOGS_EXTERNAL_RESOLVE=1`. Record any live exact-name check separately from fixtures.

## Ownership and coordinator integration

Catalog service owns curated identities, resolver, provenance and exact cross-ID joins;
inspector owns source labels/predictions; viewer owns local suggestions, requested-target
state and map labels. Coordinator-facing schema and representative responses live in
`fixtures/catalogs`, with `scripts/export-catalog-contract.py` and
`npm run generate:catalog-types` providing reproducible exports. No archive/finding
migration, auth change, UI branch import or new runtime dependency is required.


## Checkpoint 1 verification — 2026-11-15 UTC

This checkpoint closes naming only. The archive, image fixtures, evidence IDs and search
field centers are unchanged. No target recentering or archive selection work was done.

- R Draconis: SIMBAD's indexed primary identifier record associates DR3
  `1648328016354496384`; the exact ESA Gaia DR3 row was fetched successfully. Its DR2
  identifier is different and must not be used for a DR3 join.
- Epsilon Indi: Baig et al. (2024), Table 2, identifies `6412596012146801152` as Ba.
  The exact ESA DR3 row was fetched successfully. Inspector enrichment says **Epsilon
  Indi Ba**, never the B pair, Bb or A. A missing ID for Bb in that table does not prove
  absence from every catalog. The high RUWE is recorded as an astrometric caution.
- RW Aur: both candidate Gaia records exist, but indexed SIMBAD and primary literature
  give conflicting component assignments. Neither ID is promoted to an inspector name.
- SIMBAD: the real Vega adapter attempt and a same-origin `/api/resolve?name=Vega`
  request returned typed 503 `upstream_unavailable`. The CDS host returned HTTP 404
  "Page unavailable" at capabilities and direct TAP sync; its alternate host failed
  DNS resolution in this environment. No successful live canonical ID/alias lookup is
  claimed. External resolution remains opt-in.
- Gaia through the viewer proxy initially failed because this Python installation had
  no default CA file. Retrying with its installed certifi CA bundle, with TLS validation
  enabled, produced HTTP 200 and the correct R Dra/Ba identity joins. No system trust
  settings were changed and no certificate checks were disabled.

Dated machine-readable reports are under `fixtures/catalogs/verification`: the identity
review and exact DR3 astrometry, the initial same-origin attempt, and the CA-bundle retry.
Positions, reference epoch (2016.0), proper motion with units, parallax, available radial
velocity and RUWE are retained there. Live failures are retained alongside successes;
they are separate from synthetic test fixtures and image evidence.

Offline verification passed: 72 catalog tests, 26 viewer node tests, 48 inspector/findings
Vitest tests, both TypeScript checks, and desktop/mobile naming and evidence browser
scripts. The map boundary test uses a mocked Aladin API, not real HiPS rendering.

For normal offline review, start `npm run dev:viewer`, open `/?fixtures=1`, submit
`barnard`, and explicitly select its suggestion. Try `HIP81014` and `epsilon indi`.
The first asks for selection, the second resolves R Dra, and the third preserves B/Ba/Bb
ambiguity handling. Saved evidence must shed any previous requested-target label.

To reproduce opt-in live service checks, use the installed live requirements and run
`npm run dev:gaia` with both live flags set. If this Python has no trusted CA file, the
following repository-root command selects the installed trusted bundle for this process
only (stop another service already using port 8010 first):

```sh
services/catalogs/.venv/bin/python - <<'PYTHON'
import os, sys, requests
os.environ.update(CATALOGS_LIVE="1", CATALOGS_EXTERNAL_RESOLVE="1")
os.environ.setdefault("SSL_CERT_FILE", requests.certs.where())
os.execv(sys.executable, [sys.executable, "-m", "uvicorn", "app.main:app",
                         "--app-dir", "services/catalogs", "--port", "8010"])
PYTHON
```

With the viewer running on its usual port, review these same-origin requests:

```sh
curl --get --data-urlencode 'name=barnard' http://127.0.0.1:5173/api/resolve
curl --get --data-urlencode 'name=Vega' http://127.0.0.1:5173/api/resolve
curl http://127.0.0.1:5173/api/catalogs/gaia/1648328016354496384
curl http://127.0.0.1:5173/api/catalogs/gaia/6412596012146801152
```

The saved report records the observed upstream failure for Vega; a future successful
retry must validate canonical identity, finite degree coordinates and aliases before
being called live resolution success. Checkpoint 2 remains pending user review.


## Integration with main — 2026-11-15 UTC

The historical Checkpoint 1 results above describe the feature branch before this
integration. This integration preserves main's fullscreen Aladin, draggable Time and
Compare details panes, DSS switching, wavelength-frequency mapping and zoom loading.
Compact and advanced search now share an accessible target picker. Coordinate input
still bypasses naming, and loading a saved ID clears requested-target identity.
Time shows the requested name; Compare details holds aliases and provenance. A separate
map cross denotes the search field center. Source markers use only verified Gaia
identities and retain their original astrometry while predicting each displayed date.
Switching reference imagery hides a marker that belongs to the other imagery context.

Barnard's Star retains main's newer search center: RA 269.44630202°, Dec 4.76777074°.
Its snapshot provenance labels it an approximate Gaia prediction for 2025-11-07 UTC
(Julian year 2025.8494182067077), rather than the original J2000 position. The original
position and its epoch remain separately recorded as `referencePosition` in the curated
snapshot. This is a search-field default, not a measured image position. Existing saved
comparisons retain their recorded fields and image data. Other presets are unchanged.

The nearby route preserves main's `X-SPHEREx-Catalog-Mode` header and the inspector's
fixture/live guard. Mark actions retain the original astrometry plus optional display
metadata; missing proper motion or a nonfinite epoch cannot create a predicted marker.
The archive schema, image assets, comparison identity, observation dates and finding
marks are unchanged. Historical live reports are retained without being relabeled as
new integration checks.

The executed combined verification is recorded in
`web/src/viewer/verification/common-names-integration.json`. Browser checks use synthetic
or contract fixtures; naming label payloads use a mocked Aladin boundary, while the
native overlay and zoom diagnostics exercise the actual renderer with synthetic images.
No new live SIMBAD, Gaia or archive request is claimed by this integration.
