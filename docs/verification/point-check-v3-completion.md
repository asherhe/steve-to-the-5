# Point-check-v3 completion — 2026-11-15

Branch: `fix-saved-example`. Implementation and local verification are complete; no publication or hosted deployment is claimed.
The prior agent's backend and double-click work were already in the branch's committed
baseline. This continuation finished the frontend route, all-catalog map controls,
point-only discussion/replay, demo, documentation and verification.

## Completed behavior

- Plain reference-map points can be submitted: sign in → server review → title/note → post.
  No loaded SPHEREx/WISE frames or image comparison ID is needed. An optional original
  frame reference supplies SkyBoT's time after server validation; it is not attached as
  fabricated image evidence to the point finding.
- Known catalog sources score 10 without image work. Unlisted points can score 20 from
  brightness in any two of SPHEREx, WISE, DSS and NEOSSat; other points score 0 and remain
  postable. The server owns the score, fresh checks and image fetching. Outages stay errors
  or unavailable measurements, not fabricated no-coverage or zero-score reports.
- Early duplicate results block composition and link the existing discussion. Racing 409s
  retain the draft and offer an existing-entry lookup. The same-object/15-arcsec SQL lock
  remains the final authority, including between different authors.
- All six catalogs offer map markers for valid returned coordinates. Gaia retains its
  existing prediction model; other markers explicitly keep published catalog positions.
  SkyBoT sexagesimal coordinates are converted to ICRS degrees. Markers are not detections.
- Newly marked points reset the anonymous-check radius; the chosen radius is carried into
  scoring and email sign-in. Point/frame/radius/account changes invalidate stale reviews,
  abort pending checks, and preserve per-selection text drafts.
- Image-free leaderboard entries offer **Point & discussion**. Finding-only links focus
  the map, show a submitted-point status and open the anonymous thread without loading or
  rebuilding images. Existing saved comparisons and marks retain their replay path.
- Single click inspects Gaia, double click marks/checks, and the removed header buttons
  remain absent. The submit pane puts the text fields ahead of expandable raw records.
- Demo mode stores findings/replies locally, runs catalog checks when available, never
  invents 20-point brightness and performs same-object/nearby duplicate checks locally.

## Executed checks

| Check | Result |
|---|---|
| Production `npm run build` (includes app TypeScript check) | Passed; existing large Aladin bundle notice only |
| Viewer `node --experimental-strip-types --test web/src/viewer/*.test.mjs` | 60 passed |
| Web regression suite excluding the pre-existing CheckChain test | 138 passed in the broad run |
| Final affected point/legacy-review suites after the added malformed-note case | 54 passed (29 point-flow + 25 historical compatibility) |
| Standalone web TypeScript with only `CheckChain.tsx` and `CheckChain.test.tsx` excluded | Passed |
| Findings Python tests on final archive handling | 49 passed, 32 subtests |
| Local PGlite migration check | Passed; real migration SQL, ownership/duplicate/reply/moderation assertions |
| Catalog Python tests excluding the pre-existing `test_check_chain.py` | Passed (158 collected tests) |
| Chromium production/live-mode UI with intercepted services | Passed, no page errors |
| Chromium local demo mode with intercepted catalog transport | Passed, no findings requests or page errors |
| `git diff --check` | Passed |

The browser runs use actual map pointer events, synthetic reference tiles, intercepted
Supabase auth and server responses, plus real browser-local demo storage. They verify
all six map controls, radius reset/preservation, sign-in return, known-object brightness
bypass, 0/10/20 reports, posting/ranking, early and racing duplicates, draft retention,
finding-only links, fresh anonymous mobile replay and a second user's sign-in/reply.
Neither mode issues comparison requests for these point-only flows. Aladin startup telemetry
is stubbed locally so the test does not send it to an external service.

See `point-check-v3-browser.json` for the run summaries. Screenshot output is configurable
with `POINT_REVIEW_OUTPUT`; the runner defaults to `/tmp` and does not check in images.

The other contributor's unfinished CheckChain implementation and tests were left unchanged.
The unfiltered standalone `npm --prefix web run typecheck` still reports those files' missing
chain types/client method. They are excluded only in this scoped verification, not silently
removed from project configuration. SourceInspector's client type was narrowed to its three
actual methods so its fixtures do not falsely require the separate review endpoint.

## Public archive checks

The final code was probed at the retained Barnard field centre, RA 269.44629°, Dec 4.76792°.
This is a source-access check, not a catalog association or a claim that the current star
position is visible in every survey. `point-check-v3-live-cutouts.json` records the results:

- DSS: a real FITS download succeeded and the point could be measured.
- NEOSSat: the calibrated COR/CORD query returned no coverage at this test position. The
  earlier agent's successful download at another position is historical, not re-claimed here.
- SPHEREx: a separate live query returned 200 valid capped SIA rows (`OVERFLOW`). The fetcher
  now accepts a bounded sample and labels that limit. Final full image retrieval still hit
  an IRSA HTTP error; no live SPHEREx FITS measurement is claimed.
- WISE: the IRSA request timed out. No live WISE FITS measurement is claimed.

Synthetic HTTP tests verify SIA/IBE URL and observation-time handling, W2 coadd paths, DSS
request coordinates, calibrated compressed NEOSSat FITS, raw/expanded size bounds, malformed
archive metadata, independent failures and explicit capped versus empty searches. They do
not substitute for live checks. Published source information:
[SPHEREx cutouts](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html),
[IRSA IBE cutouts](https://irsa.ipac.caltech.edu/ibe/cutouts.html),
[CADC NEOSSat](https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/neossat/),
[IVOA capped-result semantics](https://www.ivoa.net/documents/DALI/20170517/REC-DALI-1.1.html).

## Hosted activation remains outside this local verification

`20261115150000_findings_point_check_scores.sql` has NOT been applied to hosted Supabase.
No hosted migrations, real sessions, public findings, deployment or pushes were performed.
Before enabling hosted v3 submissions, apply the reviewed migrations through the normal
release process, configure the findings/auth/catalog/archive routes and verify real sessions.
The older preview on port 5184 was left alone; isolated verification previews are stopped
when this continuation finishes.
