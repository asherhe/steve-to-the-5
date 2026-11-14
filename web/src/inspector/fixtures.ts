// Importable fixtures for the four inspector states, used by the harness and tests.
// Values mirror services/catalogs/fixtures/catalogs. Synthetic, not a dated live query.

import type { GaiaDetail, InspectorState, NearbySource } from "./types";

export const knownSource: NearbySource = {
  sourceId: "4472832130942575872",
  ra: 269.45207,
  dec: 4.66829,
  refEpoch: 2016.0,
  pmRaCosDecMasYr: -802.803,
  pmDecMasYr: 10362.542,
  parallaxMas: 546.976,
  gMag: 8.194,
  separationArcsec: 0.42,
};

export const knownDetail: GaiaDetail = {
  sourceId: "4472832130942575872",
  ra: 269.45207,
  dec: 4.66829,
  refEpoch: 2016.0,
  pmRaCosDecMasYr: -802.803,
  pmDecMasYr: 10362.542,
  parallaxMas: 546.976,
  gMag: 8.194,
  raErrorMas: 0.027,
  decErrorMas: 0.034,
  pmRaCosDecErrorMasYr: 0.031,
  pmDecErrorMasYr: 0.042,
  parallaxErrorMas: 0.04,
  radialVelocityKmS: -110.353,
  radialVelocityErrorKmS: 0.123,
  bpMag: 9.978,
  rpMag: 6.964,
  provenance: {
    catalog: "gaiadr3.gaia_source",
    dataRelease: "Gaia DR3",
    sourceTableUrl: "https://gea.esac.esa.int/archive/",
    sourceDetailUrl: "https://gea.esac.esa.int/archive/?source_id=4472832130942575872",
  },
};

export const ambiguousSources: NearbySource[] = [
  {
    sourceId: "5726817071037876736",
    ra: 133.7953,
    dec: -7.24498,
    refEpoch: 2016.0,
    pmRaCosDecMasYr: -3.214,
    pmDecMasYr: 2.771,
    parallaxMas: 1.482,
    gMag: 18.431,
    separationArcsec: 1.11,
  },
  {
    sourceId: "5726817071037880448",
    ra: 133.79488,
    dec: -7.24552,
    refEpoch: 2016.0,
    pmRaCosDecMasYr: 1.902,
    pmDecMasYr: -0.556,
    parallaxMas: 0.733,
    gMag: 19.004,
    separationArcsec: 1.63,
  },
  {
    sourceId: "5726817066742913024",
    ra: 133.79561,
    dec: -7.2447,
    refEpoch: 2016.0,
    pmRaCosDecMasYr: -0.118,
    pmDecMasYr: 4.009,
    parallaxMas: null,
    gMag: 20.117,
    separationArcsec: 2.04,
  },
];

export const states = {
  idle: { kind: "idle" } as InspectorState,
  loading: { kind: "loading" } as InspectorState,
  matched: { kind: "matched", source: knownSource, detail: knownDetail } as InspectorState,
  ambiguous: { kind: "ambiguous", sources: ambiguousSources } as InspectorState,
  unmatched: { kind: "unmatched", sources: [] } as InspectorState,
  unavailable: {
    kind: "unavailable",
    error: { code: "upstream_unavailable", message: "Gaia catalog service is unavailable." },
  } as InspectorState,
};

/** A fixture-backed CatalogClient for the harness, with no network. */
export function makeFixtureClient() {
  return {
    async nearby(ra: number, _dec: number, _radius: number) {
      if (ra > 359) throw new Error("simulated upstream failure");
      if (Math.abs(ra - knownSource.ra) < 0.01) return { sources: [knownSource] };
      if (Math.abs(ra - ambiguousSources[0].ra) < 0.5) return { sources: ambiguousSources };
      return { sources: [] };
    },
    async detail(sourceId: string) {
      if (sourceId === knownDetail.sourceId) return knownDetail;
      throw new Error("not found");
    },
    async resolve(name: string) {
      return { name, ra: knownSource.ra, dec: knownSource.dec };
    },
  };
}
