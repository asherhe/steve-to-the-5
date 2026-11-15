// Shared catalog client, contract types and proper-motion helpers. The source inspector
// panel that once lived here was removed; the viewer's point check uses these directly.
export { createCatalogClient, CatalogApiError } from "./api";
export type { CatalogClient, CatalogClientOptions, CatalogReview } from "./api";
export { angularSeparationArcsec, propagate, isoToDecimalYear, predictAtObservation } from "./propagate";
export * from "./types";
