# SPHEREx viewer

From the repository root, use Node.js 20.19+ or 22.12+ and set up the two Python
environments once.

```powershell
npm.cmd ci
python -m venv services/catalogs/.venv
.\services\catalogs\.venv\Scripts\python.exe -m pip install -r services/catalogs/requirements.txt
python -m venv services/archive/.venv
.\services\archive\.venv\Scripts\python.exe -m pip install -r services/archive/requirements.lock
npm.cmd run dev
```

`npm run dev` starts the viewer on port 5173, Gaia on 8010, and the SPHEREx archive
on 8000. Ctrl+C stops the stack. On macOS or Linux, use `npm` in place of `npm.cmd`
and `services/<service>/.venv/bin/python` for each service's Python.
Use `npm run dev:viewer`, `npm run dev:gaia`, or `npm run dev:spherex` to start an
individual process. Stop any earlier React-only server before starting the stack,
or set `VIEWER_PORT` to use another viewer port.

Open the URL printed by Vite. The Aladin Lite map opens on Barnard’s Star in an orthographic globe view. Drag to rotate and scroll or pinch to zoom. **All sky** shows a 360° Hammer–Aitoff overview. The reference sky uses the 0.771 µm layer of the [SPHEREx DR1 all-sky mosaic](https://doi.org/10.26131/IRSA679) from Caltech/IPAC IRSA. The mosaic combines observations, and the comparison panel loads dated spectral images separately. If the mosaic is unavailable, select **Retry imagery** or use Search to look up coordinates or a preset.

The sky fills the viewport. Open **Search**, **Comparison**, or **Gaia** in the top bar to show its panel. The panels become bottom sheets on narrow screens. Use **Close** or Escape to return to the sky. Closing the comparison panel pauses playback and keeps your place.

Click a dated image to open Gaia at the selected sky coordinate. Keyboard users can focus the image and press Enter to inspect its center. The selection stays at the same sky position across frames. A Gaia prediction marked from the inspector appears only on the frame used for that prediction. These marks are local to the current viewer session.

Pan and zoom, then select **Compare this field** once the map width is within the archive's 1–30 arcmin range. You can also submit RA/Dec in decimal degrees or sexagesimal form or select any of the five target presets. Presets are field centers from the project brief, [SIMBAD](https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=Barnard%27s+star), [SIMPLE](https://simple-bd-archive.org/load_solo/epsilon%20IndiB), [Chandra](https://cxc.cfa.harvard.edu/target_lists/cycle21/cycle21_approved_peer_targets_by_radec.html), and [AAVSO](https://archive.aavso.org/index.php/aavso-bulletin-coordinates).

Open `/?fixtures=1` in development to exercise the browser-only fixture controls. Choose **Archive unavailable** to exercise the outage state, **Open saved fixture** to load the synthetic pair, and **Try missing ID** to check the missing-evidence state. Run `npm.cmd run build` from the repository root to type-check and build the viewer.

## SPHEREx archive integration

Vite proxies `/api/comparisons` and its asset paths to port 8000. Set `ARCHIVE_API_TARGET` before starting Vite to change the target. In deployment route the same paths to a single archive worker with persistent storage and a proxy timeout above the build deadline.

Search requests go to IRSA by default. For an offline integration check, start the archive with `-m services.archive --synthetic serve` and search RA 10°, Dec 20° at 6 arcmin. **Open saved real example** replays the bundled IRSA tutorial pair by its immutable ID in either mode. **Copy comparison link** opens the exact saved comparison on the same service. Regenerate the frontend archive types with `npm.cmd run generate:archive-types` after a schema update.

## Gaia catalog integration

Vite proxies `/api/resolve` and `/api/catalogs` to the [catalog service](../../../services/catalogs/README.md) on port 8010. Set `CATALOG_API_TARGET` before starting Vite to use a different address. To try the built viewer, run `npm.cmd run build` followed by `npm.cmd run preview` while the two backend processes are running.

Check `http://127.0.0.1:8010/api/health` for the catalog service and `/api/catalogs/nearby?ra=269.4521&dec=4.6933&radiusArcsec=30` on the viewer origin for the proxy. Both should return JSON. When serving the built viewer on another host, route `/api/catalogs/*` and `/api/resolve` to the catalog service before applying the frontend's HTML fallback.

Choose **Inspect map center** on the initial Barnard’s Star view or click a sky position to query Gaia. The inspector lists nearby results and fetches the details for the chosen source. **Mark position** places its Gaia catalog position on the reference sky. The catalog service starts in fixture mode.

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
