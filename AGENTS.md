# SPHEREx repository instructions

## Project context and scope

Work from this repository root. Read `spherex-project-brief.md` and `spherex-agent-handoffs.md` before substantial implementation. They define the product scope, shared interfaces, ownership boundaries, and acceptance criteria. Explicit user instructions take precedence; surface material conflicts rather than silently changing the contract.

The core deliverable is a public coordinate-based viewer of real, dated SPHEREx observations. Prioritize matched monochrome playback, understandable metadata, and reproducible evidence. Keep RGB, spectra, difference images, WISE history, and NEOSSat work deferred unless authorized by the current task. A public finding is an observation or question, not a validated discovery.

## Shared implementation

- Follow the handoff's assigned paths. Route shared schema, generated types, root dependencies, app-shell, deployment, and cross-owner changes through the coordinator.
- Use the shared OpenAPI schema and representative fixtures as the interface source. Update them together when an authorized contract change is needed. Do not invent parallel API shapes in individual modules.
- Use isolated worktrees and component verification commands when carrying out the agreed parallel implementation. Do not launch other agents merely because the plan contains handoffs; follow the current task's delegation instructions.
- Preserve other contributors' changes. Follow the current task's authorization for commits, branches, merges, deployment, and external services; do not infer authorization to publish from an implementation assignment.
- Search for existing behavior before adding another implementation. Reuse or adapt small relevant pieces; do not import unrelated trading or camera-driver infrastructure.

## Scientific evidence

Read `.agents/skills/reproducible-comparison/SKILL.md` when implementing or changing archive selection, image preparation, comparison persistence/replay, or saved evidence migration. See `skills.md` for its scope.

- Dated spectral images supply playback. All-sky mosaic layers represent wavelength, not dates. Label reference surveys and saved examples separately from live comparison frames.
- Check wavelength compatibility, valid coverage, and image quality before presenting frames as comparable. A shared grid and stretch alone do not establish equivalent measurements. Do not infer compatibility from detector identity or the centre wavelength alone across a large field.
- Preserve actual observation times. Record contributing exposures and their time range for combined frames. Do not substitute processing or download timestamps for observation time.
- Keep catalog measurements, predicted positions, and image observations distinct. Use Gaia DR3 with its reference epoch and units; label propagated markers as predictions and unmatched points as unmatched.
- Define the treatment of background, flags, and uncertainties where they affect comparisons. Do not claim chemical identification, physical temperature, significant variability, or a discovery from false colour or visual changes alone.

## Development and verification

- Use a project-local Python environment and declared dependency files. Keep machine-specific paths configurable and use repository-relative paths in shared commands.
- Keep credentials out of source, fixtures, logs, and public responses. Supabase privileged credentials remain server-side; derive posting identity from authenticated sessions. Follow the handoff's public-read and ownership requirements.
- Distinguish synthetic fixtures, saved real observations, live archive checks, and deployed checks. Report only checks actually run and identify unavailable services or unverified targets explicitly.
- Verify relevant behavior: compatible framing and timestamps, immutable replay, missing coverage, archive failure, anonymous read/write boundaries, and the five-target coverage log as applicable to the assigned slice.
- Do not present a fixture-backed component or cached demo as proof of live end-to-end behavior. Test cross-component integration and the deployed origin separately when they are in scope.
- Preserve upstream attribution and applicable data-release acknowledgements. Shared planning and handoff files belong in this repository; do not inherit other projects' blanket exclusions for agent documentation.
