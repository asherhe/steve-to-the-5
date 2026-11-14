// Public surface of the source inspector slice (task 3).
export { SourceInspector } from "./SourceInspector";
export type { SourceInspectorProps } from "./SourceInspector";
export { createCatalogClient, CatalogApiError } from "./api";
export type { CatalogClient, CatalogClientOptions } from "./api";
export { propagate, isoToDecimalYear } from "./propagate";
export * from "./types";
import "./SourceInspector.css";
