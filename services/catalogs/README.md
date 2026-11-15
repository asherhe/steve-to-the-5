# SPHEREx catalog service (task 3)

Name resolution, bounded Gaia DR3 cone search and exact source-ID detail for the SPHEREx
viewer. Owned path: `services/catalogs/**`. The companion frontend (the source inspector)
lives in `web/src/inspector/**`.

Direct service configuration is **offline by default** (the root `npm run dev:gaia`
runner defaults to live Gaia; set `CATALOGS_LIVE=0` for offline service review): all data comes from bundled fixtures, so the whole
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

Live mode sends the same ADQL to an ordered list of archives that serve the identical
`gaiadr3.gaia_source` table: the ESA Gaia Archive first, then the AIP Potsdam partner mirror.
The repository's `npm run dev:gaia` runner enables SIMBAD name lookup together with live
Gaia; set `CATALOGS_EXTERNAL_RESOLVE=0` to opt out. Fixture mode never contacts a network.

### Reliability: failover, deadlines, cooldown and cache

- **Failover.** A connection failure, timeout, HTTP 5xx (or 404/408/429) or an unusable
  response moves on to the next archive. A cone search with zero rows is a valid answer and
  a rejected query is its own error; neither triggers a fallback or a cooldown.
- **Validation.** A response is checked before it is trusted or cached. Gaia must return an
  XML VOTable carrying every expected column, even with zero rows. SIMBAD must return CSV
  with the expected header: a correct header and no rows is a real "no match", while an
  empty body, a wrong header or a truncated row is an unusable response.
- **Deadlines.** Connecting is limited to 3 s. Any archive attempt that is not the last one
  gets 6 s in total; the last archive being tried gets whatever remains of the 20 s allowed
  for the whole sequence, because a healthy mirror can take longer than 6 s. Each deadline
  covers connection, redirects, headers and the complete body, and the request is cancelled
  when it expires: requests run on one background event loop (`app/tap_http.py`), so nothing
  is left running after a timeout. They are plain TAP `sync` calls, so no capability
  discovery happens outside the deadline.
- **Capacity.** Each archive accepts 4 concurrent requests and has no queue. A full archive
  is skipped at once and is not put in cooldown. If every archive is full the response is
  `upstream_unavailable` with a "busy, try again" message.
- **Cooldown.** A failed archive is skipped for 3 minutes while another is usable. If every
  archive is cooling they are all tried anyway. `retry=true` on a request (the inspector's
  **Try again** button) probes cooling archives in their normal order.
- **Cache.** Gaia nearby and detail results are cached in process memory for a day, keyed by
  data release and exact query parameters. An outage is never stored as an empty result.
  The cache is lost on restart and cannot answer a field that was never requested.
- **Provenance.** `provenance.dataRelease` is always Gaia DR3. `servedBy` names the archive
  that answered, `retrievedAtUtc` is when it was queried (unchanged on a cache hit) and
  `fromCache` says whether this response came from the cache. The nearby response and each
  detail response carry their own provenance, because different archives may answer them.
- **SIMBAD.** Name lookup uses the same helper: CDS Strasbourg first, then the CfA Harvard
  mirror. The mirror is a dated copy, so a miss there is reported as `not_found_in_mirror`
  and kept for one minute only, and only while Strasbourg is in cooldown.

`app/reliability.py` holds the shared bounded cache (one instance per payload type) and the
failover helper. Unit tests inject fake archives (`tests/test_reliability.py`); deadline,
cancellation, capacity and validation are tested against a local HTTP server
(`tests/test_transport.py`). Live
behaviour depends on the upstream services and must be checked separately.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `CATALOGS_LIVE` | `0` | `1` enables the live Gaia TAP provider |
| `CATALOGS_EXTERNAL_RESOLVE` | `0` | `1` allows SIMBAD name lookup beyond presets (live only) |
| `CATALOGS_FIXTURES_DIR` | `fixtures/catalogs` | fixture directory (repository-relative) |
| `CATALOGS_MAX_RADIUS_ARCSEC` | `300` | cone-search radius bound |
| `CATALOGS_MAX_ROWS` | `200` | result-row bound |
| `CATALOGS_GAIA_TAP_URLS` | ESA, then AIP | ordered archives as `NAME=url,NAME=url` |
| `CATALOGS_SIMBAD_TAP_URLS` | CDS, then Harvard | ordered SIMBAD TAP servers, same format |
| `CATALOGS_UPSTREAM_CONNECT_TIMEOUT_S` | `3` | limit for opening a connection |
| `CATALOGS_UPSTREAM_REQUEST_TIMEOUT_S` | `6` | total for an archive attempt that is not the last |
| `CATALOGS_UPSTREAM_TOTAL_TIMEOUT_S` | `20` | total for the whole sequence; the last archive gets the remainder |
| `CATALOGS_UPSTREAM_COOLDOWN_S` | `180` | how long a failed archive is skipped |
| `CATALOGS_UPSTREAM_MAX_CONCURRENT` | `4` | concurrent requests per archive (no queue) |

No credentials are required; none are stored in source, fixtures or logs.

## Error model

Every error is `{code, message}` with an HTTP status:

| Code | Status | When |
|---|---|---|
| `invalid_request` | 400 | malformed/out-of-range coordinates, radius or name |
| `not_found` | 404 | SIMBAD has no such name, or a missing source ID |
| `not_found_in_mirror` | 404 | only the dated SIMBAD mirror could be asked and it had no match |
| `resolver_disabled` | 503 | name lookup beyond the bundled targets is switched off |
| `upstream_unavailable` | 503 | no archive responded (distinct from an empty result) |

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


## Cold-object review checkpoint ? 2026-11-15

`GET /api/catalogs/review?ra=...&dec=...&radiusArcsec=120&observedAtUtc=2026-01-01T00:00:00Z`
provides six independent review aids, not a cross-identification or discovery verdict.
Radius is 5?300 arcsec; a timezone-bearing observation time is required. Offline mode
returns `skipped` for every check. The live route reuses the Gaia and SIMBAD reliability
layer and adds CatWISE2020, pinned UltracoolSheet 2.1.0, SkyBoT geocentric predictions,
and VizieR's AllWISE table only. It never searches every VizieR catalog.

There are two review slots/process, 50 displayed rows/check, and explicit partial,
unavailable and empty states. GET downloads have an 8 MB decoded-body cap and 25 s
wall-clock deadline; TAP uses the existing configured failover deadlines. Epoch mismatch,
proper motion, finite search scope and incomplete catalogs prevent novelty inference.
SkyBoT returns an ERROR info field for its explicit empty-cone message; only that exact
message family is accepted as empty, while service-error documents remain unavailable.

UltracoolSheet data: https://zenodo.org/records/15802304 (v2.1.0, July 3, 2025), compiled
by Will Best, Trent Dupuy, Michael Liu, Aniket Sanghi, Rob Siverd and Zhoujian Zhang.
The complete matching rows retain original-paper reference codes; users must cite those
papers and the compilation when using the data. The snapshot is not a latest-release claim.

See `MASTERPLAN-HANDOFF.md` for the unfinished frontend and `docs/verification/` for
actual smoke results. CatWISE and VizieR timed out; successful live results remain unverified.
