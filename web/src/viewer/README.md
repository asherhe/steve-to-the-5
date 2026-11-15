# Current local demo

Open `http://localhost:5173/` after `npm run dev`. The map controls switch SPHEREx, DSS and WISE. **Time → Open saved real example** loads the recorded six-arcminute Barnard’s Star field (`fixtures/archive/real-barnard/`): two 4.29 µm frames 393 days apart in which the saturated star visibly shifts about 2 pixels north. The earlier WISE 0855 pair stays retained by ID, but WISE 0855 is far too faint at 1.55 µm to appear in it. Candidate review, posts, rankings and replies use a clearly labeled browser-only simulation; no sign-in is needed. Set `VITE_LIVE_FINDINGS=1` only when the real backend is configured. See `docs/verification/local-demo-update.md` for coordinates, limitations and checks.

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

The reference sky defaults to the 0.771 µm layer of the [SPHEREx DR1 all-sky mosaic](https://doi.org/10.26131/IRSA679) from Caltech/IPAC IRSA. Use **SPHEREx** / **DSS** to switch between that mosaic and the DSS2 colour optical survey (CDS HiPS, served from the IRSA mirror with an ESA fallback). With SPHEREx selected, the slider steps through the 102 mosaic wavelengths (0.753–4.988 µm, read from the cube's `properties`); the blank dichroic channels 50 and 51 are skipped. Both are reference layers: the SPHEREx mosaic combines observations and DSS is not SPHEREx data. Dated spectral images appear inside their outlined, sky-aligned footprint; their date selection is separate from the reference-layer wavelength slider. If the imagery is unavailable, select **Retry imagery**, switch imagery, or search by coordinates.

Aladin Lite 3.8's `setSliceNumber` maps a slice to the wrong cube frame for this wavelength-ascending cube (slice 1 displays frame 95). The viewer sets the frequency of each frame's bin instead; see `spherexSliceFrequencyHz` in `spherexSurvey.ts`.

**Scan wavelengths**, on the wavelength ruler under the map, steps the map layer through the cube's wavelengths from short to long and loops until you press **Stop scan**, drag the ruler or use its keys. It shows the combined all-sky mosaic, not dated frames, at your current position and zoom.

To make that instant, the ruler **preloads ten wavelengths**, evenly spaced from the shortest up to band 5, once the map has been still for about 1.5 s, and shows "Preloading wavelengths n/10" until "10 wavelengths ready". It fetches each one's tiles for the current view into the browser cache (`tileWatch.ts` records which tiles Aladin asked for, since Aladin reports no loaded signal, and fetches the same tiles for the other wavelengths). The scan cycles through those ten (`scanSampleCount` in `spherexSurvey.ts`), not all 99, and stops at the end of band 5 (4.405 µm): the map drew white for band 6 even with every tile cached, so the scan leaves it out. The ruler still sets any wavelength. The **Speed** control beside the button sets how long each wavelength stays up: 0.5× to 8× of a 250 ms base step (500 ms down to about 31 ms), 2× at first; changing it does not restart a running scan. The scan only steps through wavelengths that are already loaded, so it never waits and never shows an unloaded tile; pressing it early scans what is ready so far. Panning or zooming restarts the preload for the new view (tiles already fetched stay cached). IRSA's tile server serves roughly one wavelength a second, so a first preload takes about ten seconds and about 12 MB at the full-globe view (about 11 tiles of 100 KB per wavelength; zoomed-in views need fewer tiles). Slices 0, 50 and 51 have no tiles and are skipped. A background tab pauses the preload and scan.

Pan and zoom, then select **Compare this field**. The button turns amber once the map is under 10° wide. If the view is 1–10 arcmin wide that view is compared; from a wider view a 10 arcmin field at the map centre is compared (the services themselves accept up to 30 arcmin for SPHEREx and 12 for WISE, which the search form can still request), and a dashed box marks it. Once a comparison is requested, its field stays outlined at its sky position while it builds, however you move the map, and **Cancel build** in the panel stops it (the service stops too). While a comparison builds, the panel shows a progress bar: measured steps for WISE, elapsed time for SPHEREx, whose archive does not report progress. You can also submit RA/Dec in decimal degrees or sexagesimal form or select any of the five target presets. Presets are field centers from the project brief, [SIMBAD](https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=Barnard%27s+star), [SIMPLE](https://simple-bd-archive.org/load_solo/epsilon%20IndiB), [Chandra](https://cxc.cfa.harvard.edu/target_lists/cycle21/cycle21_approved_peer_targets_by_radec.html), and [AAVSO](https://archive.aavso.org/index.php/aavso-bulletin-coordinates).

The ☰ **More map options** menu holds **All-sky view** / **Globe view** (360° Hammer–Aitoff overview), **Inspect map center**, and **Advanced search**.

The sky fills the viewport. Type an object name, a challenge target, or coordinates (`269.4521, 4.6934`, `17:57:48.5 +04:41:36`) in the top-left search box and press Enter to center the map and compare a 6 arcmin field. Names go to the catalog resolver. **Advanced search** opens the full form with separate RA/Dec, field width, and preset buttons. Loading images opens the compact **Time** window and a dated image overlay on the sky. The earliest observation starts paused. Use the snapping timeline, previous/next buttons, or **Blink A ↔ B** to change dates. Choose A and B from their date selectors; the timeline preserves actual gaps between observations. **Compare details** opens the larger cutout, metadata and sharing pane when needed. **Inspect** opens the source inspector. These panes can remain open together. Drag a pane by its heading, or focus the heading and use arrow keys. Each pane can collapse; use its close button or Escape to close it. **Reset layout** restores default positions. Closing Time pauses playback and preserves the active date; reopening it does not resume automatically.

Click a dated image to open Gaia at the selected sky coordinate. Keyboard users can focus the image and press Enter to inspect its center. The selection stays at the same sky position across frames. A Gaia source marked from the inspector shows its proper-motion prediction at each displayed frame's observation time. These marks are local to the current viewer session.

Pan and zoom, then select **Compare this field** once the map width is within the archive's 1–30 arcmin range. You can also submit RA/Dec in decimal degrees or sexagesimal form in the search box or **Advanced search**, or select any of the five target presets. Presets are field centers from the project brief, [SIMBAD](https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=Barnard%27s+star), [SIMPLE](https://simple-bd-archive.org/load_solo/epsilon%20IndiB), [Chandra](https://cxc.cfa.harvard.edu/target_lists/cycle21/cycle21_approved_peer_targets_by_radec.html), and [AAVSO](https://archive.aavso.org/index.php/aavso-bulletin-coordinates).

Open `/?fixtures=1` in development, open **Time**, and expand **Development fixtures** to exercise the browser-only fixture controls. Choose **Archive unavailable** to exercise the outage state, **Open saved fixture** to load the synthetic pair, and **Try missing ID** to check the missing-evidence state. Run `npm.cmd run build` from the repository root to type-check and build the viewer.

## WISE view

The **SPHEREx / WISE** switch in the top bar changes which survey the viewer shows. It
swaps the map's image layer inside the same Aladin view, so the centre, zoom and
projection stay exactly as they were. `SkyMap` takes the survey as its `survey` prop.

In WISE view:

- The map shows the AllWISE colour composite (W4 red, W2 green, W1 blue), read from
  IRSA's mirror with CDS as fallback. It is a reference layer made from 2010–2011
  exposures and carries no dates. Its colours show which band is brighter; they do not
  measure temperature or composition.
- The dock under the map lists those channels and picks the time-lapse band (W1 or W2)
  in place of the SPHEREx wavelength ruler.
- **Time-lapse** replaces **Comparison**. It plays dated frames from the
  [WISE time-lapse service](../../../services/wise/README.md): six visits spread evenly
  from 2010 to 2024, with the same playback, timeline, Gaia inspection and limitations list. Fields
  are 1–12 arcmin here, against 1–30 for SPHEREx.

Each view keeps its own request and result. Switching away and back shows what was
there without searching again, and a build started in one view keeps running while you
look at the other. When the other view has a compared field, the empty panel offers to
compare that same field in the current view. Nothing is searched until you ask.

WISE comparisons have their own IDs and evidence store. Links to them carry
`view=wise`; switching views removes `comparison` and `finding` from the address,
because those IDs belong to the view they were opened in. Findings cannot yet reference
a WISE comparison. The switch is shown only when the shell passes `wiseDataSource` to
`Viewer`, so the fixture harness is unchanged.

Run `node --test web/src/viewer/wise.test.mjs` for the adapter's routing checks. Vite
proxies `/api/wise` to port 8020 (`WISE_API_TARGET`), which `npm run dev` now starts.

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

## Floating time workspace

Aladin remains fullscreen. `usePlayback.ts` owns the selected observation, A/B
endpoints, speed, and decoded-image status. The Time window, dated sky overlay,
optional details preview, sky selections and inspector all use that same frame.
Manual scrubbing, stepping or endpoint changes pause blink. Playback also pauses
when Time closes or the browser tab becomes hidden. Collapsing a pane retains its
state. A single observation remains viewable with blink disabled.

`DatedSkyOverlay.tsx` uses Aladin's native PNG/WCS image layers. It passes the saved
FITS header and rendered dimensions, keeps inactive layers transparent, and draws
a sampled sky-coordinate footprint and frame-specific marks. It uses the saved
rendered PNGs without re-stretching or reprocessing them. Unsupported grids have an
explicit details-only fallback. Image failures disable blink and expose retry.
The field label in Playback settings identifies the loaded field; map browsing
alone never starts another archive comparison or alters the loaded grid.

`FloatingPane.tsx` supplies drag handles, pointer capture, keyboard movement,
collapse, close, stacking, viewport bounds, and reset behavior. The top toolbar
remains accessible above the panes. Map controls collapse initially on narrower
screens, and touch devices can drag the same handles. Layout is session state;
it is separate from the saved scientific comparison identity.

Try the browser-only synthetic examples:

- `/?fixtures=1&comparison=fixture-matched-pair`: two dated frames.
- `/?fixtures=1&comparison=fixture-irregular-times`: three observations with visibly unequal time gaps.
- `/?fixtures=1&comparison=fixture-single-epoch`: one still, no blink.
- `/?fixtures=1&comparison=fixture-matched-pair&finding=fixture-finding`: saved frame marks and discussion replay.

Verification commands from the repository root:

```sh
node --test web/src/viewer/timeline.test.mjs web/src/viewer/evidence.test.mjs web/src/viewer/production.test.mjs
npm run build
PLAYWRIGHT_MODULE="$test_tools/node_modules/playwright/index.mjs" VIEWER_TEST_URL=http://localhost:5173 node web/src/viewer/time-window.browser.mjs
PLAYWRIGHT_MODULE="$test_tools/node_modules/playwright/index.mjs" VIEWER_TEST_URL=http://localhost:5173 node web/src/viewer/overlay.browser.mjs
```

Use the temporary Playwright installation described earlier. The time-window test
checks irregular date spacing, distinct A/B blink, pointer and keyboard scrubbing,
shared details/inspector state, drag and touch movement, collapse/close/reset,
viewport resizing, single-epoch behavior, image retry, and saved finding links.
The overlay diagnostic uses an asymmetric synthetic RGBA image to check orientation,
exact colour values, transparency, zoom/pan/projection, and absence of comparison
searches during browsing. It needs no live archive or catalog.

The existing `production.browser.mjs`, `harness/evidence.browser.mjs` and
`live.browser.mjs` checks now use Time controls and explicitly open Compare details.
Real-service checks use a retained real pair and real Gaia reads; they do not claim
a new archive coverage result, a significant change, or a discovery.

## Integrated common names

See [five-target naming and integration verification](../../../docs/common-names.md).
Compact and advanced search share offline names and aliases. Exact names select a target
identity; coordinate searches and saved replay do not infer one. The shared snapshot
retains the newer Barnard center and its prediction epoch.

### Check a point against the catalogs

**Double-click** the map, on the reference map or on a dated frame, to mark that sky point. The map centres on it and Aladin's crosshair turns into an amber box with an X, which stays at that sky position as you pan (the crosshair returns when the mark is off centre). A double-click does not also open the Gaia inspector: single clicks wait 280 ms (`doubleClickMs` in `SkyMap.tsx`) to tell the two apart. Keyboard users can choose **Check map center against catalogs** from the map menu.

The **Check this point** pane (`PointCheck.tsx`) runs the six-catalog chain at once through the public `GET /api/catalogs/review` with a 30″ radius by default (10, 120 and 300 are offered). No sign-in or comparison is needed. A point on a loaded dated frame sends that frame's observation time, so SkyBoT checks known asteroids at it. A point on the undated mosaic sends no time and SkyBoT is reported as not checked; no time is substituted. The summary (`catalogCheckSummary.ts`) says how many catalogs list something, the nearest returned record per catalog (as published, not propagated), and treats any unavailable or skipped catalog as an incomplete check, never as an empty one. An empty result is described as worth a closer look, not as a discovery. For a point on a dated frame, **Continue to candidate review** opens the signed-in review below with that frame and point selected. The pane also lists nearby Gaia DR3 sources, nearest first; **Show on map** draws one with the source inspector's marks: predicted for the frame time on a dated frame, for the approximate mosaic date on the SPHEREx mosaic, or at the catalog position on DSS/WISE. Below the results the pane shows the expected leaderboard points (10 for a known object; 20 for a point no catalog lists, if the server measures it bright in two surveys; otherwise 0) and, for an uncatalogued point, which surveys have saved frames at the point with **Load … frames here** buttons. **Submit to leaderboard** opens the review with the same radius and sends the other survey's saved comparison for the brightness test; the server recomputes the points (see `services/findings/README.md`). In the local simulation the catalog check is live but brightness is not measured, so only the 10-point rule can be reached. The header no longer has Gaia or Review candidate buttons: a single click opens the inspector, and the review opens from this pane or from the inspector's **Review this point**.

### Candidate review workflow

The production entry mounts `App.tsx`: public findings reads, a real leaderboard client,
Supabase email link/code sign-in, the six-catalog review pane, composer and discussion.
Select a point on a saved dated image, choose **Review this point**, sign in and run checks.
The review is invalidated by a different point/frame/radius/survey/account. Posting locks
its original frame mark and opens the refreshed participation leaderboard and thread.
Community findings can be toggled in their own pane (**Show on map**); pins open threads and clusters zoom. Rows and map pins share numbers in the chosen sort (Newest, Most replies, Nearest), hovering either highlights both, and the open thread stays marked. Rows show author, time, reply count, survey and distance from the map centre; the first four come from `GET /api/findings` once migration `20261115160000_findings_viewport_summary.sql` is applied, and are simply left out by older servers.

`Open saved real example` fits the footprint and opens an enlarged Compare details pane.
Use its image controls or the Time pane to blink. Enlargement changes only CSS dimensions.
The example can be a different field and is not a claimed cold-object detection.

The main app still works without findings running. Sign-in, review writes and public boards
show explicit service errors instead of displaying invented entries. Configure Supabase and
start `npm run dev:findings` when ready; see the findings README. Share links drop auth/draft
parameters, preserve WISE identity, and load exact saved evidence. A finding-only link reads
its recorded survey before selecting an evidence store.

Local checks:

```sh
npm run build
npm --prefix web test
node --test web/src/viewer/*.test.mjs
npm run preview -- --host 127.0.0.1 --port 5188
# Separate terminal; install Playwright in a local test directory if not present.
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node web/src/viewer/masterplan.browser.mjs
```

The browser script intercepts auth/catalog/findings, replays retained real image bytes and
saves screenshots under `.local-test-temp/masterplan-browser/`. It never writes to a real
account or service. This proves local UI integration, not hosted Supabase authentication.


## NEOSSat reference panel

The **NEOSSat** button beside the viewer panel controls opens a draggable optical-reference
panel. The first opening with a selected position makes one request; subsequent opens,
map navigation, point selection, wavelength changes and playback retain that snapshot.
Only **Refresh** repeats the query for the current selected point. Search coordinates,
resolved targets, map clicks and dated-image clicks supply the selection. Without a
selection, Refresh is disabled. Closing/reopening and resetting layout retain the images.

The panel uses `GET /api/catalogs/neossat?ra&dec` on the existing catalog service/proxy.
Start that service in live mode (`npm run dev:gaia`, or `CATALOGS_LIVE=1`); offline mode
returns an explicit unavailable response. CADC metadata is queried server-side because
its TAP endpoint does not expose browser CORS headers. No new runtime dependencies or
service port are needed. Deployed installations need the same updated catalog service.

Results are full-frame CADC previews whose recorded footprint contains the point, with
actual observation start times converted from MJD to UTC. The panel shows up to 12 distinct
observations, newest first, preferring CORD/COR/CLEAN over RAW among retrieved products.
Discovery scans at most 61 preview records and reports when either bound limits the result.
These previews have their own orientation/stretch/processing; they are not aligned or
calibrated against SPHEREx/WISE and do not become saved comparison evidence. Preview
availability is narrower than all archive coverage. Failed refreshes retain previous images
and loaded coordinates. The archive and per-image full previews are linked in the panel.

Verification (synthetic fixtures and intercepted browser requests):

```sh
services/catalogs/.venv/bin/python -m pytest services/catalogs/tests/test_neossat.py
node --experimental-strip-types --test web/src/viewer/neossat.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node web/src/viewer/neossat.browser.mjs
```
