import type { components } from "./catalog.generated";
// Types for the source inspector (task 3).
//
// Catalog response shapes come from the generated shared OpenAPI contract.

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

/** Shared catalog contract, generated from the FastAPI schema. Response models emit
 * nullable measurement keys even where OpenAPI permits omission. */
export type ObjectIdentity = components["schemas"]["ObjectIdentity"];
export type ResolveResult = components["schemas"]["ResolveResult"];
export type PositionProvenance = components["schemas"]["PositionProvenance"];
export type NearbySource = Required<Omit<components["schemas"]["NearbySource"], "identity">> &
  Pick<components["schemas"]["NearbySource"], "identity">;
export type NearbyResponse = { sources: NearbySource[] };
export type SourceProvenance = components["schemas"]["SourceProvenance"];
export type GaiaDetail = Required<Omit<components["schemas"]["GaiaDetail"], "identity">> &
  Pick<components["schemas"]["GaiaDetail"], "identity">;

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

export type CatalogAstrometry = Pick<NearbySource,
  "sourceId" | "ra" | "dec" | "refEpoch" | "pmRaCosDecMasYr" | "pmDecMasYr"
>;

/** Payload emitted by the inspector's mark action. The frameId ties the mark to the frame
 *  in the active comparison; ra/dec are the sky coordinates to mark (predicted position
 *  when a frame is selected, otherwise the observed catalog position). */
export interface MarkAction {
  frameId: string | null;
  ra: number;
  dec: number;
  sourceId: string;
  predicted: boolean;
  /** Original catalog astrometry; recompute predictions when playback changes. */
  astrometry: CatalogAstrometry;
  /** Display enrichment only; never serialized into saved evidence marks. */
  displayName?: string;
  refEpoch?: number;
}

/** The inspector's view state, independent of how data is fetched. */
export type InspectorState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable"; error: ApiErrorBody }
  | { kind: "unmatched"; sources: [] }
  | { kind: "ambiguous"; sources: NearbySource[] }
  | { kind: "matched"; source: NearbySource; detail: GaiaDetail | null };
