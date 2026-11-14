# Implementation contract and five agent handoffs

Read the shared project brief first. The coordinator commits this contract as OpenAPI plus representative response fixtures. JSON uses camelCase, coordinates are ICRS decimal degrees, timestamps are UTC ISO 8601, angular and wavelength units appear in field names, and external source IDs are strings. Nullable measurements use null. Validate finite coordinates, Dec in [−90, 90], RA in [0, 360), and positive bounded search sizes. Normalize sexagesimal input in the viewer. Use an error body {code, message} for malformed requests, missing records and unauthorized writes. The fixtures below describe interfaces to implement, not existing endpoints.

## Shared interface

| Operations | Minimum request and response |
|---|---|
| GET /api/comparisons?ra&dec&fovArcmin | Returns {status, comparison}. Status is ready, single_epoch, no_coverage, no_comparable_pair or upstream_unavailable. Comparison, when present, has {id, field, wavelengthRangeUm, stretch, grid, frames}. Field has {ra, dec, fovArcmin}. Grid records dimensions and sky projection. Each frame has {id, observedAtUtc, wavelengthUm, release, imageUrl, sourceUrl, qualityFlags}. Store the manifest and rendered assets durably before returning a shareable ID. |
| GET /api/comparisons/{id} | Returns the saved manifest and immutable asset references. Republishing data or changing default wavelength selection does not change a prior comparison. |
| GET /api/resolve?name | Returns {name, ra, dec}. Use bundled target presets independent of external name lookup. |
| GET /api/catalogs/nearby?ra&dec&radiusArcsec | Returns {sources}. Each row has {sourceId, ra, dec, refEpoch, pmRaCosDecMasYr, pmDecMasYr, parallaxMas, gMag, separationArcsec}. Distinguish empty results from service errors. |
| GET /api/catalogs/gaia/{sourceId} | Returns the same astrometry plus available uncertainties, radial velocity, BP/RP magnitude and source provenance. Optional fields can be null. Display measured values with units. |
| GET /api/findings?ra&dec&radiusDeg&zoom | Returns bounded {items}, each a pin {id, ra, dec, title} or cluster {ra, dec, count, zoomTo}. Return clusters at wider zoom and apply a bounded result limit. |
| POST /api/findings | Authenticated request {comparisonId, ra, dec, title, note, marks}. Optional marks are {frameId, ra, dec} entries. Validate IDs against the saved comparison. Return {id}. |
| GET /api/findings/{id}, POST /api/findings/{id}/replies | GET returns public finding evidence, author display name and replies. POST takes {text} and derives author identity from auth, returning the created reply. |

Shared frontend slots are fixture-tested React components. Viewer exposes field selection, sky click, active frame, map zoom, marker selection and overlay registration via controlled props and callbacks. The inspector and findings UI render in ordinary standalone harnesses during development. The app shell places them in a common map panel at integration. Use query parameters `comparison` and `finding` for exact replay and thread opening. A findings pin and a selected image position use the same sky coordinates.

## Assign one brief per agent

Give each agent both documents and their numbered brief. Start the agent in its own worktree. Ask it to first return a short implementation checklist with its dependencies, file ownership and acceptance commands, then build its assigned slice. Other agents are working concurrently. Keep edits inside the assigned paths, preserve other changes, and send shared changes to the coordinator. End with a commit, verification result, integration notes and open gaps.

### 1. SPHEREx archive and image preparation
Own `services/archive/**` and `fixtures/archive/**`. Implement both comparison routes and durable asset/manifest storage. Use IRSA SIA2 with DR1 and QR3, followed by on-premises URL cutouts with center and size. Use wavelength at the target, image flags and WCS to select comparable exposures and register them on one grid. Use one fixed shared stretch. Return actual dates and release/source links. Save one real fixture and a five-target coverage log. Test one epoch, mismatched channels, invalid crop, upstream failure and ID replay. [IRSA cutout notebook](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/)

### 2. Map, playback and display settings
Own `web/src/viewer/**`. Build the base Aladin map, coordinate and preset search, field control, matched monochrome blink, timeline and comparison metadata. Implement the map’s panel host and marker primitives. Consume typed inspector and activity slots using fixture components. Show changing fields, fetch progress, empty results and saved-example states. Display preset extensions belong here after the MVP. Verify identical framing while stepping, responsive panels and replay from a copied link.

### 3. Catalog service and source inspector
Own `services/catalogs/**` and `web/src/inspector/**`. Build name resolution, bounded Gaia DR3 TAP cone search and exact source-ID detail. Export the inspector as a component that takes sky position and optional selected frame metadata and emits a mark action. Present catalog position, reference epoch, proper motion, parallax and photometry if available. If adding a propagated marker, account for epoch and label it as predicted. Use known, ambiguous, unmatched and unavailable fixtures. No shared map windowing edits. [Gaia TAP client](https://docs.astropy.org/projects/astroquery/en/stable/gaia/gaia.html)

### 4. Findings backend and auth
Own `services/findings/**` and `supabase/**`. Implement findings and replies routes, migrations, auth integration and viewport query. Public reads expose display names and evidence, with emails kept private. Authenticated writes derive identity from the session. Validate evidence references, limit result and text sizes, use plain text rendering and give the coordinator a hide action. Keep Supabase privileged credentials server-side. Deliver fixture responses plus smoke tests for anonymous read, anonymous write denial, valid post, invalid comparison and second-account reply.

### 5. Findings UI and map activity
Own `web/src/findings/**`. Build activity toggle, cluster/pin data adapter, selected-pin discussion panel, signed-in composer and reply form. Use stub marker callbacks and fixture API responses in a standalone harness. Accept comparison ID and sky selection as props from the app shell. **Show evidence** restores exact frames and annotations, and **Copy link** includes both IDs. Handle loading, no findings, failed writes and sign-in return. Verify the complete fixture-backed flow before backend integration.

## Merge and demo order

The coordinator wires archive + map first, then catalog inspector, then findings backend + UI. Test contracts against fixtures before merging and smoke test real data after the first join. Before release, verify on the deployed origin with a cold request and a simulated archive failure. Use two browser sessions to prove public read, auth, posting and reply. Log actual coverage for each required target and show one observed change with metadata and source links. 

