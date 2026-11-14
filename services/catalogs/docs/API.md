# Catalog service API reference

JSON is camelCase. Coordinates are ICRS decimal degrees. Units are carried in field names.
Nullable measurements serialize as `null`. Errors use `{code, message}`.

## Units

| Suffix / field | Unit |
|---|---|
| `ra`, `dec` | degrees |
| `refEpoch` | Julian year (Gaia DR3 = 2016.0) |
| `pmRaCosDecMasYr`, `pmDecMasYr` | milliarcseconds per year (RA includes cos δ) |
| `parallaxMas` | milliarcseconds |
| `gMag`, `bpMag`, `rpMag` | magnitudes |
| `radialVelocityKmS` | kilometres per second |
| `separationArcsec` | arcseconds |
| `*ErrorMas`, `*ErrorMasYr`, `*ErrorKmS` | same unit as the measured quantity |

---

## GET /api/resolve

Resolve a target name to a position. Bundled presets resolve first, independent of any
external service.

Query: `name` (string, required).

200:

```json
{ "name": "Barnard's Star", "ra": 269.45207695833336, "dec": 4.693364966666667 }
```

Errors: `invalid_request` (empty name), `not_found` (unknown name, external lookup disabled),
`upstream_unavailable` (external resolver failed, live only).

---

## GET /api/catalogs/nearby

Bounded Gaia DR3 cone search. An empty `sources` list is a valid result and is distinct from
a service error.

Query: `ra` (0–360), `dec` (−90–90), `radiusArcsec` (> 0, ≤ 300).

200:

```json
{
  "sources": [
    {
      "sourceId": "4472832130942575872",
      "ra": 269.45207,
      "dec": 4.66829,
      "refEpoch": 2016.0,
      "pmRaCosDecMasYr": -802.803,
      "pmDecMasYr": 10362.542,
      "parallaxMas": 546.976,
      "gMag": 8.194,
      "separationArcsec": 0.42
    }
  ]
}
```

Empty: `{ "sources": [] }` (200).

Errors: `invalid_request` (out-of-range coordinate or radius), `upstream_unavailable` (503).

---

## GET /api/catalogs/gaia/{sourceId}

Full detail for one source. Optional measurements are `null` when unavailable.

Path: `sourceId` (string).

200:

```json
{
  "sourceId": "4472832130942575872",
  "ra": 269.45207,
  "dec": 4.66829,
  "refEpoch": 2016.0,
  "pmRaCosDecMasYr": -802.803,
  "pmDecMasYr": 10362.542,
  "parallaxMas": 546.976,
  "gMag": 8.194,
  "raErrorMas": 0.027,
  "decErrorMas": 0.034,
  "pmRaCosDecErrorMasYr": 0.031,
  "pmDecErrorMasYr": 0.042,
  "parallaxErrorMas": 0.04,
  "radialVelocityKmS": -110.353,
  "radialVelocityErrorKmS": 0.123,
  "bpMag": 9.978,
  "rpMag": 6.964,
  "provenance": {
    "catalog": "gaiadr3.gaia_source",
    "dataRelease": "Gaia DR3",
    "sourceTableUrl": "https://gea.esac.esa.int/archive/",
    "sourceDetailUrl": "https://gea.esac.esa.int/archive/?source_id=4472832130942575872"
  }
}
```

A faint source may return `null` for `parallaxMas`, `radialVelocityKmS`, `bpMag`, `rpMag`
and their errors while keeping required astrometry.

Errors: `not_found` (404, no such source), `upstream_unavailable` (503).

---

## Error body

```json
{ "code": "not_found", "message": "No Gaia source with id '0' in fixtures." }
```

`code` ∈ {`invalid_request`, `not_found`, `upstream_unavailable`, `internal_error`}.
