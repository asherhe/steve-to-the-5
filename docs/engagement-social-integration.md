# Cold-object review and community participation

The masterplan replaces the earlier rarity-game proposal with a review workflow for
possible nearby cold substellar objects, including brown dwarfs and possible free-floating
planetary-mass objects. Known stars remain controls. Selecting a point establishes neither
its nature nor its distance. The implementation is local; real Supabase activation and
hosted auth verification remain pending. See `docs/verification/masterplan-completion.md`.

## The implemented loop

1. Search a name/coordinate or browse and choose **Compare this field**. Bundled challenge
   targets work offline for naming. A name lookup does not establish image coverage or detection.
2. Explore the SPHEREx wavelength reference map. Roughly 4–5 µm is a teaching hint, not a
   selection criterion, thermometer, or chemical measurement. The map combines dates.
3. Load actual dated frames, scrub or blink in Time, and enlarge Compare details. Check dates,
   compatible wavelength, shared stretch, valid pixels and quality limitations. Use WISE
   history and optional DSS optical context. Neither a WISE/DSS detection nor Gaia absence
   is required. Catalog presence is not an image detection.
4. Select a point inside a saved dated image. **Review this point** opens the floating review
   pane. Sign in before persisting a review. A reference-map click cannot create one.
5. Run six independent cone-search review aids: Gaia DR3, SIMBAD, CatWISE2020,
   UltracoolSheet 2.1.0, SkyBoT and **VizieR II/328/allwise only**. Inspect returned records,
   units, scope, radius, frame time, retrieval time, source links and caveats. A neighbor
   is not a verified counterpart; no match is not proof of novelty. Partial, unavailable,
   skipped and valid empty results stay distinct.
6. Add a title and observation/question. The original reviewed point and frame mark are
   required. The server binds the review to the signed-in owner and exact evidence.
7. Posting refreshes the public participation leaderboard and opens the entry's discussion.
   Anyone can copy a link and replay the same frames, dates, wavelength, stretch and marks.
   Signed-in readers can reply. Community pins/clusters provide another route to threads.

All panels float over the full-screen map and support keyboard movement, collapse and close.
Mobile navigation scrolls horizontally; panes fit below the instrument bar and scroll inside.

## Participation points, version 1

`review-effort-v1` is a transparent, provisional participation policy:

| Documented action | Points |
|---|---:|
| Saved real dated image and sky point | 10 |
| Saved comparison has at least two distinct observation dates | 10 |
| Each completed catalog cone search, regardless of match count | 5 |
| Partial, unavailable or skipped catalog | 0 |
| Maximum | 50 |

No bonus for an empty catalog, unusual appearance or inferred chemistry. These exact weights
are provisional, not a scientific calibration. A score does not measure rarity, interest,
reliability, motion, composition, temperature, distance or discovery. Even when all catalogs
fail, the server may award evidence points; failed checks never earn catalog points.

Daily means UTC. The board returns at most 100 entries, deterministically ordered. Entries
rank findings, not an aggregate user reputation. The legacy response field `rarityScore`
contains participation points and `tier` is null; the UI does not display rarity tiers.

## Evidence, identity and discussion

A review is an immutable, separately stored catalog snapshot. It does not modify the image
manifest, comparison ID, rendered PNG, WCS, shared stretch or observation timestamps.
Changing the selected frame, point, radius, survey or account invalidates the current UI
review. A new review requires another explicit action. Posting retains the original mark.

SPHEREx and WISE have separate saved-evidence stores. Links carry survey identity; a
finding-only link reads the finding first to select the correct store. Conflicting finding
and comparison IDs fail visibly. Share links strip auth codes/tokens and temporary review
state. Sign-in return retains the selected frame/point and drafts in the current tab.

Writes use Supabase Auth through FastAPI; the server key stays server-side. Public reads
show display names, not email addresses. All four migrations deny direct browser table/RPC
access. Duplicate author/comparison/grid-pixel submissions are rejected. This is basic
per-evidence deduplication, not cross-comparison identity matching or a complete anti-abuse
system. Hidden findings disappear from public threads, map activity and ranking.

## Scientific limits and attribution

Gaia reference positions use epoch 2016.0; UltracoolSheet uses compiled J2000 positions.
Cone searches are not epoch-aware cross-identifications. High proper motion, crowding,
sensitivity and incomplete catalogs can all cause misses. Use a wider cone for context,
not as proof that its nearest row is the image source.

SkyBoT predicts known Solar System objects at the selected frame's real displayed time,
from the geocenter. It is not the spacecraft's apparent view. A combined WISE frame spans
an interval, while the query uses one representative time. The UI preserves that caveat.
UltracoolSheet rows preserve original-paper references and link its pinned release and
acknowledgements. The six checks are not an exhaustive novelty or discovery pipeline.

The earlier chemical-point system, catalog-miss multiplier and mandatory optical/Gaia gates
are rejected scientific assumptions, not pending features. Physical inference, novelty
assessment, additional VizieR tables, missions, advanced deduplication, reputation, voting,
quests and discovery verification need a separate specification and evidence.
