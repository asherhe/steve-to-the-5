---
name: reproducible-comparison
description: Preserve scientific provenance and exact replay when implementing or changing SPHEREx observation selection, image preparation, saved comparison identity, persistence, or evidence migration. Use for comparison-pipeline work, not ordinary UI styling or discussion features.
---

# Reproducible SPHEREx comparisons

Read the repository brief and handoff contract. Support the existing matched-monochrome MVP; do not expand the product into a new analysis pipeline. This skill defines evidence invariants, not a replacement API schema.

## Define the comparison before rendering

Make processing choices explicit in configuration and persist their resolved values: field and coordinate frame; output dimensions, projection and pixel-to-sky mapping; wavelength-selection rule and tolerances; coverage thresholds; quality-mask policy; exposure selection or grouping; background treatment; registration/resampling method; and numerical stretch parameters and units. Record relevant settings even when they select no correction or no combination. Keep defaults in one maintained source.

Distinguish two usable observations from two comparable observations. Check the wavelength response at the region being displayed, not only detector identity. A centre-wavelength approximation is acceptable for a bounded quick-look view only when its limitations and acceptance criteria are explicit. Missing overlap, insufficient valid coverage, and unavailable observations are reported states, not reasons to substitute unrelated frames.

Use source observation times. A combined frame records every contributing exposure, the observation interval, and the rule for its displayed timestamp. Long time bins can hide motion or variability; preserve that limitation. Avoid claiming scientifically significant changes from display consistency alone.

## Preserve provenance and stable identity

For each comparison retain:

- Original observation identifiers and URLs, release and processing versions, detector/channel information, and observation timestamps.
- A schema-versioned manifest of resolved selection and processing settings, excluded inputs and material quality limitations, and the resulting frames.
- Processing implementation version or source fingerprint and relevant runtime versions. A Git commit alone does not describe uncommitted processing changes.
- Content hashes for retained source cutouts and rendered assets, with a documented hash representation. Do not claim an input was hashed when only its URL was saved.

Derive the evidence identity from canonicalized scientific inputs, source content identities, and processing configuration/version. Exclude request timestamps, expiring URLs, and display-only discussion state from the identity. Serialize values with explicit units and reject non-finite numeric inputs. Changed scientific inputs or rendering settings produce a new comparison version; identical resolved inputs use the same evidence identity under the declared policy.

## Persist before sharing

Store the manifest and required assets durably before returning a shareable ready comparison. Use immutable asset references and conflict detection; do not silently overwrite different evidence under an existing ID. Partial results must not appear ready. Replaying an ID loads its stored manifest and assets rather than running current defaults against the latest archive.

Content hashes detect changes; they do not retain files. Preserve the assets needed for exact visual replay and the source cutouts needed for the promised reproduction level. Document any retention limits. Before migrating or removing evidence, establish content hashes and recoverability for affected artifacts, verify the migrated content, and preserve existing share-link behavior. Do not impose unrelated whole-repository manifests or mandatory commits for ordinary changes.

Annotations retain the saved comparison and frame IDs and sky coordinates specified by the shared contract. New comments or catalog refreshes do not mutate the original image evidence. Keep predicted catalog positions distinguishable from observed positions.

## Verify the relevant invariants

Use focused checks appropriate to the change:

- Reopening a saved ID restores the same assets, grid, dates, wavelength labels and stretch, including after defaults change.
- Changing an identity-bearing input creates distinct evidence; a conflicting overwrite or missing/corrupt asset is detected.
- Incompatible wavelengths, incomplete coverage, invalid crops, and upstream failure remain explicit outcomes.
- Registration is checked against suitable stationary background sources, without aligning away the target motion. Record residuals and the acceptance criterion when claiming verified alignment.
- Every required challenge target receives an honest coverage/inspection outcome; an unavailable target is not recorded as a successful demonstration.

Provide a repository-root command for reproducing a retained reference comparison when implementing that capability. Declare numerical tolerances for reprocessing across environments; exact saved-image replay and numerically equivalent reprocessing are different guarantees. Label synthetic fixtures, saved real examples, freshly fetched observations and deployed verification separately. Report what was executed and what remains unverified.
