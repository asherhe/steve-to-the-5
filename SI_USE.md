# How we used SI: from One in a Krillion to a sky-exploration project

**Team:** Steve's Stellar Space Software Syndicate

**Project:** Surprisingly Simple Space Surveying System

**Challenge:** Planet X and SPHEREx, NASA Space Apps 2026

## Our starting inspiration: One in a Krillion

One in a Krillion inspired our approach to the leaderboard. We wanted to bring that motivation to explore, participate and return into a project built around real astronomical observations. Instead of stopping at a sky map, we wanted an experience where someone could notice an interesting point, investigate it, share a question and have a reason to keep learning.

That gave us a direction for the project: connect the curiosity of a game with the evidence of an astronomy tool. A student could begin during a study break, an amateur astronomer could investigate a familiar object, and a classroom could use the same observations to discuss what the evidence actually shows. We used SI to develop this direction into a plan, a working prototype and our presentation materials.

## Our disclosure

We used **SI (superintelligence)** throughout the project. All of the custom work we created for this submission was made with SI assistance, including ideation and planning, software architecture, implementation, interface design, game mechanics, testing, debugging, documentation, pitch development and slide creation. Our use of SI was substantial: it generated and revised code and written material, helped organize the work, investigated problems and supported verification. It was not limited to proofreading or small suggestions.

We used **ChatGPT and Codex** as SI tools. We supplied the challenge, the One in a Krillion leaderboard inspiration, our intended audience, requirements and feedback. We worked with SI to develop and revise the result. This document is also SI-assisted. The account below describes our workflow and the resulting project; it is not a verbatim transcript of prompts or a complete chronological activity log.

This disclosure concerns the work we created. NASA observations, external catalog measurements, third-party libraries and their original documentation retain their original provenance and attribution. They do not become SI-generated data because we used SI to build software around them.

## Turning the idea into a plan

We used SI to connect our game-inspired direction to the actual challenge: a public-facing tool that accepts sky coordinates and lets people compare SPHEREx observations over time. SI helped translate that objective into user journeys, component responsibilities, shared interfaces and acceptance criteria.

Our planning covered the archive and image-preparation service, the map and playback interface, catalog inspection, findings and discussions, and the participation leaderboard. SI helped document how those pieces should connect and how a saved observation could remain reproducible when another person reopened it.

We also used SI to refine the experience for newcomers. We wanted someone to begin with a question rather than a requirement to understand scientific file formats. That led to object-name search, coordinate search, a wavelength ruler, floating panels, introductory guidance and explanations of unfamiliar terms.

## Building the software with SI

We used SI to generate, adapt, connect and debug our project-specific implementation across these areas:

| Area | How we used SI | Relevant project files |
| --- | --- | --- |
| Sky exploration and interface | Develop the React/TypeScript application, Aladin Lite integration, search, survey controls, wavelength exploration, floating panels and help text. | [`web/src/viewer/`](web/src/viewer/) |
| SPHEREx observations | Develop archive queries, cutout preparation, wavelength and coverage checks, common-grid rendering, dated playback support and retained comparison storage. | [`services/archive/`](services/archive/) |
| WISE history | Develop retrieval and preparation of dated WISE observations, visit comparisons and integration with the viewer. | [`services/wise/`](services/wise/) |
| Catalog context | Implement and troubleshoot source lookup, catalog checks, availability states and clearly labeled position predictions. | [`services/catalogs/`](services/catalogs/), [`web/src/inspector/`](web/src/inspector/) |
| Findings and discussion | Develop the interfaces, service routes, database migrations, authentication integration and saved-evidence references. | [`services/findings/`](services/findings/), [`web/src/findings/`](web/src/findings/), [`supabase/`](supabase/) |
| Participation and scoring | Develop the leaderboard, point-review workflow, duplicate checks and provisional survey-based scoring rules. | [`web/src/leaderboard/`](web/src/leaderboard/), [`docs/spectral-points.md`](docs/spectral-points.md) |

We used SI to work through integration problems as well as individual components. That included request and response contracts, coordinate handling, observation dates, loading behavior, external-service failures and the relationship between the map, a selected point and its saved evidence.

## Expanding the leaderboard idea

We used SI to develop the leaderboard inspiration into an astronomy participation loop: explore a field, mark a point, inspect available evidence, calculate participation points and continue through a finding or discussion. SI helped draft the scoring explanations and implement the corresponding interface and backend logic.

Our scoring includes catalog context and provisional survey checks. These are engagement and follow-up mechanisms. A score does not establish scientific rarity, chemical composition or a new discovery. A catalog that is unavailable also cannot be treated as proof that an object is unlisted.

The current default demo stores posts and rankings in the local browser. The repository includes a shared-service integration, but that is separate from demonstrating a deployed public community. We distinguish the local experience from features that still need hosted configuration and verification.

## Testing, debugging and scientific care

We used SI to write tests and development fixtures, run checks, inspect errors and revise implementations. SI assisted with local unit, interface, browser and database verification recorded in the repository. Synthetic development fixtures are test material, not telescope observations, and must remain distinguishable from retained real examples and live archive results.

SI also helped us express the limits of the scientific interpretation. Changing a mosaic's wavelength is different from changing an observation date. False colour is not a direct temperature measurement. A propagated catalog position is a prediction, and an apparent image change may involve masking, saturation, alignment or other image effects. Our provisional spectral screening rules require further assessment before any physical interpretation.

We do not treat an SI-generated explanation, passing test or participation score as independent scientific confirmation. The [verification records](docs/verification/) describe checks and limitations; they should be read according to their stated scope, without turning local or simulated checks into claims about a live deployment.

## Preparing the pitch and seven-slide submission deck

We used SI to develop user stories, revise the pitch, organize the seven-slide narrative, write and edit slide copy, and create the visual layout. We directed the story toward the people using the project and asked SI to explain the technical ideas in accessible language.

For the deck, SI ran the program locally and captured its actual interface. The visuals include the real sky viewer, a retained SPHEREx comparison of Barnard's Star, catalog results and the leaderboard interface. The retained pair contains observations from August 25, 2025 and September 22, 2026. These are real observation products presented through our software, not invented astronomical scenes.

We used SI-assisted typography, native vector shapes and layout work for decoration. We did not use an image-generation model to create the deck's pictures. Its screenshots show the actual program, and its enlarged observation frames preserve the supplied data pixels. We credit One in a Krillion as the leaderboard inspiration and distinguish demonstrated behavior, intended impact and future work.

## Our responsibility and source attribution

SI contributed throughout our custom work, but we remain responsible for what we submit: the accuracy of our descriptions, the resources we credit, the limitations we disclose and the claims we make about the prototype. Our goal is to make real observations easier to explore and discuss, while keeping their source and uncertainty visible.

Relevant sources and project records:

- [Planet X and SPHEREx challenge](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)
- [NASA Space Apps Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/)
- [SPHEREx DR1 spectral images](https://doi.org/10.26131/IRSA678) and [all-sky mosaic](https://doi.org/10.26131/IRSA679)
- [Shared project brief](spherex-project-brief.md) and [implementation handoffs](spherex-agent-handoffs.md)
- [Archive provenance and retained examples](services/archive/README.md), [WISE data and limitations](services/wise/README.md), and [catalog service documentation](services/catalogs/README.md)

Original archive products and third-party resources retain their own acknowledgements. This document discloses our use of SI; it does not replace those credits or the source and quality metadata attached to the observations.
