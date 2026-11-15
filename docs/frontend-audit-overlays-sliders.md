# Frontend audit: what's built, and the overlays and sliders still to do

Status: **audit / planning.** A snapshot of the frontend against the challenge's mandatory
objective and its "potential considerations" list, plus the base-model overlays and sliders
still to design. Not a contract change. Branch audited: `implement-overlays-ui`.

Sources: the official challenge Details text (objective, test targets, potential
considerations), `spherex-project-brief.md`, `spherex-agent-handoffs.md`, the viewer README
and `web/src/**`.

## What exists today (verified in the tree)

The app shell integrates all five slices. The viewer (`web/src/viewer`) renders the Aladin
Lite sky, field search, and the comparison playback; the inspector (`web/src/inspector`) and
findings UI (`web/src/findings`) mount as panels.

Built and working:

- **Aladin Lite sky map** with a SPHEREx DR1 all-sky mosaic reference layer, pan/zoom,
  orthographic + all-sky views (`SkyMap.tsx`).
- **Coordinate + preset search** (decimal and sexagesimal), the five target presets, and a
  field-of-view control bounded 1–30 arcmin (`FieldSearch.tsx`, `coordinates.ts`).
- **Matched monochrome playback** over dated frames with next/previous, auto-play/blink,
  per-frame observation date, the comparison's wavelength range and a single shared stretch
  (`ComparisonPlayback.tsx`).
- **Five archive outcomes** surfaced honestly: ready, single_epoch, no_coverage,
  no_comparable_pair, upstream_unavailable, with retry and a labeled saved real example.
- **URL replay** via `comparison` and `finding` query parameters, including browser
  back/forward (`Viewer.tsx`, `evidence.ts`).
- **Gaia inspector overlay** (one marker): click a sky position or a cutout to inspect the
  nearest Gaia DR3 source; "Mark position" places a single marker on the reference sky, and a
  predicted marker is labeled and shown only on its recorded frame (`SkyMap.tsx` addCatalog,
  `SourceInspector`).
- **Findings activity + discussion** panels with show-evidence and copy-link.
- **Copy/share links** for comparisons and evidence.

## Challenge requirements: satisfied vs. still open (frontend)

Mandatory objective (required):

| Requirement | Status |
|---|---|
| Public web tool, RA/Dec entry | Done |
| Play dated images "like a little video" to spot motion | Done (blink + step) |
| Five test targets | Done (presets + honest coverage) |

Potential considerations (optional; where the frontend stands):

| Consideration | Status | Frontend gap |
|---|---|---|
| Easy to update with new data releases | Backend-led | No release/epoch selector in the UI |
| Display the 102 infrared bands creatively | **Not started** | No band/wavelength selector or slider |
| Spectra on the fly | Not started (deferred) | No spectrum panel |
| Add/subtract images across times | **Not started** | No difference/blend control |
| Choose the field of view | Done | — (works within 1–30 arcmin) |
| Overlay Gaia / WISE data | Partial | Gaia single-marker only; no Gaia cone overlay, no WISE layer |
| URL coordinate queries | Done | — |
| Display metadata such as contamination flags | Partial | `qualityFlags` carried in the model; not surfaced per frame in the UI |
| Use Astropy and Aladin | Done | — |

So the frontend already satisfies the mandatory objective. The open frontend work is entirely
in the optional overlays and sliders, which is where the challenge awards creativity.

## Overlays and sliders to implement (base model)

Prioritized for a two-day build. Each item notes the contract or data it depends on, so the
coordinator can confirm the shared schema before UI work starts. None requires new map
windowing beyond what Aladin already exposes.

### Overlays

1. **Gaia catalog cone overlay (upgrade the existing single marker).**
   Draw all nearby Gaia DR3 sources from `/api/catalogs/nearby` as an Aladin catalog layer, not
   just the one marked source. Clicking a source opens its detail in the inspector. Predicted
   positions stay labeled and distinct from observed. A toggle shows/hides the layer.
   *Depends on:* the existing nearby route (already built). Low risk, high visible payoff.

2. **WISE reference overlay / blink.**
   Add WISE imagery as a selectable Aladin HiPS layer (for example unWISE) so users can
   cross-check SPHEREx motion against an independent survey. Base model: a layer toggle and an
   opacity control; a WISE-vs-SPHEREx blink is a stretch goal.
   *Depends on:* a public WISE HiPS URL; no new backend route. Note the brief defers deep WISE
   history, so keep this to a reference overlay, not an analysis product.

3. **Per-frame metadata / contamination flags.**
   Surface each frame's `qualityFlags`, release and source link in the playback panel, with a
   plain-language note when a flag affects interpretation. This is a small UI addition over data
   already in the comparison frame model.
   *Depends on:* frame fields already in the archive contract (present). Very low risk.

4. **Marker/annotation overlay consistency.**
   Ensure a findings pin and a selected image position use the same sky coordinates across the
   map and the cutout (the contract requires this). Mostly wiring and a verification check.

### Sliders

5. **Infrared band / wavelength selector (the headline creative feature).**
   A control to choose which SPHEREx band(s) or wavelength range drives the displayed frame.
   Base model: a discrete selector or slider over the available bands for the field, updating
   the monochrome frame; show the selected wavelength label. This is the single most
   challenge-aligned creative feature and is currently absent.
   *Depends on:* a coordinator-owned contract decision — does a comparison expose multiple
   per-band frames, or does the archive accept a band/wavelength parameter per request? Raise
   this with the coordinator before building; do not invent a parallel API shape. Keep the MVP
   matched-monochrome comparison intact; the slider is additive.

6. **Stretch / brightness slider.**
   Let users adjust the shared stretch (min/max or a gamma) for the current comparison to pull
   out faint motion, while keeping one stretch shared across the compared frames so the
   comparison stays valid. Reset returns to the saved stretch.
   *Depends on:* client-side rendering of the existing stretch bounds; no new route. Medium
   effort; must not change a saved comparison's recorded stretch (reproducibility).

7. **Playback speed / blink-rate slider.**
   Expose the existing auto-play as a user-adjustable blink rate, which is how classic blink
   comparators reveal motion. Small addition to `ComparisonPlayback`.
   *Depends on:* nothing new. Low risk.

8. **Image add/subtract (difference) control.**
   A toggle/slider to blend or subtract two selected frames to make motion or brightness change
   obvious. The brief defers true difference imaging, so the base model is a client-side
   visual blend/difference clearly labeled as a display aid, not a science product, and only
   when frames share grid, stretch and wavelength.
   *Depends on:* confirming with the coordinator whether difference stays client-side display
   only for the MVP. Keep it labeled and non-authoritative.

### Epoch / release selector (supporting control)

9. **Epoch or data-release selector.**
   As releases arrive every six months, let users pick which epochs to compare. Base model: a
   simple list of available dated frames with include/exclude, feeding the same comparison.
   *Depends on:* the archive exposing available epochs for a field. Confirm with the coordinator.

## Suggested order for a short build

1. Per-frame metadata/flags (3) and playback-rate slider (7): tiny, immediate.
2. Gaia cone overlay (1) and stretch slider (6): high payoff, no new backend contract.
3. Band/wavelength selector (5): the headline feature, but confirm the archive contract first.
4. WISE overlay (2) and difference control (8): creative extras, kept clearly as display aids.
5. Epoch selector (9): once the archive exposes per-epoch selection.

## Guardrails carried from the brief and AGENTS.md

- Any new archive/catalog request shape (band parameter, per-epoch selection, difference) is a
  coordinator-owned contract change. Do not add a parallel API in the viewer.
- Keep the matched-monochrome comparison and reproducible evidence link as the minimum. Sliders
  and overlays are additive and must not alter a saved comparison's recorded settings.
- Label WISE and reference layers, predicted markers, and any difference/blend as display aids
  or predictions, never as measurements or discoveries. Surface quality flags where they affect
  interpretation.
- Band and stretch controls are quick-look display tools unless the coordinator adopts verified
  per-channel stretch work; keep that distinction explicit in the UI.
