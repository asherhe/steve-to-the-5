import type { ResolveResult } from "../inspector/types";
import type { components } from "./archive.generated";

export interface SkyPosition {
  ra: number;
  dec: number;
}
export interface Field extends SkyPosition {
  fovArcmin: number;
}

export interface ComparisonFrame {
  id: string;
  observedAtUtc: string;
  wavelengthUm: number;
  release: string;
  imageUrl: string;
  sourceUrl: string | null;
  qualityFlags: Readonly<Record<string, number>>;
  alignment?: string;
  validFraction?: number;
  observationStartUtc?: string;
  observationEndUtc?: string;
}

export interface Comparison {
  id: string;
  field: Field;
  wavelengthRangeUm: readonly [number, number];
  stretch: { min: number; max: number; unit: string };
  grid: Pick<components["schemas"]["Grid"], "width" | "height" | "projection"> &
    Partial<components["schemas"]["Grid"]>;
  frames: readonly ComparisonFrame[];
  provenance?: Record<string, unknown>;
  coverage?: Record<string, unknown> | null;
  limitations?: readonly string[];
  diagnostics?: Record<string, unknown>;
}

export type ComparisonResult = (
  | { status: "ready" | "single_epoch"; comparison: Comparison }
  | {
      status: "no_coverage" | "no_comparable_pair" | "upstream_unavailable";
      comparison: null;
    }
) & { diagnostics?: Record<string, unknown>; servedFrom?: "archive" | "saved-cache" | "saved-example" };

export interface ComparisonSearchOptions {
  mode?: "blink" | "timeline";
  refresh?: boolean;
}

/** Progress of a running build, as its service reports it. For display only. */
export type BuildProgress = Pick<components["schemas"]["BuildProgressResponse"],
  "stage" | "done" | "total" | "fraction">;

export interface ViewerDataSource {
  /** `onProgress` is called only by services that report build progress. */
  search(field: Field, signal?: AbortSignal, onProgress?: (progress: BuildProgress) => void,
         options?: ComparisonSearchOptions): Promise<ComparisonResult>;
  loadSaved(id: string, signal?: AbortSignal): Promise<Comparison | null>;
  resolveName(
    name: string,
    signal?: AbortSignal,
  ): Promise<ResolveResult | null>;
}
