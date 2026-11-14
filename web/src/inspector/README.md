# Source inspector (task 3)

A React component that takes a sky position and optional selected-frame metadata, shows the
matching Gaia DR3 catalog source, and emits a mark action. Owned path:
`web/src/inspector/**`. Backend: `services/catalogs`.

The inspector does **not** own or edit shared map windowing. It receives a position and emits
a mark; the app shell (coordinator) places it in the map panel and wires the mark to the map
and findings.

## Public API

```tsx
import { SourceInspector, createCatalogClient } from "./inspector";

const client = createCatalogClient({ baseUrl: "/api" });

<SourceInspector
  client={client}
  skyPosition={{ ra: 269.45207, dec: 4.66829 }}   // ICRS decimal degrees, or null (idle)
  selectedFrame={{                                  // optional; enables predicted position
    frameId: "frame-qr3-2026-03-14",
    observedAtUtc: "2026-03-14T09:21:00Z",
    wavelengthUm: 1.62,
  }}
  radiusArcsec={30}                                 // optional, default 30
  onMark={(mark) => { /* { frameId, ra, dec, sourceId, predicted } */ }}
/>
```

`onMark` payload:

| Field | Meaning |
|---|---|
| `frameId` | the selected frame, or `null` if none |
| `ra`, `dec` | sky coordinates to mark — predicted position when a frame is selected, otherwise the observed catalog position |
| `sourceId` | the Gaia source the mark refers to |
| `predicted` | `true` when `ra`/`dec` are a propagated prediction |

A findings pin and a selected image position use these same sky coordinates.

## States

The inspector renders, driven either by self-fetching from `client` or by an explicit
`initialState` (used by the harness and tests):

- **idle** — no position selected.
- **loading** — fetching.
- **unmatched** — empty cone search; shown as a valid result, not an error.
- **ambiguous** — several close sources; user picks one, then the detail view appears.
- **matched** — one source; detail (uncertainties, RV, BP/RP) loads as enrichment.
- **unavailable** — a service error, with the `{code, message}`.

### Predicted vs observed

When a frame is selected, the observed position (epoch 2016.0) is propagated to the frame's
observation date and shown in a separate **predicted** section with a `predicted` badge. The
observed position is always shown too. See `propagate.ts` and the service `PROVENANCE.md` for
the formula and its omitted perspective terms.

## Develop and verify

Standalone (not the app shell):

```powershell
# from web/
npm install
npm run dev:inspector   # harness at http://localhost:5173
npm run test            # vitest
npm run typecheck
```

The harness (`harness/main.tsx`) drives every state with fixture data and stub callbacks,
including a toggle for the selected frame to exercise predicted positions.

## Files

| File | Role |
|---|---|
| `SourceInspector.tsx` | the exported component |
| `types.ts` | props/callback and data types (local mirror of the service contract) |
| `api.ts` | typed client for the three endpoints |
| `propagate.ts` | epoch propagation, matching the backend |
| `format.ts` | unit-aware, null-safe formatting |
| `states/` | presentational subviews |
| `fixtures.ts` | importable fixtures + a fixture-backed client |
| `harness/` | standalone dev harness |

## Integration note

`types.ts` is a local mirror of the catalog contract. When the coordinator publishes shared
generated types, swap to them and reconcile any field-name difference. The `web/`-root
tooling here (`package.json`, vite/vitest configs) is a minimal standalone harness; it must
not become the integrated app entry point, which the coordinator owns.
