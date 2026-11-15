# SPHEREx catalog service (task 3)

Name resolution, bounded Gaia DR3 cone search and exact source-ID detail for the SPHEREx
viewer. Owned path: `services/catalogs/**`. The companion frontend (the source inspector)
lives in `web/src/inspector/**`.

The service is **offline by default**: all data comes from bundled fixtures, so the whole
slice runs and is verified without network access. Live Gaia access is opt-in.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/resolve?name` | `{name, ra, dec}` from bundled presets (external lookup optional) |
| GET | `/api/catalogs/nearby?ra&dec&radiusArcsec` | `{sources}` bounded Gaia DR3 cone search |
| GET | `/api/catalogs/gaia/{sourceId}` | full astrometry + optional uncertainties, RV, BP/RP, provenance |
| GET | `/api/health` | liveness + mode |

Full request/response detail with examples: [`docs/API.md`](docs/API.md).
Data source, units and attribution: [`docs/PROVENANCE.md`](docs/PROVENANCE.md).

## Run

Prerequisites: Python 3.11+.

```powershell
# from services/catalogs
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# serve (offline fixtures)
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8010
```

```powershell
# example requests
curl "http://127.0.0.1:8010/api/resolve?name=Barnard's Star"
curl "http://127.0.0.1:8010/api/catalogs/nearby?ra=269.4521&dec=4.6933&radiusArcsec=120"
curl "http://127.0.0.1:8010/api/catalogs/gaia/4472832130942575872"
```

### Live Gaia DR3

```powershell
.\.venv\Scripts\pip install -r requirements-live.txt
$env:CATALOGS_LIVE = "1"
# optional external name resolution (SIMBAD) beyond bundled presets:
$env:CATALOGS_EXTERNAL_RESOLVE = "1"
.\.venv\Scripts\python -m uvicorn app.main:app --port 8010
```

Live mode queries the ESA Gaia TAP service. A network/timeout/server failure returns
`upstream_unavailable`; an empty cone search returns an empty `sources` list (not an error).
Live results are not verified in this repository and must be checked separately at
integration.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `CATALOGS_LIVE` | `0` | `1` enables the live Gaia TAP provider |
| `CATALOGS_EXTERNAL_RESOLVE` | `0` | `1` allows SIMBAD name lookup beyond presets (live only) |
| `CATALOGS_FIXTURES_DIR` | `fixtures/catalogs` | fixture directory (repository-relative) |
| `CATALOGS_MAX_RADIUS_ARCSEC` | `300` | cone-search radius bound |
| `CATALOGS_MAX_ROWS` | `200` | result-row bound |
| `CATALOGS_TAP_TIMEOUT_S` | `20` | live TAP timeout |

No credentials are required; none are stored in source, fixtures or logs.

## Error model

Every error is `{code, message}` with an HTTP status:

| Code | Status | When |
|---|---|---|
| `invalid_request` | 400 | malformed/out-of-range coordinates, radius or name |
| `not_found` | 404 | unknown preset name or missing source ID |
| `upstream_unavailable` | 503 | catalog backend failure (distinct from an empty result) |

## Verify

```powershell
.\.venv\Scripts\python -m pytest -q
```

What the groups prove:

- `test_validation.py` — RA/Dec bounds, non-finite rejection, radius bounds, sexagesimal input.
- `test_resolve.py` — the five challenge presets resolve; alias; unknown -> `not_found`.
- `test_nearby.py` — single match, ambiguous, empty-vs-error distinction, bounds enforced.
- `test_detail.py` — full detail, nulls for unavailable measurements, missing ID -> `not_found`.
- `test_propagate.py` — epoch propagation shared vector, zero-PM identity, direction.
- `test_contract_fixtures.py` — fixtures validate against the models and use only documented fields.

Catalog-slice coverage log for the five targets:

```powershell
.\.venv\Scripts\python scripts\coverage_log.py          # writes docs/coverage-log.json
```

This records name resolution + cone-search outcome per target. It is the catalog slice's
coverage, **not** the SPHEREx imaging coverage log (task 1 owns that). Offline rows are
synthetic (mode `offline-fixtures`).

## Scope and boundaries

- Implements exactly the three catalog routes in the handoff contract. No parallel API shapes.
- No shared map-windowing edits; the inspector consumes positions and emits a mark action.
- Shared schema / generated types / root dependencies / app shell / deployment belong to the
  coordinator. Open gaps are listed in [`PLAN.md`](PLAN.md).

## Reviewed names and cross-identifications

See [common names](../../docs/common-names.md) for the shared naming snapshot, component
ambiguity, optional identity enrichment, generated contract, cache and verification.
Unknown names with external lookup disabled now return `resolver_disabled` (503),
rather than a statement that the object does not exist.

Checkpoint 1 also returns `incomplete_name` (400) for known partial curated queries.
It enriches R Dra and the Epsilon Indi **Ba** Gaia source by exact DR3 ID. RW Aur
component joins remain unresolved. See the dated reports and live trust-bundle review
command in `docs/common-names.md`; external lookup remains disabled by default.
