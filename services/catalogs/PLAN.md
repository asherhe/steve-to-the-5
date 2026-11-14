# Task 3 — Catalog service and source inspector: plan

Owner branch: `francis/catalog-service`
Owned paths: `services/catalogs/**`, `web/src/inspector/**`

This document is the implementation plan and the entry point for the task-3 documentation
set. It is scoped to the catalog slice only. Shared schema, generated types, root
dependencies, app-shell and deployment stay with the coordinator; where this slice needs a
shared contract change, it is raised as an open gap rather than edited here.

## 1. Scope recap (from the handoff, brief and skill)

Backend (`services/catalogs/**`):

- `GET /api/resolve?name` -> `{name, ra, dec}`. Bundled target presets resolve independently
  of any external name lookup. External lookup (SIMBAD / Gaia identifier) is an optional
  fallback behind a flag.
- `GET /api/catalogs/nearby?ra&dec&radiusArcsec` -> `{sources}`. Each row:
  `{sourceId, ra, dec, refEpoch, pmRaCosDecMasYr, pmDecMasYr, parallaxMas, gMag,
  separationArcsec}`. Bounded radius and bounded row count. Empty result is distinct from a
  service error.
- `GET /api/catalogs/gaia/{sourceId}` -> same astrometry plus uncertainties, radial
  velocity, BP/RP magnitudes and source provenance. Optional fields may be `null`.

Frontend (`web/src/inspector/**`):

- Inspector exported as a component that takes a sky position and optional selected-frame
  metadata, and emits a mark action. It does not own or edit shared map windowing.
- Presents catalog position, reference epoch, proper motion, parallax and photometry when
  available, each with explicit units.
- A propagated marker accounts for epoch (Gaia DR3 reference epoch 2016.0 -> frame
  observation date) and is labelled a prediction, kept distinct from the observed position.

Cross-cutting rules enforced here:

- JSON camelCase; ICRS decimal degrees; UTC ISO 8601 timestamps; units in field names;
  external source IDs are strings; nullable measurements are `null`.
- Validate finite coordinates, `dec in [-90, 90]`, `ra in [0, 360)`, positive bounded search
  sizes. Normalize sexagesimal input on resolve.
- Error body `{code, message}` for malformed requests, missing records and (not applicable
  here) unauthorized writes.
- Distinguish synthetic fixtures, saved real examples, live archive checks and deployed
  checks. Report only checks actually run; name unavailable services explicitly.

## 2. Architecture

```
services/catalogs/
  pyproject.toml            # project-local deps (FastAPI, astroquery, astropy, pydantic, httpx)
  requirements.txt          # pinned, mirrors pyproject for simple installs
  app/
    __init__.py
    main.py                 # FastAPI app factory + route registration
    config.py               # settings: live-query flag, bounds, timeouts (env-overridable)
    models.py               # pydantic response/error models (camelCase via alias)
    errors.py               # {code, message} error body + handlers
    validation.py           # coordinate / radius / name validation + sexagesimal normalize
    presets.py              # bundled 5-target presets (challenge targets)
    routes/
      resolve.py            # GET /api/resolve
      nearby.py             # GET /api/catalogs/nearby
      detail.py             # GET /api/catalogs/gaia/{sourceId}
    gaia/
      __init__.py
      provider.py           # Provider protocol: nearby(), detail()
      tap.py                # live Gaia DR3 TAP provider (ADQL), bounded
      fixture_provider.py   # offline provider backed by fixtures/catalogs
      adql.py               # ADQL builders (parameterized, bounded TOP)
    astrometry/
      propagate.py          # epoch propagation 2016.0 -> target date (predicted position)
  fixtures/catalogs/
    presets.json            # 5 challenge targets
    nearby_known.json       # known, single clean match
    nearby_ambiguous.json   # several close sources -> ambiguous
    nearby_unmatched.json   # empty sources (no catalog source in radius)
    detail_known.json       # full detail with uncertainties + RV + BP/RP
    detail_partial.json     # optional fields null (unavailable measurements)
    unavailable.json        # upstream/service error shape (for service-down state)
  tests/
    test_validation.py
    test_resolve.py
    test_nearby.py
    test_detail.py
    test_propagate.py
    test_contract_fixtures.py   # responses conform to documented field set
  README.md                 # run + verify instructions, provenance, open gaps

web/src/inspector/
  index.ts                  # public exports
  types.ts                  # props/callback + data types (local; mirrors backend contract)
  api.ts                    # typed client for the three endpoints (fetch-based)
  fixtures.ts               # the four states as importable fixtures for the harness
  format.ts                 # unit-aware value formatting (ra/dec, pm, parallax, mag)
  propagate.ts              # client-side predicted-position helper (labelled predicted)
  SourceInspector.tsx       # the exported component (controlled props + onMark callback)
  SourceInspector.css
  states/                   # presentational subviews: Loading, Unmatched, Ambiguous,
                            #   Unavailable, SourceDetail
  harness/                  # standalone dev harness (Vite) — not the app shell
    main.tsx, index.html
  __tests__/
    SourceInspector.test.tsx
    propagate.test.ts
    format.test.ts
```

### Provider abstraction

`GaiaProvider` is a protocol with `nearby(ra, dec, radiusArcsec)` and `detail(sourceId)`.
Two implementations:

- `FixtureGaiaProvider` (default in tests / offline): reads `fixtures/catalogs`. Deterministic.
- `TapGaiaProvider` (live, behind `CATALOGS_LIVE=1`): queries Gaia DR3 via `astroquery`/TAP
  with a bounded `TOP` and a timeout. Network failure maps to `upstream_unavailable`-style
  service error, not an empty result.

The route layer never talks to the network directly; it depends on the selected provider.
This keeps live access optional so the slice is fully implementable and testable offline,
matching the brief's separation of fixtures from live checks.

### Name resolution order

1. Bundled presets (`presets.json`) — the five challenge targets plus common aliases.
   Always available, independent of any external service.
2. Optional external resolver (SIMBAD / Gaia name) only when `CATALOGS_LIVE=1`.
3. Unknown name -> `{code: "not_found", message}`.

### Epoch propagation (predicted position)

Gaia DR3 astrometry is referenced to epoch 2016.0. To overlay a catalog source on a dated
SPHEREx frame, propagate `(ra, dec)` by proper motion to the frame's observation date:

```
dt_yr        = (frameEpochYear - refEpoch)
raPredDeg    = ra  + (pmRaCosDecMasYr / cos(dec)) * dt_yr / 3.6e6
decPredDeg   = dec + (pmDecMasYr)                 * dt_yr / 3.6e6
```

Parallax/radial-velocity perspective terms are out of scope for the MVP marker and omitted;
this limitation is documented. The result is always labelled `predicted` and returned
alongside, never replacing, the observed position. Shared by backend (`astrometry/propagate.py`)
and frontend (`propagate.ts`) with matching formulas and a shared test vector.

## 3. Data contract (field-level, per handoff)

`NearbySource`: `sourceId:str, ra:float, dec:float, refEpoch:float,
pmRaCosDecMasYr:float|null, pmDecMasYr:float|null, parallaxMas:float|null, gMag:float|null,
separationArcsec:float`.

`GaiaDetail`: all of the above (minus `separationArcsec`) plus
`raErrorMas, decErrorMas, pmRaCosDecErrorMasYr, pmDecErrorMasYr, parallaxErrorMas,
radialVelocityKmS, radialVelocityErrorKmS, bpMag, rpMag, provenance` where `provenance`
carries `{catalog, dataRelease, sourceTableUrl}`. Optional fields nullable.

`ResolveResult`: `name:str, ra:float, dec:float`.

`ErrorBody`: `{code:str, message:str}`.

Codes used: `invalid_request`, `not_found`, `upstream_unavailable`.

## 4. Validation rules

- `ra`: finite, `0 <= ra < 360`.
- `dec`: finite, `-90 <= dec <= 90`.
- `radiusArcsec`: finite, `> 0`, `<= MAX_RADIUS_ARCSEC` (default 300).
- `sourceId`: non-empty string; for live TAP, must be all digits (Gaia source_id); fixture
  provider matches by exact string.
- Result row cap: `MAX_ROWS` (default 200) with explicit truncation note in logs, never a
  silent partial-looks-complete result.
- Sexagesimal resolve input (`10h..`, `+05d..`, or `hh:mm:ss`/`dd:mm:ss`) normalized to
  decimal degrees.

## 5. Testing and verification

Offline-only, deterministic:

- `test_validation.py` — boundary RA/Dec, non-finite rejection, radius bounds, sexagesimal.
- `test_resolve.py` — each preset resolves; alias; unknown -> `not_found`; live path skipped.
- `test_nearby.py` — known (one match), ambiguous (several), unmatched (empty, not error),
  service error maps to `upstream_unavailable` and is distinct from empty.
- `test_detail.py` — known full detail; partial with nulls; missing ID -> `not_found`.
- `test_propagate.py` — shared test vector; zero proper motion is identity; direction sign.
- `test_contract_fixtures.py` — every fixture validates against the pydantic models and
  only uses the documented field set (camelCase).

Frontend (Vitest + Testing Library):

- `SourceInspector.test.tsx` — renders each of known / ambiguous / unmatched / unavailable;
  `onMark` fires with `{frameId, ra, dec}` using predicted coords when a frame is selected
  and observed coords when none; predicted marker is labelled predicted.
- `propagate.test.ts` — matches the backend vector.
- `format.test.ts` — unit formatting and null handling.

Acceptance commands (also in both READMEs):

```
# backend
cd services/catalogs && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
cd services/catalogs && .venv/Scripts/python -m pytest -q

# frontend inspector (standalone)
cd web && npm install && npm run test
cd web && npm run dev:inspector     # manual harness
```

Explicitly out of scope / unverified until integration: live Gaia TAP results, cross-origin
behaviour, the app-shell map panel placement, deployed latency. These are reported, not
claimed.

## 6. Open gaps for the coordinator

- No shared OpenAPI schema or fixtures exist in the repo root yet. This slice implements the
  three catalog endpoints exactly as written in the handoff and keeps a local typed mirror in
  `web/src/inspector/types.ts`. When the coordinator publishes the shared schema + generated
  types, swap the local mirror for the generated types; raise any field-name differences.
- No root `web/` tooling or app shell exists. A minimal standalone Vite harness lives under
  `web/src/inspector/harness` for isolated development only; it must not become the app entry.
- Same-origin API base path assumed `/api`; confirm deployment prefix with coordinator.
