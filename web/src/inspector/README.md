# Catalog client and shared types

This folder used to hold the Gaia **source inspector** panel. That panel has been removed
from the viewer: the map no longer opens it on a click, "Inspect map center" is gone, and
dated images are no longer click-to-inspect. Checking a point is done by double-clicking it,
which runs the six-catalog point check (`web/src/viewer/PointCheck.tsx`). Gaia positions
from that check still appear on the map and on dated frames through the viewer's mark
state.

What remains here is shared by the viewer and the findings UI:

| File | Role |
|---|---|
| `api.ts` | typed client for the catalog service (`nearby`, `detail`, `resolve`, `review`, `checkChain`) and `CatalogApiError` |
| `types.ts` | catalog contract types, generated from the service schema |
| `catalog.generated.ts` | OpenAPI types; regenerate with `npm run generate:catalog-types` at the repository root |
| `propagate.ts` | proper-motion propagation to an observation date, matching the backend |
| `CheckChain.tsx` | step-by-step catalog check component and its styles |
| `index.ts` | public exports of the above |

## Predicted vs observed

`propagate.ts` moves a Gaia DR3 position (epoch 2016.0) to another date using proper motion
only. The result is a prediction and must be labelled as one wherever it is shown. See the
catalog service `PROVENANCE.md` for the formula and its omitted perspective terms.

## Verify

```sh
cd web
npm test
npm run typecheck
```

The `web/`-root tooling (`package.json`, vite/vitest configs) is a minimal standalone harness
for tests and the findings UI; it is not the integrated app entry point, which the
coordinator owns.
