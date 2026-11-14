// Types for the source inspector (task 3).
//
// These mirror the catalog service contract (camelCase, units in field names, nullable
// measurements as null). They are a LOCAL mirror until the coordinator publishes shared
// generated types; swap to the generated types at integration and reconcile any difference.

/** A sky position in ICRS decimal degrees. A findings pin and a selected image position
 *  use these same coordinates. */
export interface SkyPosition {
  ra: number;
  dec: number;
}

/** Metadata about the frame currently shown in the comparison view, if any. Used to
 *  propagate a catalog position to the frame's observation epoch for a predicted marker. */
export interface SelectedFrameMeta {
  frameId: string;
  observedAtUtc: string; // UTC ISO 8601
  wavelengthUm?: number | null;
}

/** One row from GET /api/catalogs/nearby. */
export interface NearbySource {
  sourceId: string;
  ra: number;
  dec: number;
  refEpoch: number;
  pmRaCosDecMasYr: number | null;
  pmDecMasYr: number | null;
  parallaxMas: number | null;
  gMag: number | null;
  separationArcsec: number;
}

export interface NearbyResponse {
  sources: NearbySource[];
}

export interface SourceProvenance {
  catalog: string;
  dataRelease: string;
  sourceTableUrl?: string | null;
  sourceDetailUrl?: string | null;
}

/** GET /api/catalogs/gaia/{sourceId}. Optional measurements may be null. */
export interface GaiaDetail {
  sourceId: string;
  ra: number;
  dec: number;
  refEpoch: number;
  pmRaCosDecMasYr: number | null;
  pmDecMasYr: number | null;
  parallaxMas: number | null;
  gMag: number | null;
  raErrorMas: number | null;
  decErrorMas: number | null;
  pmRaCosDecErrorMasYr: number | null;
  pmDecErrorMasYr: number | null;
  parallaxErrorMas: number | null;
  radialVelocityKmS: number | null;
  radialVelocityErrorKmS: number | null;
  bpMag: number | null;
  rpMag: number | null;
  provenance: SourceProvenance;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

/** A predicted position after epoch propagation. Always labelled predicted; never replaces
 *  the observed catalog position. */
export interface PredictedPosition {
  ra: number;
  dec: number;
  fromEpoch: number;
  toEpoch: number;
  predicted: true;
}

/** Payload emitted by the inspector's mark action. The frameId ties the mark to the frame
 *  in the active comparison; ra/dec are the sky coordinates to mark (predicted position
 *  when a frame is selected, otherwise the observed catalog position). */
export interface MarkAction {
  frameId: string | null;
  ra: number;
  dec: number;
  sourceId: string;
  predicted: boolean;
}

/** The inspector's view state, independent of how data is fetched. */
export type InspectorState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable"; error: ApiErrorBody }
  | { kind: "unmatched"; sources: [] }
  | { kind: "ambiguous"; sources: NearbySource[] }
  | { kind: "matched"; source: NearbySource; detail: GaiaDetail | null };
