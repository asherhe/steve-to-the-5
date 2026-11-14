# Challenge compliance assessment: the rarity game vs. Planet X and SPHEREx

Status: **assessment / pitch-guidance.** Checks the game-plus-findings plan
(`docs/engagement-social-integration.md`) against the official NASA Space Apps 2026 "Planet X
and SPHEREx" challenge. Not a contract change.

Sources: the official challenge Details text (objectives, test targets, potential
considerations), `spherex-project-brief.md`, `spherex-agent-handoffs.md`, `AGENTS.md`. The
attached "NASA Space Apps Challenge.pdf" is the generic project-submission guide, not
challenge criteria, so it informs submission format only, not scope.

## Verdict

**Compliant. The game is built inside the challenge boundaries, not outside them.** The
official text is more discovery- and crowd-oriented than our internal brief, which helps the
game concept rather than hurting it. Two things must be managed or the pitch will *read* as a
deviation: a framing correction, and a scope-discipline risk.

## What the challenge actually requires

Mandatory core (narrow and explicit):

- A public-facing web tool that displays SPHEREx sky images and makes it easy to see how they
  change over time.
- Users enter RA/Dec; the tool plays a series of images "like a little video" to spot moving
  objects.
- Test targets: Barnard's Star, Epsilon Indi B, WISE 0855 (08h55m10.831s, −07d14m42.53s),
  RW Aurigae, R Draconis.

Everything else is explicitly optional ("You may, but are not required to"): ways to display
the 102 infrared bands, spectra on the fly, adding/subtracting images across times,
field-of-view choice, Gaia/WISE overlays, URL coordinate queries, metadata such as
contamination flags, and using tools like Astropy and Aladin.

Two official phrases that matter for the game:

- "We need your creative new tools... help as many people as possible pitch in to make
  discoveries." Crowd participation and discovery-enablement are explicitly invited.
- The backyardworlds.org precedent: hundreds of thousands of volunteers discovering asteroids,
  comets, stars and brown dwarfs. NASA is pointing at a gamified, crowdsourced citizen-science
  model as the pattern to follow.

## How our plan maps to it

On-target and fully compliant:

- Coordinate entry + image playback over time + blink/motion spotting is the mandatory
  objective. The core viewer satisfies the challenge on its own.
- The five test targets are bundled presets.
- 102 infrared bands, WISE blink, field-of-view control, Gaia overlay (the catalog inspector),
  URL replay via `comparison`/`finding` params, quality/contamination flags, Astropy + Aladin
  are the exact items on the official optional list. We are checking their suggested boxes, not
  inventing scope.

The game layer, compliant and arguably the strongest fit:

- A rarity hunt + permanent leaderboard + per-entry discussion forum is a direct answer to
  "help as many people as possible pitch in to make discoveries" and to triaging a dataset
  "no one person can sift through alone."
- The backyardworlds precedent means judges will recognize the pattern as aligned, not
  gimmicky.

Conclusion: the game builds within the boundaries. The challenge invites exactly this kind of
crowd tool.

## Two things to manage

### 1. Framing correction

- Keep the scientific discipline: a finding is an observation or question, not a validated
  discovery. But do not over-correct into sounding like the tool refuses to enable discovery.
  The official text celebrates volunteers making discoveries. The honest, compliant framing is:
  **the tool and game surface and triage candidates for discovery; confirmation is a downstream
  human/scientific step.** User story H (leaderboard candidate → astronomer investigates) is the
  money shot; lead with it.
- Keep the "possible / candidate" wording. SPHEREx is officially described as sensitive to
  objects rich in hydrogen, water, carbon dioxide, carbon monoxide and other molecules, so a
  game signal that flags a "possible water-ice feature, candidate worth investigating" echoes
  NASA's own language. This is the correct translation of the challenge, not a hedge.

### 2. Scope-discipline risk

- Judging is on a two-day build, and the game is deferred. The mandatory deliverable is the
  viewer. The real risk is not non-compliance; it is spending pitch time on an unbuilt game
  while the required viewer is what gets judged.
- Discipline: demo the compliant core first (coordinate → trustworthy comparison, the five
  targets, honest coverage, catalog inspector), then present the game as the crowd-scaling
  vision, with the leaderboard → discussion → astronomer pipeline as the climax. This matches
  the existing sequencing in `docs/pitch-user-stories.md` (core first, game as story 6).

## Accuracy note on epochs

The "two to three dated points per target" caveat is honest but risks underselling the motion
feature. The official text says SPHEREx maps the whole sky every six months since May 2025 and
that new data arrives fast, with an explicit nudge to design for easy updates with new
releases. Prefer wording like "a small number of epochs today, growing with each release."

## Bottom line

- Does it comply? Yes. The mandatory objective is the core viewer, which we have.
- Are we deviating? No. The game uses only officially suggested tools (bands, blink, FOV,
  Gaia/WISE, URL queries, flags) and answers the official call to help many people pitch in to
  make discoveries.
- Is there a compliant framing? We already have it. Three moves tighten it: (a) lead with the
  viewer + five targets; (b) present the game as candidate triage that feeds human discovery,
  not as the tool making discoveries; (c) keep "possible/candidate," which mirrors NASA's
  SPHEREx language.

The only genuine failure modes are self-inflicted: over-indexing the pitch on the unbuilt game,
or letting a public label read as a confirmed detection. The current docs guard both.

## Recommended doc edits (applied)

- Softened the epoch caveat in `docs/engagement-social-integration.md` to "a small number of
  epochs today, growing with each release, since SPHEREx maps the whole sky every six months".
- Added a "Challenge-compliance mapping" subsection to that doc tying each feature to the
  official objective and potential-considerations list, suitable to paste into the submission's
  "Detailed Project Description".
