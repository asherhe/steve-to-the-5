# Engagement layer × social findings: integration concept and user stories

Status: **exploratory, deferred.** This document explores how the deferred engagement/game
layer could connect to the social findings platform. It is a proposal for discussion, not a
committed contract change. Adoption and any resulting schema or route change go through the
coordinator.

Sources and constraints: `spherex-project-brief.md` ("Engagement and education (exploratory,
deferred)", demo acceptance), `spherex-agent-handoffs.md` (findings backend/UI and shared
interface), and `AGENTS.md` (a finding is a reproducible observation or question, not a
validated discovery).

## The core design rule

Keep two layers separate and join them only by reference:

- **Evidence layer (unchanged, authoritative).** Comparisons, findings, replies, catalog
  lookups. Immutable, reproducible, scientific. A finding is an observation or a question.
- **Engagement layer (new, non-authoritative).** Progress, prompts, streaks, collections, and
  learning signals that reward *participating and learning*, never the *truth of a finding*.

The rule, stated plainly: **gamify the act of looking, verifying, and explaining. Never
gamify whether a finding is real.** Points must not attach to being "right" about a
discovery, because the product deliberately does not adjudicate discoveries. This keeps the
integration honest and, for the pitch, more defensible than a plain leaderboard.

## How the two could connect

Each idea reuses existing contract objects (comparisons, findings, replies, marks, the
five-target coverage log) and adds only engagement metadata that points at them.

- **Quests over real sky, not over claims.** A quest is "open a comparison for each of the
  five challenge targets and log an honest outcome" or "find a patch with a coverage gap and
  record it." Completion is awarded for the *act* (opening, comparing, recording an honest
  state such as `single_epoch` or `no_coverage`), never for asserting a change. This rides on
  the existing coverage log and comparison states.
- **Wavelength-exploration challenges (educational).** Using the deferred infrared wavelength
  slider, a prompt asks "find where this feature looks brightest." The reward is for
  exploring the band and explaining what they saw, so the slider teaches how the infrared sky
  behaves. Depends on the deferred per-channel stretch work; stays educational, not scored on
  correctness of a physical claim.
- **Verification credit, the social hook.** The most valuable social action is checking
  someone else's work. A contributor earns recognition for opening another user's shared
  comparison, restoring the exact evidence, and replying with a substantive observation or a
  reasoned "I can't reproduce this." This directly strengthens the existing public-read /
  authenticated-reply loop and rewards reproducibility rather than spectacle.
- **Collections instead of a leaderboard.** Rather than ranking users by "discoveries," let
  people assemble labeled collections ("objects I compared across dates", "coverage gaps I
  found", "catalog checks I ran"). Collections reference findings and comparisons by ID and
  carry no scientific weight on their own.
- **Streaks for habits, not for being right.** Reward consistent reviewing (e.g. replying to
  N threads this week) to build the community habit, decoupled from whether any finding holds
  up.
- **Gentle onboarding via a known object.** The demo already starts with a known object;
  framed as a tutorial quest, a newcomer practices the full loop (compare → inspect catalog →
  mark → post → share) before exploring freely.

## Boundaries carried from the brief and AGENTS.md

- Engagement metadata never mutates image evidence, a saved comparison, or a finding's
  content; it only references them. This matches the reproducibility invariants.
- Public labels keep "rare"/"interesting" as teaching cues. No engagement outcome is shown as
  a scientific result or a discovery.
- Emails and private identity stay private; engagement surfaces only the public display name,
  same as findings today.
- Points and progress are not evidence and must be visually and structurally distinct from
  findings, replies, and catalog data.
- Any new persisted field, route, or schema change is a coordinator-owned contract change,
  not something an individual slice invents.

## User stories

Written for citizen scientists, amateur astronomers, and classrooms. Each keeps the
engagement reward on the *action*, not on a claim.

### A. Tolu completes the "Five Targets" quest

**Who:** Tolu, new to the platform, wants a reason to explore beyond one click.
**Story:** A tutorial quest asks Tolu to open a comparison for each of the five challenge
targets and record an honest outcome. For two targets he sees a real matched pair; for
another the tool reports a coverage gap, and recording that gap still completes the step. He
finishes the quest having learned to read dates, wavelength labels, and coverage states.
**Reward:** Progress for completing the loop and for logging honest outcomes, including the
gaps. Nothing is awarded for claiming a change.
**Why it matters:** Teaches the core workflow and reinforces that "no comparison possible" is
a valid, respectable result.

### B. Priya earns verification credit for checking a stranger's finding

**Who:** Priya, browsing a thread a friend shared.
**Story:** Priya opens the link anonymously, then signs in. She restores the exact comparison,
steps the blink, and replies either confirming what she sees or explaining why she can't
reproduce it. Her substantive reply earns verification credit.
**Reward:** Recognition for reproducing and reviewing, the highest-value social act.
**Why it matters:** Makes peer review the thing the community celebrates, which is exactly the
reproducibility the product is built around.

### C. A classroom runs a wavelength-exploration challenge

**Who:** A teacher with a small group.
**Story:** Each student takes a target and a prompt: slide across infrared wavelengths and
find where a feature looks brightest, then post a short note on what changed and why that is
interesting to look at. With no cooldown, they learn by trial and error.
**Reward:** Credit for exploring the band and explaining the observation, not for a correct
physical answer.
**Why it matters:** Turns the deferred slider into a genuine teaching tool while staying
explicitly non-scientific in its claims.

### D. Dev builds a collection instead of chasing a score

**Who:** Dev, a regular contributor.
**Story:** Over several sessions Dev groups his work into labeled collections, "objects I
compared across dates" and "coverage gaps I found", each referencing saved comparisons and
findings by ID. He shares a collection link; others open it and review individual items.
**Reward:** A tidy, shareable body of participation, with no ranking of users by "discoveries."
**Why it matters:** Encourages sustained, honest participation without creating pressure to
overclaim.

### E. Sam is nudged toward rigor, not spectacle

**Who:** Sam, a careful reviewer wary of gamified tools.
**Story:** When Sam posts a finding, the platform prompts him to attach the exact comparison
and, optionally, a catalog check from the inspector. Completing these strengthens the thread
and earns engagement credit for *evidence quality of the post*, never for the conclusion.
**Why it matters:** Aligns the incentive with reproducibility and catalog context, the
opposite of rewarding bold claims.

### F. The community keeps an honest streak

**Who:** A returning amateur astronomer.
**Story:** A weekly habit track rewards reviewing and replying to others' threads. The streak
is about showing up to verify, not about being right, so it never pressures anyone to assert a
change they didn't see.
**Why it matters:** Builds the collaborative habit that makes a findings platform alive, while
staying decoupled from scientific correctness.

## Open questions before this leaves the exploratory stage

- Does the short real time series (roughly two to three dated points per target) make
  quest-style motion exploration worthwhile, or should quests center on catalog checks and
  verification instead?
- How is engagement data stored and surfaced so it is structurally impossible to mistake for
  evidence? (Separate tables/namespaces, distinct UI, reference-only links.)
- What is the minimum coordinator-owned schema addition, if any, to support quests, credit,
  and collections without touching the findings evidence schema?
- How do we word every engagement label so it never reads as a discovery claim in public view?

## Relationship to the pitch

If the pitch wants a forward-looking beat, use these as "where this goes next": a social
platform that rewards *looking carefully and verifying each other*, built on real labeled
SPHEREx data. Keep it after the core demo and clearly framed as exploratory. See
`docs/pitch-user-stories.md` story 6 for the one-sentence version.
