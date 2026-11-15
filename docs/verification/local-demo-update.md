# Local viewer update — 2026-11-15

The map's SPHEREx / DSS / WISE controls now select the survey view; the duplicate
SPHEREx/WISE switch beside Leaderboard was removed. DSS remains a reference layer in
the current survey view. The full-screen map and floating panes remain.

**Open saved real example** now loads the recorded six-arcminute SPHEREx field centered
at RA 133.79512916666664°, Dec −7.245147222222222° (ICRS). It contains two 59×59
pixel frames from 2025-05-06 and 2026-05-13. The default pane uses its standard size,
while the map is framed at 18 arcminutes for context. The dated footprint and field
coordinates are labeled; enlargement is optional and preserves the original pixels.
WISE 0855 is a brown dwarf, not an asteroid. Its quoted coordinate epoch is unspecified.
The saved pair does not establish that WISE 0855 is detected or moving in these images.
Use Advanced search to enter the coordinates and a six-arcminute field, or load the
example directly. A visible moving-object demonstration still requires suitable image
data and validation.

The archive API replays an exact recorded field from integrity-checked, immutable
manifests before querying IRSA. The four retained real fields (the original one-arcminute
example, WISE 0855, Epsilon Indi B, and R Draconis) are available by ID and as exact
field searches. Other positions still use the live archive. Their first build can take
much longer because IRSA discovery and cutout downloads are external; no speed claim is
made for arbitrary fields. The real local endpoint returned the WISE 0855 pair in
**0.075 seconds** after restart. The HTTP test confirms this path never contacts IRSA and
serves the original PNG assets.

The app defaults to a browser-only findings simulation in development and in builds.
No sign-in or findings service is required. Select a point in the saved example, run
**simulated catalog checks**, post a title and note, open Leaderboard, and reply.
Reviews support the four retained real comparison fields. Findings and rankings persist in this browser's localStorage across reloads. All six
catalog checks say **skipped**; the 20 points reflect the saved real image and its two
dates. Scores, people and posts in this mode are local examples, not public rankings.
Fixture mode (`?fixtures=1`) remains separate. When a real findings backend and Auth
are ready, build or run with `VITE_LIVE_FINDINGS=1` to enable the production adapter
and sign-in. Do not publish the default simulated rankings as a live public board.

Verification performed: archive suite 79 prior tests plus one new recorded-field test;
frontend build/type-check and 106 Vitest tests; eight production browser scenarios;
local development browser post/replay/reply check with **zero findings API requests**;
and the timed actual local archive request. Restart `npm run dev` after Python edits.
