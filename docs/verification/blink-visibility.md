# Barnard's Star blink visibility

Local verification, 2026-11-15, on `fix/blink-visibility`.

The saved WISE W2 comparison
`2225540ec1991dc20949c8d6b9e3a7e07e238ec59e1a01010d6ed3724bf7ff6f`
contains visits dated 2010-03-20 and 2024-03-19. In the original 131-by-131 PNGs,
the large masked-core source is near the bottom in 2010 and near the centre in
2024. Background sources remain approximately stationary. This is a visual
inspection, not a measured astrometric displacement or variability result.

At a 1440-by-1000 viewport the default Time panel covered both source positions.
The smaller stars above it remained visible. Also, transparent masks in the dated
image exposed the older AllWISE reference layer, mixing epochs visually.

The Blink window (previously named Time) now starts at the left edge on desktop. The dated sky raster composites the
saved PNG over neutral stripes before placing it with its unchanged WCS. Opaque
source pixels retain their original RGB values and stretch. Both sky and details
views explain the mask. Stored evidence, source images, dates and comparison IDs
are unchanged. No archive selection or processing defaults changed.

Checks completed:

- `npm.cmd run build`: passed.
- `overlay.browser.mjs`: synthetic moving source appears at its second position,
  disappears from its first, and returns exactly on stepping back; stationary
  colours, mask display, panel placement, WCS orientation, navigation and no
  extra discovery requests checked.
- `time-window.browser.mjs`: desktop movement/reset, playback, saved replay,
  image failure/retry, single epoch, touch and viewport bounds passed.
- `blink.browser.mjs`: synthetic SPHEREx/WISE controls, DSS exclusion and explicit
  longer/refresh requests passed.
- Actual local services at port 5178: replayed the above real comparison and
  visually inspected the on-sky images at both dates with the revised layout.

Browser commands use `PLAYWRIGHT_MODULE` pointing at a temporary Playwright
installation and `VIEWER_TEST_URL=http://127.0.0.1:5178`; scripts are under
`web/src/viewer/`. Real replay used the existing local evidence store, with no
fresh archive search. No deployed verification or longer SPHEREx baseline is
claimed by these checks.

Integration with `origin/main` at `b90b97f` preserved its unified Blink window and
`FrameDetails` replacement for `ComparisonPlayback`. The mask explanation moved
into Frame image, and browser selectors use the new Blink names. The build and all
three browser checks above passed again on the merged code before pushing.
