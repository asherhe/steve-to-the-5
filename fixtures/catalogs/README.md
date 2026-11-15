# Catalog contract fixtures

`openapi.json` is the exported catalog service schema. `resolved-targets.json` contains
model-validated responses from the reviewed bundled naming snapshot. `name-vectors.json`
is consumed by both Python and TypeScript normalization/identity tests.
`source-identities.json` represents component-only inspector enrichment using the existing
ObjectIdentity schema; it does not add target presets. `errors/incomplete-name.json`
records the new partial-query guidance. Dated live verification is in `verification/`.

The one curated source dataset remains `services/catalogs/fixtures/catalogs/presets.json`.
Despite its historical directory name, those names/field centers are curated references.
The nearby/detail fixtures in that directory remain synthetic and explicitly have no
verified identity enrichment. Real names are never attached to those fixture astrometry rows.

From the repository root:

```sh
services/catalogs/.venv/bin/python scripts/export-catalog-contract.py
npm run generate:catalog-types
```

Update service models, schema, representative responses, generated types and conformance
checks together. These catalog exports do not modify the archive schema or evidence IDs.
