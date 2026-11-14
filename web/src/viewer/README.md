# SPHEREx viewer fixture harness

Run these commands from the repository root with Node.js 20.19+ or 22.12+.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the URL printed by Vite. The harness starts with a synthetic matched pair. Choose **Archive unavailable** to exercise the outage state, **Open saved fixture** to load the pair by ID during the outage, and **Try missing ID** to check the missing-evidence state. Both PNGs share the same dimensions, stationary stars and background. One simulated point moves between epochs. Run `npm.cmd run build` from the repository root to type-check and bundle the harness.

## Coordinator handoff

The harness injects a fixture data source. The viewer-facing TypeScript types describe the UI inputs and states. When the coordinator publishes OpenAPI, the production adapter will consume its generated types and map them into the viewer. The shared contract and representative fixtures need to specify:

- The comparison search bounds and default field size, all five search outcomes, and any comparison payloads allowed for each outcome.
- An ICRS TAN grid for the rendered cutouts, including dimensions, reference sky coordinates, reference pixel, and a 2×2 transform in degrees per pixel. Define the pixel origin against the rendered image's top-left pixel center and provide an Astropy reference point for verification.
- Durable comparison IDs and frame image URLs, common stretch and wavelength bounds, observation UTC times, per-frame release/source links and quality flags, plus an ID for the saved real outage example.
- The saved comparison ID referenced by each finding and its frame-specific marks as frame IDs and sky positions. Provide the shared error response for missing IDs.

In the shared app, Vite will proxy relative `/api` requests to the local FastAPI entry point. Deployment will route the same paths through the public origin. Keep the harness entry point and its synthetic images on the development side when integrating the shared app.
