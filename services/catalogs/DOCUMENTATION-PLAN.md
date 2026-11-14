# Task 3 — documentation plan (catalog slice)

Scope: documentation owned by the catalog service and source inspector. Shared/cross-owner
documentation (top-level README, deployment runbook, integrated demo script) belongs to the
coordinator; items that need it are listed under "Hand to coordinator".

## Documents this slice owns

| Document | Path | Purpose | Status |
|---|---|---|---|
| Implementation plan | `services/catalogs/PLAN.md` | Architecture, contract, decisions, open gaps | done |
| This documentation plan | `services/catalogs/DOCUMENTATION-PLAN.md` | What gets documented, where, acceptance | done |
| Backend README | `services/catalogs/README.md` | Install, run, routes, env flags, verify, provenance | to write |
| Inspector README | `web/src/inspector/README.md` | Props/callbacks, states, fixtures, harness, verify | to write |
| API reference | `services/catalogs/docs/API.md` | Per-route request/response/error, examples | to write |
| Data provenance note | `services/catalogs/docs/PROVENANCE.md` | Gaia DR3 source, epoch, units, attribution, limits | to write |
| Fixture catalogue | `services/catalogs/fixtures/catalogs/README.md` | What each fixture represents, how regenerated | to write |

## Content requirements per document

### Backend README
- One-line purpose and ownership boundary.
- Prerequisites (Python 3.11+), project-local venv instructions, pinned deps.
- Run commands (offline default, `CATALOGS_LIVE=1` live Gaia).
- Route summary table with example `curl`.
- Error model and codes.
- Verification: exact pytest command and what each group proves.
- Provenance + attribution pointer, and an explicit "not verified live here" statement.

### Inspector README
- Public API: `SourceInspector` props (`skyPosition`, optional `selectedFrame`, data/loading
  state or fetch inputs) and the `onMark` callback payload `{frameId, ra, dec}`.
- The four render states and how to drive them.
- Predicted vs observed position labelling and the epoch-propagation note.
- Standalone harness usage; statement that it is not the app shell.
- Verification: vitest command and manual harness steps.

### API reference (`docs/API.md`)
- For each of the three endpoints: method, path, query/path params with bounds, success
  body with a concrete example, and every error code with an example body.
- Units table (deg, mas, mas/yr, mag, km/s, arcsec) tied to field-name suffixes.

### Provenance note (`docs/PROVENANCE.md`)
- Gaia DR3 catalog, reference epoch 2016.0, TAP source, column mapping to response fields.
- Epoch-propagation formula and its omitted perspective terms (documented limitation).
- Attribution/acknowledgement text for Gaia DR3.
- Clear separation of synthetic fixtures vs saved real example vs live query.

### Fixture catalogue README
- One row per fixture: represented state, salient values, and whether synthetic or
  derived from a real Gaia response (and if real, when fetched).

## Documentation acceptance checks
- Every documented route field appears in `models.py` and in a fixture (kept in sync by
  `test_contract_fixtures.py`).
- Every command in a README is runnable as written from the stated directory.
- No credentials, tokens or machine-specific absolute paths in any doc.
- Fixtures are labelled synthetic unless explicitly derived from a dated real query.

## Hand to coordinator
- Entry in the top-level README/service index pointing at `services/catalogs`.
- Inclusion of the inspector in the app-shell map-panel documentation.
- Any wording for the integrated demo script that involves the inspector.
