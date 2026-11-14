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
  qualityFlags: readonly string[];
}

export interface Comparison {
  id: string;
  field: Field;
  wavelengthRangeUm: readonly [number, number];
  stretch: { min: number; max: number; unit: string };
  grid: { width: number; height: number; projection: string };
  frames: readonly ComparisonFrame[];
}

export type ComparisonResult =
  | { status: "ready" | "single_epoch"; comparison: Comparison }
  | {
      status: "no_coverage" | "no_comparable_pair" | "upstream_unavailable";
      comparison: null;
    };

export interface ViewerDataSource {
  search(field: Field, signal?: AbortSignal): Promise<ComparisonResult>;
  loadSaved(id: string, signal?: AbortSignal): Promise<Comparison | null>;
  resolveName(
    name: string,
    signal?: AbortSignal,
  ): Promise<(SkyPosition & { name: string }) | null>;
}
