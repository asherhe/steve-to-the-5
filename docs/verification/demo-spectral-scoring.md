# Demo spectral scoring — 2026-11-15

The default demo now uses the same real v4 measurement function as production,
including the required saved WISE blink, SPHEREx signal, provisional spectral
patterns and WISE brightness-change bonuses. Posts, discussions, rankings and
duplicate checks remain browser-local. Supabase is unnecessary for this mode.

`npm run dev` includes the loopback scoring service. For a standalone viewer,
start `npm run dev:scoring` separately. It reuses the archive's project-local
Python environment and declared FastAPI/httpx/Astropy dependencies. The explicit
`create_demo_app` factory exposes only the existing point-measurement and immutable
spectral-evidence routes. The normal factory still requires configuration and
authentication and retains public database ownership/duplicate enforcement.
`VITE_LIVE_FINDINGS=1` selects that production factory in the dev scoring runner.

The service loader now unwraps the survey HTTP `ComparisonResponse` before
validating the saved manifest. A real-data smoke check exposed the original
envelope mismatch; a regression test covers wrapped and legacy bare manifests.
No scientific thresholds, evidence hashes or replay formats changed. The shared
production OpenAPI was regenerated and had no changes.

Executed checks:

- Production typecheck/build passed; existing Aladin bundle-size warning remains.
- Findings backend after integrating `origin/main` at `039127b`: 76 tests and 45 subtests passed, including measured synthetic
  positive bonuses, WISE prerequisite, retained FITS/manifest reads, demo route
  isolation, production authentication and database integration.
- Frontend after integration: 114 tests passed, excluding the previously documented unfinished
  `CheckChain.test.tsx`. New checks cover demo prerequisites, bonus display,
  local ranking persistence, duplicate blocking and explicit upstream errors.
- Chrome: `DEMO_SCORING=1 node scripts/verify-spectral-browser.mjs` passed with
  synthetic intercepted APIs: no login, mandatory WISE load, 30-point breakdown,
  spectral/variability evidence, desktop/mobile layout and local post persistence
  after reload. Desktop screenshot visually inspected. These are workflow checks,
  not live positive chemical or variability detections.
- Local demo scorer launched through `npm run dev:scoring`; its OpenAPI exposed
  only the three intended routes. Through the viewer proxy, scoring without a
  WISE ID returned 422 `wise_blink_required`.
- Real-data request through `http://127.0.0.1:5192/api/findings/points/review`
  using the retained real WISE 0855 blink returned HTTP 201, `point-check-v4`,
  known-object score 10. SPHEREx was unavailable and WISE variability insufficient;
  no bonus was invented. This confirms local service integration for one target,
  not a live positive spectral/variability result or a five-target coverage pass.
- JavaScript syntax and `git diff --check` passed.

No hosted migration, Supabase write or deployed-origin check was performed.

The merge preserves the incoming Gaia-optional scoring policy, catalog service
rate-limit diagnostics and non-bundled frame fallback checks. Both local demo
entry points use one shared router/scoring function. The browser calls
`/api/findings/demo/points/review`; selected-WISE scoring errors are surfaced
without substituting a catalog-only report. The merged browser check and build
passed again. Viewer tests: 73 passed; affected catalog tests: 27 passed.
