# SPHEREx viewer fixture harness

Run these commands from the repository root with Node.js 20.19+ or 22.12+.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the URL printed by Vite. The Aladin Lite map opens on Barnard’s Star in an orthographic globe view. Drag to rotate and scroll or pinch to zoom. **All sky** shows a 360° Hammer–Aitoff overview. The DSS2 HiPS tiles require network access and are credited to STScI/NASA and CDS.

The sky fills the viewport. Open **Search**, **Comparison**, or **Gaia** in the top bar to show its panel. The panels become bottom sheets on narrow screens. Use **Close** or Escape to return to the sky. Closing the comparison panel pauses playback and keeps your place.

Pan and zoom, then select **Compare this field** once the map width is within the archive's 1–30 arcmin range. You can also submit RA/Dec in decimal degrees or sexagesimal form or select any of the five target presets. Presets are field centers from the project brief, [SIMBAD](https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=Barnard%27s+star), [SIMPLE](https://simple-bd-archive.org/load_solo/epsilon%20IndiB), [Chandra](https://cxc.cfa.harvard.edu/target_lists/cycle21/cycle21_approved_peer_targets_by_radec.html), and [AAVSO](https://archive.aavso.org/index.php/aavso-bulletin-coordinates).

Open `/?fixtures=1` in development to exercise the browser-only fixture controls. Choose **Archive unavailable** to exercise the outage state, **Open saved fixture** to load the synthetic pair, and **Try missing ID** to check the missing-evidence state. Run `npm.cmd run build` from the repository root to type-check and build the viewer.

## SPHEREx archive integration

Run the archive service in a separate terminal from the repository root.

```powershell
python -m venv services/archive/.venv
.\services\archive\.venv\Scripts\python.exe -m pip install -r services/archive/requirements.lock
.\services\archive\.venv\Scripts\python.exe -m services.archive serve
```

Vite proxies `/api/comparisons` and its asset paths to port 8000. Set `ARCHIVE_API_TARGET` before starting Vite to change the target. In deployment route the same paths to a single archive worker with persistent storage and a proxy timeout above the build deadline.

Search requests go to IRSA by default. For an offline integration check, start the archive with `-m services.archive --synthetic serve` and search RA 10°, Dec 20° at 6 arcmin. **Open saved real example** replays the bundled IRSA tutorial pair by its immutable ID in either mode. **Copy comparison link** opens the exact saved comparison on the same service. Regenerate the frontend archive types with `npm.cmd run generate:archive-types` after a schema update.

## Gaia catalog integration

Start the [catalog service](../../../services/catalogs/README.md) on port 8010 in a separate terminal. The Vite development server proxies `/api/resolve` and `/api/catalogs` there. Set `CATALOG_API_TARGET` before running Vite to use a different backend address.

Choose **Inspect map center** on the initial Barnard’s Star view or click a sky position to query Gaia. The inspector lists nearby results and fetches the details for the chosen source. **Mark position** places its Gaia catalog position on the reference sky. The catalog service starts in fixture mode, and the sky map displays DSS2 reference imagery.

## Coordinator handoff

The harness injects a fixture data source. The viewer-facing TypeScript types describe the UI inputs and states. When the coordinator publishes OpenAPI, the production adapter will consume its generated types and map them into the viewer. The shared contract and representative fixtures need to specify:

- The comparison search bounds and default field size, all five search outcomes, and any comparison payloads allowed for each outcome.
- An ICRS TAN grid for the rendered cutouts, including dimensions, reference sky coordinates, reference pixel, and a 2×2 transform in degrees per pixel. Define the pixel origin against the rendered image's top-left pixel center and provide an Astropy reference point for verification.
- Durable comparison IDs and frame image URLs, common stretch and wavelength bounds, observation UTC times, per-frame release/source links and quality flags, plus an ID for the saved real outage example.
- The saved comparison ID referenced by each finding and its frame-specific marks as frame IDs and sky positions. Provide the shared error response for missing IDs.

In the shared app, Vite will proxy relative `/api` requests to the local FastAPI entry point. Deployment will route the same paths through the public origin. Keep the harness entry point and its synthetic images on the development side when integrating the shared app.
