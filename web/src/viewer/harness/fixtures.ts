import type { Comparison, ComparisonResult, ViewerDataSource } from "../comparison";
import firstImage from "./epoch-one.png";
import secondImage from "./epoch-two.png";

const frames: Comparison["frames"] = [
  {
    id: "fixture-epoch-one",
    observedAtUtc: "2025-06-15T04:20:00Z",
    wavelengthUm: 2.2,
    release: "Synthetic",
    imageUrl: firstImage,
    sourceUrl: null,
    qualityFlags: [],
  },
  {
    id: "fixture-epoch-two",
    observedAtUtc: "2025-12-15T03:10:00Z",
    wavelengthUm: 2.2,
    release: "Synthetic",
    imageUrl: secondImage,
    sourceUrl: null,
    qualityFlags: [],
  },
];

const pair: Comparison = {
  id: "fixture-matched-pair",
  field: { ra: 120, dec: 15, fovArcmin: 8 },
  wavelengthRangeUm: [2.19, 2.21],
  stretch: { min: 0, max: 255, unit: "synthetic intensity" },
  grid: { width: 320, height: 240, projection: "TAN" },
  frames,
};

const single: Comparison = {
  ...pair,
  id: "fixture-single-epoch",
  frames: frames.slice(0, 1),
};

const responses = {
  ready: { status: "ready", comparison: pair },
  single_epoch: { status: "single_epoch", comparison: single },
  no_coverage: { status: "no_coverage", comparison: null },
  no_comparable_pair: { status: "no_comparable_pair", comparison: null },
  upstream_unavailable: { status: "upstream_unavailable", comparison: null },
} as const satisfies Record<ComparisonResult["status"], ComparisonResult>;

export type Scenario = keyof typeof responses;
export const fixtureField = pair.field;
export const savedFixtureId = pair.id;

function wait(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 300);

    function abort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function fixtureDataSource(scenario: Scenario): ViewerDataSource {
  return {
    async search(_field, signal) {
      await wait(signal);
      return responses[scenario];
    },
    async loadSaved(id, signal) {
      await wait(signal);
      return [pair, single].find((comparison) => comparison.id === id) ?? null;
    },
    async resolveName(name, signal) {
      await wait(signal);
      return name.trim().toLowerCase() === "fixture field"
        ? { name: "Fixture field", ra: pair.field.ra, dec: pair.field.dec }
        : null;
    },
  };
}
