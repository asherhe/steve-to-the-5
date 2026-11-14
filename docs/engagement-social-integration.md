# A rarity-hunting sky game on real NASA data, integrated with the findings platform

Status: **exploratory, deferred.** This explores the team's game concept and how it connects
to the social findings platform. It is a proposal for discussion, not a committed contract
change. Any new schema, route, or persisted field is a coordinator-owned change.

Sources and constraints: `spherex-project-brief.md`, `spherex-agent-handoffs.md`, `AGENTS.md`
(a finding is a reproducible observation or question, not a validated discovery; no claim of
water, composition, temperature, or detection from imagery alone).

## The game loop (inspired by Krillion)

Krillion is a short daily game that rewards the *rarest valid answer*, not the correct one:
open prompts are scored against a familiarity database and mapped onto rarity tiers, shown as
a deep-sea dive, with the thrill of a rare hit bringing players back the next day.
([Krillion](https://krillionhq.com/), [rarity tiers](https://krilliongame.org/). Content was
rephrased for compliance with licensing restrictions.)

Our version keeps that loop and puts it on the real sky:

1. **Scan one area of sky at a time** using NASA SPHEREx and other data, the same map the
   viewer already uses.
2. **Select a star or candidate object.** The game assigns a **point value** from the object's
   observable properties and its catalog status: a well-known, densely catalogued object
   scores low (the common, "obvious" pick); an unusual-looking or sparsely catalogued one
   scores high (the rare hit).
3. **Hunt the rarest object you can** in a short session, using real tools as the gameplay
   mechanics: the SPHEREx infrared bands, the WISE blink, field-of-view and wavelength
   controls, and the catalog inspector.
4. **Come back daily** to beat your best find. Chasing rarer objects nudges players to learn
   real astronomy on their own so they can recognize what is worth selecting.

The excitement is the rare hit. The daily return is the habit. The learning is the by-product.

## The one principle that keeps it honest (and keeps the pitch strong)

Krillion rewards answers that are **valid and rare**, not merely bold. Our equivalent of
"valid" is set by the brief: we do not claim a discovery, a composition, or a temperature from
an image. So the score is built on **"how unusual and under-explored this is to investigate,"**
framed as a game signal, **not** on "this is a watery planet."

- Rarity means **unusual in the data and/or sparsely catalogued**, which is exactly what makes
  a find exciting anyway, and it is defensible to NASA judges.
- A property that *could* indicate something interesting (for example, a spectral feature often
  associated with ices) raises the game score as a **flag worth investigating**, phrased with
  "possible / candidate," never as a confirmed property.
- The **game score is its own layer.** If a player turns a find into a shared scientific
  **finding**, that finding stays an observation or a question, separate from points.

Stated plainly: **gamify the hunt for the rare and the act of investigating it. Never score a
player for a claim being true.** This preserves the full Krillion-style thrill while staying
inside what the data honestly supports.

## How scoring could work (sketch)

A transparent, explainable score so players can learn from it and so it never reads as a
scientific verdict. Each component is a game signal with a shown reason:

- **Catalog familiarity.** Densely catalogued and well-studied object → low (common). Sparse or
  no catalog match → high (rare). This mirrors Krillion's familiarity-database idea, using the
  Gaia DR3 inspector and other catalog lookups the viewer already has.
- **Observable distinctiveness.** Unusual behavior across SPHEREx infrared bands, or a change
  under the WISE blink, raises the score as "interesting to look at," with the specific reason
  surfaced ("stands out at ~1042 nm", "moves between epochs").
- **Candidate-feature bonus.** A spectral feature *possibly* linked to something notable adds
  points as a clearly-labeled **candidate flag**, never a confirmed property.
- **Rarity tiers.** Like Krillion's surface-to-trench tiers, map the total onto named tiers
  (common → extremely rare) with an astronomy-flavored theme, so a rare hit feels like an
  event.
- **Honesty guards.** Coverage gaps, low quality, or missing data cap or withhold a score
  rather than inventing one; "not enough data to score" is a legitimate, non-punishing outcome.

All scoring factors are game mechanics defined by us, shown transparently, and labeled as such
in the UI. They are not published as measurements.

## Integrating the game with the social findings platform

The game and the platform reinforce each other: the game generates interesting candidates; the
platform is where players turn a candidate into shared, reproducible evidence and collaborate.

- **"Promote a find to a finding."** From a scored object, a signed-in player can post a
  finding on that exact sky position: the game captures the comparison, the active frame/band,
  and the catalog check, and the finding is created through the normal findings flow. The
  score travels as engagement metadata that **references** the finding; it is not part of the
  evidence.
- **Verify and co-op.** Another player opens the shared link, restores the exact comparison,
  and replies confirming or disputing it. This earns verification standing. Rare finds that
  others successfully reproduce are the community's highlights, rewarding reproducibility
  rather than spectacle.
- **Daily challenge over a shared region.** Everyone gets the same patch of sky for the day (a
  Krillion-style shared prompt); players compete on the rarest well-supported find and compare
  notes in a thread.
- **Collections and streaks.** Players assemble labeled collections of their finds (referenced
  by comparison/finding ID) and keep a streak for consistent reviewing of others' threads.
  Neither carries scientific weight; both build the habit.
- **Learning hooks.** When a score cites a reason ("rare band behavior", "no catalog match"),
  offer a short explainer and a link to dig deeper, which is how the uninterested player starts
  researching astronomy on their own.

## The permanent rarity leaderboard (the bridge to real discovery)

The leaderboard is where the game stops being disposable fun and becomes useful to science.
The rarest finds stay up **permanently**, with their ranks catalogued, so other players and
even professional astronomers can revisit the top candidates and investigate them further. It
is the connective tissue between the game loop and the findings platform.

How it works, kept consistent with the reproducible-comparison contract:

- **An entry references evidence; it is not new evidence.** Each leaderboard entry stores its
  rank, its game rarity score and the reasons behind it, and a pointer to the **immutable saved
  comparison and finding** for that sky position. Reopening an entry restores the exact frames,
  bands, grid, dates and catalog check, which is precisely what an astronomer needs to
  investigate it. "Position catalogued permanently" is implemented through the existing
  immutable manifest and share-link guarantees, not a mutable copy.
- **Ranked by game rarity, labeled as a candidate.** The ordering is the game's rarity signal
  (unusual and/or under-explored), and every entry carries the "possible / candidate" framing.
  The leaderboard is a list of *interesting things worth investigating*, never a list of
  discoveries.
- **A discussion forum under each entry.** Each top entry has its own thread, built on the
  existing findings-reply mechanism, to prompt curiosity and let players and astronomers
  compare notes, propose follow-up observations, or flag an artifact. Public read for everyone;
  authenticated posting; emails private.
- **Investigation outcomes live in the thread, not in the score.** If someone later confirms or
  refutes something about a top candidate, that real-world outcome is recorded as discussion
  and evidence in the thread. It does not retroactively turn the game score into a scientific
  claim, and it does not mutate the original saved comparison.
- **Persistence and integrity.** Entries are durable and their referenced evidence is immutable;
  a republished archive or a changed default does not alter a ranked entry's frames. The
  coordinator owns any hide/moderation action, as with findings.

This is the payoff of the whole concept: a casual five-minute dive can surface a genuinely
unusual object, that object earns a permanent, reproducible spot on the leaderboard, and the
discussion forum beneath it invites the crowd, and eventually an expert, to dig in. A possible
candidate, clearly labeled, that anyone can reopen and check.

### What stays separated (carried from the brief and AGENTS.md)

- Two layers joined only by reference: **evidence** (comparisons, findings, replies, catalog
  lookups: immutable, reproducible) and **engagement** (scores, tiers, streaks, collections,
  leaderboard entries: non-authoritative). Engagement never mutates a saved comparison or a
  finding.
- The leaderboard ranks on the game rarity signal and references immutable evidence; it never
  presents a ranked entry as a discovery, and a later investigation outcome is recorded as
  discussion, not as a change to the score or the saved comparison.
- Public labels keep "rare/interesting" and candidate flags as game-and-teaching cues, with
  "possible/candidate" wording. No engagement output is shown as a scientific result.
- Emails and private identity stay private; only the public display name appears.
- Any persisted field, route, or schema change for scoring, challenges, or collections is a
  coordinator-owned contract change, not something an individual slice invents.

## User stories

Written for the target audience: casual players, amateur astronomers, and classrooms. The
reward is always on hunting and investigating, never on a claim being true.

### A. Marcus plays a five-minute daily dive and hits a rare one

**Who:** Marcus, a casual player with no astronomy background, on his phone at lunch.
**Story:** Marcus opens today's region, scans with the infrared bands and the blink, and taps
a few objects. Most come back common (brightly catalogued, low points). Then he taps one with
no catalog match and odd band behavior; the game lights up a high rarity tier and shows why.
He logs off thrilled and comes back tomorrow.
**Why it matters:** This is the Krillion hook on the real sky, short session, rare-hit dopamine,
daily return, and it runs entirely on real NASA data.

### B. A rare hit becomes a shared finding

**Who:** Marcus again, now curious enough to share.
**Story:** From his rare find, Marcus hits "share this as a finding." The game hands the exact
comparison, band, and catalog check to the findings flow; he adds a one-line question ("why
does this one stand out at this wavelength?") and posts. The score tags along as engagement
metadata, the finding itself is a reproducible question.
**Why it matters:** Shows the game feeding the social platform without ever dressing a score
up as a discovery.

### C. Priya verifies someone's rare find

**Who:** Priya, opening Marcus's shared link.
**Story:** She restores the exact comparison, steps the blink, and replies that she sees the
same standout band behavior but notes it could be an artifact near a coverage edge. Her
substantive reply earns verification standing; Marcus's find is marked community-reviewed.
**Why it matters:** The most valuable social act is reproducing and sanity-checking a rare
hit, which is exactly the reproducibility the product is built on.

### D. Dina chases rarity and ends up learning spectroscopy

**Who:** Dina, competitive, wants the top find of the day.
**Story:** To find rarer objects she starts reading the score reasons ("rare band behavior",
"sparse catalog") and follows the explainer links, then experiments with specific infrared
bands on purpose. Within a week she is choosing targets with real intuition about what looks
unusual.
**Why it matters:** This is the educational payoff the team wants: the game turns idle
curiosity into self-directed astronomy learning.

### E. A classroom runs the daily shared region

**Who:** A teacher and a small group.
**Story:** Everyone plays the same daily region. Students compare which objects scored rare and
why, use the bands and blink to justify their picks, and post short notes. The lesson is how
the infrared sky behaves and how catalogs work, taught through play.
**Why it matters:** The shared-prompt format plus transparent scoring makes a natural,
low-friction classroom activity.

### F. Sam trusts it because it refuses to overclaim

**Who:** Sam, a careful amateur wary of gamified science.
**Story:** Sam picks an object in a coverage gap. Instead of a fake score, the game says there
is not enough data to score it and explains why, and when he posts a finding it is framed as a
question, not a result. The candidate flags all read "possible," never "confirmed."
**Why it matters:** The honesty guards are a feature, not a limitation, and they are what make
the whole concept credible to judges.

### G. Marcus's rare find lands on the permanent leaderboard

**Who:** Marcus, after sharing his rare hit as a finding.
**Story:** His find's rarity score is high enough to enter today's leaderboard. The entry
shows its rank, the rarity tier and the reasons, and links straight back to his immutable
comparison. Weeks later it is still there, and still reopens the exact frames he saw.
**Why it matters:** The permanence is the hook that gives a casual find lasting value and makes
it worth an expert's time later. It rides on the reproducible-comparison guarantees.

### H. An astronomer investigates a top leaderboard candidate

**Who:** Dr. Okafor, a professional who browses the top of the leaderboard.
**Story:** She opens a high-rarity entry, restores the exact comparison and catalog context,
and recognizes it as worth a real follow-up observation. She posts in the entry's discussion
thread with what she'd check next. The entry stays a labeled candidate; her note is recorded
as evidence and discussion.
**Why it matters:** This is the concept's ultimate payoff, a crowd-surfaced candidate drawing
expert attention, without the game ever claiming the discovery itself.

### I. A discussion thread turns curiosity into a group investigation

**Who:** A mix of players and enthusiasts under one leaderboard entry.
**Story:** The forum beneath a striking entry fills with questions: is it an artifact near a
coverage edge, a known variable, something genuinely odd? People restore the evidence, compare
bands, and link catalog checks. The thread becomes a small, open investigation.
**Why it matters:** The per-entry forum is what converts a leaderboard position into sustained,
collaborative curiosity, exactly the behavior the platform exists to support.

## Open questions before this leaves the exploratory stage

- Does the short real time series (roughly two to three dated points per target) support a
  motion/blink-based rarity signal, or should early scoring lean on catalog familiarity and
  band distinctiveness?
- What exact, defensible inputs define the score, and how do we show every factor so it never
  reads as a measurement?
- What is the minimum coordinator-owned schema to carry scores, daily challenges, collections,
  and **permanent leaderboard entries** (rank, score, reasons, reference to the immutable
  comparison/finding) without touching the findings evidence schema?
- Leaderboard design: how many entries persist, is there an all-time board plus daily/weekly
  boards, and how are ties and re-scoring handled without mutating a ranked entry's evidence?
- How do we moderate leaderboard entries and their forums (coordinator-owned hide action) and
  keep emails private while surfacing display names?
- How do we word every rarity and candidate label so it never implies a discovery in public
  view?
- Rate/daily-cap design: one dive a day (habit) vs. an endless mode (engagement), as Krillion
  offers both.

## Relationship to the pitch

Lead the core demo first (coordinate to trustworthy comparison, honest coverage, catalog
inspector). Then present this as the vision: a five-minute daily rarity hunt on real NASA
SPHEREx data that quietly teaches astronomy, surfaces genuinely unusual candidates onto a
permanent leaderboard, and gathers players and astronomers in a discussion under each top
find. Keep it framed as exploratory. See `docs/pitch-user-stories.md` story 6 for the one-line
version.
