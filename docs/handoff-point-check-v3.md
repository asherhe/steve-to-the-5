# Point-check-v3 completion handoff

Implementation is complete on `fix-saved-example`. This continuation completed implementation and local verification. Nothing was pushed,
deployed, or applied to the hosted database.
See [verification and activation limits](verification/point-check-v3-completion.md).

## Current behavior

- Single click inspects Gaia; double click marks an amber box/X and checks six catalogs.
- Every catalog can show its returned sources on the map. Only Gaia is propagated with the
  existing proper-motion model; others are labeled published catalog positions.
- **Submit to leaderboard** works for a plain-map point. Sign in, obtain the server score,
  then enter title/note. No SPHEREx/WISE frames need to be loaded.
- 10 for any listed source, with no brightness step; otherwise server-fetched images from
  SPHEREx, WISE, DSS and NEOSSat supply the two-survey 20-point rule. Other results score 0
  and remain postable. Failed catalog reviews remain errors rather than invented zero scores.
- Known duplicates link the existing discussion and cannot be submitted. Racing 409s keep
  typed text, block another post and offer an existing-entry recheck. The server's existing
  same-catalog-identity/15-arcsec lock is unchanged.
- Point-only leaderboard entries and finding-only links focus the map and open a discussion
  without requesting saved comparisons. Historical saved image replay remains supported.
- Demo posts/replies/duplicates persist locally. Live catalog checks run when available;
  brightness is never fabricated and the demo cannot award 20 for unmeasured imagery.

## Main paths

`web/src/findings/PointSubmissionPane.tsx` is the active submit screen, wired through
`web/src/viewer/App.tsx` and `Viewer.tsx`. `PointCheck.tsx` and `catalogCheckSummary.ts` own
anonymous checks and all-catalog map controls. `SkyMap.tsx` hosts generic catalog markers.
`findings/api.ts`, `reviewContract.ts` and generated types handle the new wire contract.
`useComparisonLoader.ts`, `evidence.ts`, `FindingThread.tsx` and the leaderboard support
image-free entries. The old `CandidateReviewPane` is retained for historical compatibility,
but is no longer routed from the product.

`services/findings/cutouts.py` now rejects malformed discovery responses, labels capped SPHEREx image samples, validates CADC
metadata and handles bounded calibrated `.fits.gz` files. `point_review.py` no longer claims
that a two-survey brightness coincidence rules out moving objects. API error descriptions
are stable across Python 3.12/3.13; schema and generated types were refreshed together.

## Verification

```sh
npm run build
node --experimental-strip-types --test web/src/viewer/*.test.mjs
npm --prefix web test -- --exclude src/inspector/__tests__/CheckChain.test.tsx
PYTHONDONTWRITEBYTECODE=1 services/catalogs/.venv/bin/python -m pytest -p no:cacheprovider services/findings/tests -q
node services/findings/tests/check_migration.cjs
PYTHONDONTWRITEBYTECODE=1 services/catalogs/.venv/bin/python -m pytest -p no:cacheprovider services/catalogs/tests -q --ignore=services/catalogs/tests/test_check_chain.py
```

`point-review.browser.mjs` drives real map interactions with synthetic HiPS and intercepted
catalog/auth/findings APIs. `masterplan.browser.mjs` and `local-demo.browser.mjs` now route to
that current workflow. Run it once against `VITE_LIVE_FINDINGS=1` and once against a normal
demo preview with `POINT_REVIEW_DEMO=1`; see the viewer README for commands. It verifies
sign-in/radius restoration, 0/10/20 reports, duplicate races, anonymous/mobile point replay,
second-session replies, all catalog markers and no comparison requests.

The other contributor's `CheckChain` implementation and failing source/tests remain
untouched. The unfiltered standalone web typecheck still reports those unfinished files;
production app types and a scoped standalone typecheck excluding those two files pass.

## Hosted activation boundary

The point-scoring migration `20261115150000_findings_point_check_scores.sql` is still NOT
applied to the hosted database. No hosted credentials, migrations, auth or public writes
were exercised. Configure/apply this through the normal release workflow before enabling
hosted v3 submissions. The existing preview on port 5184 belongs to the earlier session;
this continuation used isolated preview ports for verification.
