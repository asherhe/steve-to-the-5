# Pitch user stories

Narrative user stories to guide the NASA Space Apps 2026 pitch for the Planet X and SPHEREx
viewer. Each is written for a real audience member, anchored in what the MVP actually does
and in the challenge's own acceptance criteria. They are pitch material, not a change to the
product contract. Scientific framing follows the brief: a finding is a reproducible
observation or question, never a claimed discovery.

Sources: `spherex-project-brief.md` (scope, targets, demo acceptance) and
`spherex-agent-handoffs.md` (shared interface and the five slices).

## Audience

Citizen scientists and amateur astronomers, plus the Space Apps judges evaluating against the
Planet X and SPHEREx challenge. The pain point the pitch must land: getting from a coordinate
to a trustworthy, shareable comparison without manually hunting FITS files, aligning frames,
and checking observation conditions.

## How to use these in the pitch

Lead with story 1 (the core demo path, which is also the challenge's acceptance test). Use
stories 2–5 to show depth: trust, collaboration, honesty about gaps, and the known-catalog
inspector. Keep story 6 explicitly as "where this could go," not as a shipped feature.

---

## 1. Maria enters a coordinate and sees time move

**Who:** Maria, an amateur astronomer who has read about Barnard's Star but never touched an
archive.

**Wants:** To see whether a famous high-proper-motion star actually looks different across
SPHEREx dates, without downloading anything.

**Story:** Maria opens the public map, types a coordinate (or picks a bundled target such as
Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, or R Draconis), and sets a field of
view. The viewer fetches the real dated SPHEREx frames for that patch, aligns them on one
grid with one shared brightness scale, and blinks them in matched monochrome. Every frame
shows its actual observation date and wavelength label. She can tell exactly which two dates
and which wavelength she is comparing.

**Why it matters to the audience:** This is the whole promise in ten seconds, coordinate to
comparison, with no FITS wrangling. It is also the challenge's first acceptance criterion: a
fresh visitor enters a coordinate, sees two or more aligned dated frames when coverage
supports it, and understands what changed.

**Demo beat:** Pick a target that has a real cached matched pair; step the blink; point at the
dates and wavelength label.

---

## 2. Dev shares exactly what he saw, and it stays exactly that

**Who:** Dev, who thinks he spotted a brightness change and wants a second opinion.

**Wants:** To show someone the precise comparison he was looking at, not an approximation.

**Story:** From the selected point, Dev signs in and posts a short finding: a title, a note,
and a mark on the frame. He copies the link. The comparison is stored as an immutable
manifest with its frames, grid, dates, wavelength labels, and stretch. When the archive later
republishes data or a default wavelength selection changes, his saved comparison does not
change. The link reopens the same evidence, every time.

**Why it matters to the audience:** Citizen science only works if "what I saw" is
reproducible. The pitch point: a shareable link is the invitation mechanism, and the evidence
behind it is frozen. This maps directly to the reproducible-comparison guarantees and the
`comparison` / `finding` replay query parameters.

**Demo beat:** Post a finding, copy the link, open it in a second browser profile, and show
the identical frames restored.

---

## 3. Priya opens a stranger's link and joins the conversation

**Who:** Priya, browsing anonymously after a friend sent her a thread.

**Wants:** To check someone else's observation and weigh in.

**Story:** Priya opens the shared link with no account. She sees the public finding, the
author's display name, the evidence, and the replies, and the viewer restores exactly that
comparison and annotation. She reads anonymously, then signs in to reply. Her reply posts
under her identity; her email stays private. A second account's reply appears in the same
thread.

**Why it matters to the audience:** This is the collaboration loop that turns a tool into a
community: public read for everyone, authenticated write for contributors, no invitation
inbox needed. It is the challenge's second and third acceptance beats (signed-in post, a
second visitor restores and replies) and exercises the public-read / auth-write boundary.

**Demo beat:** Two browser sessions, prove public read, then sign-in, post, and reply.

---

## 4. Sam hits a coverage gap, and the tool is honest about it

**Who:** Sam, a meticulous reviewer who distrusts tools that always say "yes."

**Wants:** To know when there is not enough real data to make a claim.

**Story:** Sam searches a coordinate with only one epoch of coverage, so the viewer shows a
single-epoch state instead of pretending to compare. Elsewhere, no comparable pair exists, or
the archive is briefly unavailable, and the tool says so plainly and surfaces a clearly
labeled saved example rather than substituting unrelated frames. Coordinate search stays the
normal path throughout.

**Why it matters to the audience:** Trust is the product. The pitch differentiator is that
the tool reports `single_epoch`, `no_coverage`, `no_comparable_pair`, and
`upstream_unavailable` as honest outcomes, and logs an honest coverage result for each of the
five challenge targets. Judges reward a team that refuses to overclaim.

**Demo beat:** Trigger a missing-coverage state and a simulated archive failure; show the
status and the separately labeled saved example.

---

## 5. Lena checks a point against a known catalog

**Who:** Lena, who wants to know whether the dot she clicked is a catalogued star.

**Wants:** Context, not guesswork.

**Story:** Lena clicks a position and the inspector shows the nearby Gaia DR3 source: its
position, reference epoch, proper motion, parallax, and photometry, each with units, and null
where a measurement is unavailable. Because Gaia is referenced to 2016.0, if she projects the
catalog position onto the SPHEREx observation date the marker is clearly labeled a prediction,
kept separate from the observed image. She marks that point and can attach it to a finding.

**Why it matters to the audience:** This is how a casual click becomes informed evidence, and
it shows the team handled real astrometry correctly (epochs, units, predicted vs observed).
The same sky coordinates back both a findings pin and a selected image position, so marks and
discussion line up.

**Demo beat:** Click a point near a bright catalog star, open the inspector, show the labeled
prediction marker.

---

## 6. Where this could go: learning by exploring (exploratory, deferred)

**Who:** A newcomer or a classroom, not a researcher making claims.

**Wants:** A reason to keep clicking and a way to learn how the infrared sky behaves.

**Story (aspirational):** A visitor switches freely between the dated spectral view and a
time-lapse view of the same target, slides across infrared wavelengths and watches features
brighten and dim, and follows hints that make one object after another worth exploring. With
no artificial cooldown, they learn by trial and error how a patch of sky looks at different
wavelengths.

**Why it matters to the audience, and the caveat:** This frames the long-term vision as
engagement and education, a way to build intuition, not a scientific result. Present it as a
deferred, exploratory direction only. Per the brief, "rare" or "interesting" are teaching
cues, never discovery claims, and the motion view stays deliberately minimal because the real
time series is short (roughly two to three dated points per target). Do not promise this as
shipped, and do not name it as a product.

**Pitch beat:** One sentence of vision at the end: "and because it runs on real labeled data,
the same viewer becomes a teaching tool." Then stop.

For a fuller exploration of how this engagement layer could integrate with the social
findings platform (quests, verification credit, collections) and the user stories that go
with it, see `docs/engagement-social-integration.md`. It is exploratory and deferred.

---

## One-line throughline for the pitch

From a coordinate to a trustworthy, shareable comparison of real SPHEREx observations, with a
known-catalog check and honest coverage, so anyone can see what changed and let someone else
verify it.
