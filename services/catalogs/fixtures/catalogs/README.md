# Catalog fixtures

Synthetic, offline fixtures for the catalog service. They approximate real Gaia DR3 objects
but are **not** dated live queries. The service labels its mode (`offline-fixtures` vs
`live-gaia-tap`) in `/api/health` and in the coverage log.

| File | Represents | Salient values |
|---|---|---|
| `presets.json` | 5 challenge targets + aliases for `/api/resolve` | WISE 0855 uses the challenge-supplied position |
| `nearby_known.json` | single clean match (Barnard's Star analogue) | large proper motion, parallax ≈ 547 mas |
| `nearby_ambiguous.json` | several close sources (WISE 0855 field) | three sources within ~2″ |
| `nearby_unmatched.json` | valid empty result | `sources: []` |
| `detail_known.json` | full detail with uncertainties, RV, BP/RP | matches `nearby_known` source id |
| `detail_partial.json` | faint source, several fields unavailable | `parallaxMas`, `radialVelocityKmS`, `bpMag`, `rpMag` null |
| `unavailable.json` | the `{code, message}` error shape for a backend failure | `upstream_unavailable` |

Keys beginning with `_` (`_note`, `_scenario`, `_description`) are documentation-only and are
stripped before the service validates a fixture against the response models.

## Regeneration

These are hand-maintained. To replace a fixture with a real Gaia response, run a live query
(`CATALOGS_LIVE=1`), capture the JSON for the chosen source, add a `_description` recording
the query date, and keep it labelled as a saved real example rather than synthetic. The
contract test (`tests/test_contract_fixtures.py`) enforces that any fixture still validates
against the models and uses only documented fields.

The fixture provider selects a `nearby_*` scenario by nearest anchor region
(`app/gaia/fixture_provider.py`) so a given coordinate maps deterministically to one state.
