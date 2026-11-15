# SPHEREx viewer

From the repository root, use Node.js 20.19+ or 22.12+ and Python 3.12+ with
`venv` and `ensurepip` available. On Debian or Ubuntu, the system Python may
need the `python3-venv` package. On Windows PowerShell, use `npm.cmd` if script
execution policy blocks `npm`.

```sh
npm ci
npm run dev
```

`npm run dev` starts the viewer on port 5173, Gaia on 8010, and the SPHEREx archive
on 8000. Each backend creates its own `services/<service>/.venv` in the current
checkout and installs missing dependencies before starting. The same setup runs
with `npm run dev:gaia`, `npm run dev:spherex`, and the optional
`npm run dev:findings`. Set `SPHEREX_DEV_PYTHON` to a Python executable to choose
which interpreter creates new environments.

Use `npm run dev:viewer` to start only the frontend. Stop any earlier viewer
before starting the stack, or set `VIEWER_PORT` to use another viewer port.
Ctrl+C stops the stack.

Open the URL printed by Vite. The Aladin Lite map opens on Barnard’s Star in an orthographic globe view. Drag to rotate and scroll or pinch to zoom. The bottom-left map panel shows the ICRS map center (RA/Dec, decimal degrees on hover) and the field of view as width × height.

The reference sky defaults to the 0.771 µm layer of the [SPHEREx DR1 all-sky mosaic](https://doi.org/10.26131/IRSA679) from Caltech/IPAC IRSA. Use **SPHEREx** / **DSS** to switch between that mosaic and the DSS2 colour optical survey (CDS HiPS, served from the IRSA mirror with an ESA fallback). With SPHEREx selected, the slider steps through the 102 mosaic wavelengths (0.753–4.988 µm, read from the cube's `properties`); the blank dichroic channels 50 and 51 are skipped. Both are reference layers: the SPHEREx mosaic combines observations and DSS is not SPHEREx data. The comparison panel loads dated spectral images separately. If the imagery is unavailable, select **Retry imagery**, switch imagery, or search by coordinates.

Aladin Lite 3.8's `setSliceNumber` maps a slice to the wrong cube frame for this wavelength-ascending cube (slice 1 displays frame 95). The viewer sets the frequency of each frame's bin instead; see `spherexSliceFrequencyHz` in `spherexSurvey.ts`.

The ☰ **More map options** menu holds **All-sky view** / **Globe view** (360° Hammer–Aitoff overview), **Inspect map center**, and **Advanced search**.

The sky fills the viewport. Type an object name, a challenge target, or coordinates (`269.4521, 4.6934`, `17:57:48.5 +04:41:36`) in the top-left search box and press Enter to center the map and compare a 6 arcmin field. Names go to the catalog resolver. **Advanced search** opens the full form with separate RA/Dec, field width, and preset buttons. Open **Comparison** or **Gaia** in the top bar to show its panel. The panels become bottom sheets on narrow screens. Use **Close** or Escape to return to the sky. Closing the comparison panel pauses playback and keeps your place.

Click a dated image to open Gaia at the selected sky coordinate. Keyboard users can focus the image and press Enter to inspect its center. The selection stays at the same sky position across frames. A Gaia source marked from the inspector shows its proper-motion prediction at each displayed frame's observation time. These marks are local to the current viewer session.

Pan and zoom, then select **Compare this field** once the map width is within the archive's 1–30 arcmin range. You can also submit RA/Dec in decimal degrees or sexagesimal form in the search box or **Advanced search**, or select any of the five target presets. Presets are field centers from the project brief, [SIMBAD](https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=Barnard%27s+star), [SIMPLE](https://simple-bd-archive.org/load_solo/epsilon%20IndiB), [Chandra](https://cxc.cfa.harvard.edu/target_lists/cycle21/cycle21_approved_peer_targets_by_radec.html), and [AAVSO](https://archive.aavso.org/index.php/aavso-bulletin-coordinates).

Open `/?fixtures=1` in development to exercise the browser-only fixture controls. Choose **Archive unavailable** to exercise the outage state, **Open saved fixture** to load the synthetic pair, and **Try missing ID** to check the missing-evidence state. Run `npm.cmd run build` from the repository root to type-check and build the viewer.

## SPHEREx archive integration

Vite proxies `/api/comparisons` and its asset paths to port 8000. Set `ARCHIVE_API_TARGET` before starting Vite to change the target. In deployment route the same paths to a single archive worker with persistent storage and a proxy timeout above the build deadline.

Search requests go to IRSA by default. For an offline integration check, start the archive with `-m services.archive --synthetic serve` and search RA 10°, Dec 20° at 6 arcmin. **Open saved real example** replays the bundled IRSA tutorial pair by its immutable ID in either mode. **Copy comparison link** opens the exact saved comparison on the same service. Regenerate the frontend archive types with `npm.cmd run generate:archive-types` after a schema update.

## Gaia catalog integration

Vite proxies `/api/resolve` and `/api/catalogs` to the [catalog service](../../../services/catalogs/README.md) on port 8010. Set `CATALOG_API_TARGET` before starting Vite to use a different address. To try the built viewer, run `npm.cmd run build` followed by `npm.cmd run preview` while the two backend processes are running.

Check `http://127.0.0.1:8010/api/health` for the catalog service and `/api/catalogs/nearby?ra=269.4521&dec=4.6933&radiusArcsec=30` on the viewer origin for the proxy. Both should return JSON. When serving the built viewer on another host, route `/api/catalogs/*` and `/api/resolve` to the catalog service before applying the frontend's HTML fallback.

Choose **Inspect map center** or click a sky position to query Gaia. On the SPHEREx mosaic, the inspector checks a wider catalog cone and keeps sources whose predicted positions are close to the clicked sky position. Near Barnard's Star, it also fetches the exact Gaia source ID because the catalog cone can omit fast-moving stars. **Mark approximate mosaic position** uses the DR1 survey midpoint as a guide and keeps Gaia's catalog position visible in the inspector. The Barnard's Star preset is centered on this same prediction. Dated frames use their own timestamps. The mosaic combines observations from different dates. [IRSA DR1 release notes](https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-releases/)

The npm launcher enables live Gaia by default. Set `CATALOGS_LIVE=0` to run the standalone catalog fixtures. The real viewer requires live catalog data for source markers.

## Coordinator handoff

The harness injects a fixture data source. The viewer-facing TypeScript types describe the UI inputs and states. When the coordinator publishes OpenAPI, the production adapter will consume its generated types and map them into the viewer. The shared contract and representative fixtures need to specify:

- The comparison search bounds and default field size, all five search outcomes, and any comparison payloads allowed for each outcome.
- An ICRS TAN grid for the rendered cutouts, including dimensions, reference sky coordinates, reference pixel, and a 2×2 transform in degrees per pixel. Define the pixel origin against the rendered image's top-left pixel center and provide an Astropy reference point for verification.
- Durable comparison IDs and frame image URLs, common stretch and wavelength bounds, observation UTC times, per-frame release/source links and quality flags, plus an ID for the saved real outage example.
- The saved comparison ID referenced by each finding and its frame-specific marks as frame IDs and sky positions. Provide the shared error response for missing IDs.

In the shared app, Vite will proxy relative `/api` requests to the local FastAPI entry point. Deployment will route the same paths through the public origin. Keep the harness entry point and its synthetic images on the development side when integrating the shared app.

## Checkpoint 5: saved evidence (development fixtures)

No Python services or archive access are required for this check:

```sh
npm ci
npm run dev:viewer
```

Open `http://localhost:5173/?fixtures=1&comparison=fixture-matched-pair&finding=fixture-finding`.
The synthetic discussion exposes **Show evidence** and **Copy link** through the
`EvidenceDiscussionProps` slot boundary. Replay loads the stored comparison by ID;
it does not search using current field, scenario, wavelength or stretch defaults.
Saved marks appear only on their recorded frames. Playback starts paused at the
first date. **Copy comparison link** intentionally omits the discussion ID.

1. Select **Next** and **Previous** and check the two dates and frame-specific marks.
2. Use **Copy link** in the fixture discussion, change the search field and archive
   scenario (for example **Single epoch**), then reopen the copied URL in a fresh
   browser session. Both original dates, assets, wavelength, stretch and marks return.
3. Use **Try missing ID**, **Try missing finding**, and **Try mismatched evidence**.
   Each must show an explicit error with no unrelated frames or marks.
4. A link with only `finding=fixture-finding` resolves its saved comparison; browser
   Back/Forward also restores link parameters. If clipboard access fails, use the
   visible **Saved evidence link**.

Run `node --test web/src/viewer/evidence.test.mjs` with Node 22.18+ (or Node 24)
and `npm run build` from the repository root. The tests cover ID handling and
annotation validation. These are synthetic replay checks, not live findings/auth
integration. The findings owner can implement `EvidenceDiscussionProps`; production
finding lookup remains for the later integration checkpoint. Fixture discussion and
assets are loaded only in development fixture mode.

The offline browser regression is retained in `harness/evidence.browser.mjs`.
With Chrome installed and the fixture server running, run it without changing the
repository dependency manifests:

```sh
test_tools=$(mktemp -d)
npm install --prefix "$test_tools" --no-package-lock playwright
PLAYWRIGHT_MODULE="$test_tools/node_modules/playwright/index.mjs" node web/src/viewer/harness/evidence.browser.mjs
```

Set `VIEWER_TEST_URL` if using another port. The regression blocks external network
requests and checks desktop/mobile replay, actual image decoding, saved marks,
Show evidence, clipboard links, changed search/scenario defaults, missing IDs,
mismatched IDs and finding-only links. It uses synthetic data throughout.

## Checkpoint 6: production adapter and reusable viewer

The public entry is now `main.tsx`, which mounts the exported `Viewer` using
`createViewerDataSource()` and an inspector slot wrapping the catalog owner's
`SourceInspector`. The root `npm run dev:viewer`, `check`, `build`, and `preview`
commands provide the shared tooling. No separate runner dependencies were added.
The `harness/` directory is only loaded in development with `?fixtures=1`; its
controls, discussion fixture and synthetic PNGs are excluded from production builds.

The production adapter implements all three `ViewerDataSource` operations:

- Search: `GET /api/comparisons?ra&dec&fovArcmin`.
- Saved replay: `GET /api/comparisons/{id}`, without issuing a search or applying new defaults.
- Name lookup: `GET /api/resolve?name`, using the catalog owner's typed client.

Archive responses use `archive.generated.ts`, verified against
`fixtures/archive/openapi.json`. The adapter preserves asset URLs, observation dates,
WCS, provenance and completeness diagnostics, maps the saved stretch bounds to the
viewer, and sorts frames chronologically without mutating the response. Bounds of
1–30 arcmin are shared with the controls and checked against OpenAPI by the tests.
Requests forward abort signals. Missing names and saved IDs, malformed responses,
archive HTTP errors and domain outage statuses remain distinct.

`ViewerProps` supplies the data source, inspector slot, optional discussion slot and
finding loader. The shell owns concrete clients. The viewer no longer imports the
fixture adapter or fetches name resolution through a second fallback client. In
fixture mode an unknown name stays unknown and never falls through to a real service.

Run contract verification without Python, FastAPI or archive access (Node 22.18+ or 24):

```sh
node --test web/src/viewer/production.test.mjs web/src/viewer/evidence.test.mjs
npm run build
```

For the built-app browser smoke test, start `npm run preview -- --port 5176`.
Using the temporary Playwright installation described above:

```sh
PLAYWRIGHT_MODULE="$test_tools/node_modules/playwright/index.mjs" VIEWER_TEST_URL=http://localhost:5176 node web/src/viewer/production.browser.mjs
```

This test intercepts the same-origin API routes with the archive owner's responses
and retained synthetic PNG blobs. It checks name-to-search wiring, image decoding,
stepping, the inspector slot, saved replay without search, outage/retry, and that
`?fixtures=1` cannot activate fixture controls in the public build. External network
requests are blocked. Run the checkpoint 5 browser regression against the development
server as well; the same reusable viewer is used in both modes.

### Coordinator handoff and remaining dependencies

The available OpenAPI covers archive routes only. The resolver uses the existing
catalog owner's typed client and documented preset fixture until the coordinator
publishes its generated shared schema. There is no findings UI or service in this
checkout; the public shell therefore leaves `Discussion` and `loadFinding` unset,
while development injects their fixture implementations. No parallel wire schema was
introduced for these missing owners. Connect their components through `ViewerProps`
when delivered; findings links in the public app currently show an explicit
not-connected message rather than silently dropping the finding ID.

Checkpoint 6 verification used local contract fixtures and mocked HTTP in Chrome;
it did not contact the archive, Gaia, auth or a deployed origin. Live services,
five-target coverage, posting and cross-session auth remain checkpoint 7 work.
The production build still reports the existing large Aladin bundle warning.

## Checkpoint 7: local live integration (partial)

Per the user's local-only scope, checks used a local Vite production preview with
same-origin FastAPI proxies. See `verification/checkpoint7-local.json` for executed
results and the distinction between fresh checks and reviewed owner logs.

Verified on November 14, 2026:

- A cold real WISE 0855 search, using an empty temporary archive cache, returned a
  matched pair in 24.3 s. Source observation dates were May 6, 2025 and May 13, 2026.
- Chrome decoded and played both real 59×59 frames. A second anonymous browser
  context restored the identical manifest and SHA-256 image bytes without searching.
- The live Gaia service returned 15 sources near the separate catalog test position
  in 3.2 s. Cutout inspection returned four sources; actual source detail/provenance
  loaded, and a predicted Gaia marker appeared only on its recorded image frame.
- Four points on the real rendered grid agreed with Astropy to better than 1e-8 deg
  and 1e-6 pixel. This validates this grid transform, not a new empirical alignment
  or detection-significance claim.
- An isolated backend with an unreachable upstream proxy produced the real archive
  failure response through the same viewer origin. The UI showed failure and retry,
  no unrelated frames, and successfully opened the labeled saved real tutorial pair.
  Browser APIs were not mocked. The working service was restored afterward.

The cold-request comparison and original FITS assets were also published unchanged,
with conflict/integrity checks, to the normal local archive store. While the usual
local stack is running, replay it at:

`http://localhost:5173/?comparison=e618fdf2cf94dcb0d5321b4fabc3852e3a5d9e0449dad96b4a160ee08f2ad61f`

The local evidence store is ignored runtime data, not a new bundled fixture. Keep
`services/archive/.local-data/evidence` intact to retain this link. The temporary test
cache is not the sole retained copy of this pair.

### Repeat the live checks

Use the existing archive command on port 8000, and start Gaia in **live** mode on a
separate port with live mode enabled:

```sh
cd services/catalogs
CATALOGS_LIVE=1 .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8011
```

From the repository root, serve the built app with that catalog target:

```sh
CATALOG_API_TARGET=http://127.0.0.1:8011 npm run preview -- --port 5177
PLAYWRIGHT_MODULE="$test_tools/node_modules/playwright/index.mjs" COMPARISON_ID=e618fdf2cf94dcb0d5321b4fabc3852e3a5d9e0449dad96b4a160ee08f2ad61f node web/src/viewer/live.browser.mjs
```

`VIEWER_TEST_URL`, `COMPARISON_ID` and optional `REPORT_FILE` configure the browser
check. It requires a saved real comparison and running real services. It asserts
Gaia's source-detail link when sources are returned. If your Python installation
cannot validate the service certificates, configure `SSL_CERT_FILE` and
`REQUESTS_CA_BUNDLE` to a bundle from your trusted system roots. Do not disable TLS
verification. This run used such a bundle without changing repository dependencies
or system trust settings. No keys or authentication tokens are needed for archive
or public Gaia reads.

To check WCS, save a comparison response JSON, then run:

```sh
RESPONSE_FILE=/path/to/response.json node web/src/viewer/verify-wcs.mjs
```

This uses the archive environment's Astropy. Set `ARCHIVE_PYTHON` to another declared
archive interpreter when needed (including Windows).

`outage.browser.mjs` is a separate check for a deliberately unavailable upstream.
Run it **only against an isolated test archive instance**, not the working local
stack. For example, start the archive on port 8002 with a separate storage directory
and `HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9`.
Point a separate preview at port 8002 with `ARCHIVE_API_TARGET`, run the script with
`VIEWER_TEST_URL` set to that preview, then stop the isolated failure instance. Saved
real example replay should still work because the local backend remains available.

### Five targets and pending findings/auth

The checked-in archive coverage log records five earlier upstream failures. The
archive owner's newer local `coverage-run3.json` records real pairs for Epsilon Indi B,
WISE 0855 and R Draconis, and `PROCESSING_LIMIT` for Barnard's Star and RW Aurigae.
The report retains their exact coordinates, IDs, timestamps and configuration.
Those reviewed results use older finding centers (especially Epsilon Indi B); they
are not a new run of all current viewer presets or proof of missing coverage for
failed requests. No visible change or discovery was claimed.

The user is merging Supabase development from `main`. Findings/auth integration is
pending that merge. Delivered remote findings branches were inspected without
merging or copying cross-owner source files. After the merge, wire the actual
findings component/client and browser session through the app shell, mount/proxy its
same-origin routes, and use two distinct sessions to test post, public replay,
signed-out write denial and a signed-in reply. Checkpoint 7 is not complete until
those checks pass. Deployment checks do not apply to this local-only app.
