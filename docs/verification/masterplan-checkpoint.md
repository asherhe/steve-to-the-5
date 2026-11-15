# Backend checkpoint verification — 2026-11-15

Base: `origin/main` at `5c36016`; working branch `master-plan`.

Local checks executed:

- Catalog pytest suite: passed, including new review adapters, malformed/empty/overflow
  distinctions, independent failures, offline mode, UTF-8 names, failover and deadlines.
- Findings unittest suite: passed, including the PGlite-backed create/read/reply/replay/hide
  integration and candidate review ownership, score spoofing, coordinate/frame binding,
  real-evidence restriction, offline restriction, WISE loader selection and public board.
- `node services/findings/tests/check_migration.cjs`: passed against PGlite with all four
  migrations, including denied direct access, immutable review rows, duplicate prevention,
  UTC daily filtering, score output, thread snapshots and moderation exclusion.
- `npm.cmd run build`: passed (TypeScript and Vite production build). Existing large Aladin
  chunk warning remains. No browser rendering or new frontend workflow was tested.
- OpenAPI schemas/types regenerated; representative fixture models validated.

Public catalog smoke test at the WISE 0855 challenge reference position, 300 arcsec cone,
chosen 2026-01-01 UTC query time (an adapter test, **not image-detection evidence**):

| Catalog | Observed outcome |
|---|---|
| Gaia DR3 | AIP mirror answered; 50 displayed rows, result correctly partial |
| SIMBAD | Harvard mirror answered with 6 nearby records |
| UltracoolSheet | Pinned 2.1.0 release returned 1 nearby record |
| SkyBoT | Its explicit empty-cone ERROR response was identified, supported narrowly, regression-tested, and rechecked as `no_candidates` |
| CatWISE2020 | Timed out on both probes; successful live result remains unverified |
| VizieR AllWISE | Timed out on both probes; successful live result remains unverified |

These nearby records are not automatically identified with the selected target. Exact
timestamps and provider names are retained in `masterplan-catalog-smoke.json`.

Not verified: hosted Supabase Auth/PostgREST, a hosted migration, concurrent hosted
transactions, browser workflow, deployed origin, fresh five-target archive coverage,
or source detection/novelty/composition. Catalog and most API tests are synthetic;
the review geometry test reads the retained real example manifest without fetching images.

The first sandboxed checks hit temp-file/esbuild process restrictions; final verification
uses the same commands with authorized local execution. TestClient emits an upstream
deprecation warning. Windows aborted-loopback messages in transport stress tests are
expected when testing cancellation and do not indicate a failed assertion.
