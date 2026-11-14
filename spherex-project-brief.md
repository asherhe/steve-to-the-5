# Planet X and SPHEREx — shared project brief

## What we are building

NASA Space Apps 2026 asks for a public web tool where anyone can enter right ascension and declination, see real SPHEREx images of that sky patch, and play them over time to spot movement or brightness changes. The challenge asks us to test Barnard’s Star, Epsilon Indi B, WISE 0855, RW Aurigae and R Draconis. WISE 0855’s supplied position is 08h55m10.831s, −07°14′42.53″. Record the result for every target, including coverage gaps and ambiguous changes. Adjustable field of view, spectral views, image subtraction, external overlays and shareable URLs are enhancements in the challenge brief. [Official challenge](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)

Our audience is citizen scientists and amateur astronomers. The pain point is getting from a coordinate to a trustworthy comparison without manually finding FITS files, aligning frames and checking observation conditions. Users should be able to tell which dates and wavelengths they are comparing, inspect a point against a known catalog and share what they saw so someone else can check it. A finding is a reproducible observation or question. Catalog lookup results and user comments are evidence for discussion.

Keep the map as the workspace. Use Aladin for navigation, show dated SPHEREx cutouts in the comparison view, and open the inspector and discussion in panels on the map. On mobile, use a bottom sheet. An optional activity layer shows clusters when zoomed out and individual finding pins when zoomed in. Readers may browse anonymously. Signed-in users can post or reply. A link is the invitation mechanism.

## Scope and scientific context

- **Core challenge.** RA/Dec input, adjustable field, fetch and play real dated SPHEREx images, shared brightness scale, timestamps and wavelength labels. Use one matched monochrome wavelength range per comparison in the MVP. Show coverage and quality issues where they affect interpretation.
- **Team MVP.** Add a Gaia inspector, optional activity layer, public candidate threads and reproducible comparison links. No separate feed or invitation inbox. Start the demo with a known object so users can practice reviewing evidence.
- **Later.** Wavelength slider, verified false-color presets, a spectrum panel, difference images, WISE historical imagery and a curated NEOSSat example. The map agent owns any display preset UX. A future preset should carry explicit channel assignments and shared per-channel stretches across dates. SPLICES supplies likely ice-feature targets. A validated molecular detection product would be required for a chemical map. WISE infrared brightness is a useful historical observable. Physical temperature requires further inference. An exploratory engagement and education layer is also under discussion; see "Engagement and education (exploratory, deferred)" below. [SPLICES](https://irsa.ipac.caltech.edu/data/SPHEREx/SPLICES/index.html) · [unWISE](https://irsa.ipac.caltech.edu/data/WISE/unWISE/overview.html) · [CADC NEOSSat](https://cadcftp.cadc.hia.nrc-cnrc.gc.ca/en/neossat/)
- **Time and wavelength.** DR1 was released November 12, 2026, and covers Surveys 1 and 2, roughly May 2025 to mid-May 2026. QR3 provides later observations using the same improved pipeline. Query both and use actual timestamps. The 102-layer DR1 mosaic is a wavelength product formed from combined observations. Dated Spectral Images power playback. Gaia DR3 supplies astrometry referenced to 2016.0. Any Gaia position propagated to a SPHEREx date must be labeled as a prediction. [IRSA releases](https://irsa.ipac.caltech.edu/spherex-archive-documentation/spherex-data-releases/) · [Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3)

## Engagement and education (exploratory, deferred)

This section records an early brainstorm about making the viewer more interactive and
educational for citizen scientists. It is **exploratory and deferred**: not part of the MVP,
not scheduled, and not a committed contract change. Nothing here is a scientific claim. These
are engagement and learning mechanics layered on top of real data, and they do not relabel a
reproducible observation or question as a validated discovery. Treat anything below as a
proposal under discussion until the coordinator adopts it.

Guiding constraints for any later work on these ideas:

- Keep the core deliverable unchanged: coordinate-based viewing of real, dated SPHEREx
  observations with matched monochrome playback, understandable metadata, and reproducible
  evidence.
- Frame "rare" or "interesting" as engagement and teaching cues, not statements about
  physical rarity, variability, or detection. Labels seen by the public must not imply a
  discovery.
- Build on existing labeled data (observed frames, catalog lookups, wavelength labels) and
  keep predicted, observed, and reference products distinct, as the rest of the brief requires.

Ideas captured, each deliberately scoped small:

- **Motion, kept minimal.** Add a basic motion/time-stepping view only to satisfy the
  requirement, and do not extend it. The available time series is short (roughly two to three
  dated points per target in current data), so a thin time axis cannot support strong motion
  or variability conclusions. Preserve that limitation in any wording.
- **Two ways to explore a target.** Let a user switch freely between the dated SPHEREx
  spectral view and the time-lapse imagery view for the same sky position. Offering two
  complementary views of one target is a more interactive way to explore and compare, without
  changing what either product scientifically represents.
- **Educational infrared wavelength exploration.** A wavelength slider (already deferred
  under "Later") where moving across infrared wavelengths changes which features look brighter
  or dimmer. With no artificial cooldown, users learn by trial and error how the same patch of
  sky looks at different wavelengths (for example, something prominent near ~1042 nm). The
  value here is teaching how objects appear across infrared bands, not scoring or ranking
  objects. This remains deferred and depends on the verified false-color / per-channel stretch
  work noted under "Later".
- **More hints and context per object.** Surface additional per-object information and hints
  (for example, catalog context and wavelength labels) so that exploring one object after
  another stays engaging and users can form their own exploration strategies. This reuses
  existing labeled evidence rather than introducing new claims.
- **Optional discovery/trivia framing.** A possible game-like wrapper that invites users to
  seek out niche or unusual-looking objects as an engagement hook. If pursued, it must stay
  clearly separated from reproducible findings, must not present engagement outcomes as
  scientific results, and would be designed and owned separately. We are not building this
  yet, so this brief intentionally does not name or specify such a product.

Open questions before any of this leaves the exploratory stage: whether the short time series
makes the motion and time-lapse views worthwhile, how to word "rare"/"interesting" cues so
they never read as discoveries, and how the slider interacts with the deferred per-channel
stretch work. Route adoption and any resulting contract change through the coordinator.

## Architecture and integration

Assume React/TypeScript, Aladin Lite, Python/FastAPI with Astropy and a hosted Supabase database and auth. Browser requests HiPS map tiles on demand. Python fetches and caches small FITS cutouts and bounded catalog results. Use a same-origin API entry point in deployment. Aladin is a viewer. The reference layer and dated SPHEREx image products have separate roles. [Aladin API](https://cds-astro.github.io/aladin-lite/index.html) · [IRSA access](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-access/)

Use this brief and the implementation contract as repository context so each teammate can use their preferred agent. The repo coordinator adds the shared schema, fixtures and a minimal shell once. All five agents then branch from the same commit into separate worktrees and work concurrently. An owner runs their component or route with fixtures independently. Live integration depends on the data, but frontend implementation does not. The coordinator can be one of the five teammates. They own shared schema changes, generated types, root dependencies, app entry points, deployment and merges. Agents own only their assigned directories and communicate any contract change through the coordinator.

In parallel with frontend work, prove one real matched pair early. Try Barnard’s Star and a variable star first, then cover all five targets. Published API documentation supports the design. Live target results, cross-origin behavior and deployed latency still require testing. Cache the first useful pair with provenance. If a live request fails, show the archive status and surface a separately labeled saved example. Preserve coordinate search as the normal path.

**Schedule.** Aim for a first real comparison in the first two hours, a fixture-backed UI that afternoon and an integrated demo on the weekend. The prior 14–20 working-hour range is a rough planning estimate, not a dependency or deadline. The critical path is archive verification → archive/viewer wiring → authenticated post and reply → deployed smoke test. Cut deferred wavelengths first if the schedule compresses. Keep the matched monochrome comparison and a reproducible evidence link as the minimum demo.

## Demo acceptance

A fresh visitor opens the public map, enters a coordinate or selects a known target, sees two or more aligned dated frames when coverage supports it, and understands what changed. A signed-in user posts from the selected point. A second visitor opens the thread anonymously, restores exactly that comparison and signs in to reply. Verify the five challenge targets, missing coverage, archive failure, signed-out write denial, and the replay of a saved comparison. Attribute the applicable SPHEREx image release and link the source observations. [DR1 attribution and DOI](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html)

