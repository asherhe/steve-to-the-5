import { describe, expect, it } from "vitest";

import {
  brightness, colour, distance, distanceText, motion, motionText, shortId, sig3, sourceAsText,
} from "../describe";
import { ambiguousSources, knownDetail, knownSource } from "../fixtures";

describe("brightness", () => {
  it("uses the documented G magnitude boundaries", () => {
    expect([5.99, 6, 9.99, 10, 13.99, 14, 17.99, 18].map((g) => brightness(g)?.word)).toEqual([
      "Very bright", "Bright", "Bright", "Moderate", "Moderate", "Faint", "Faint", "Very faint",
    ]);
  });
  it("returns null without a measurement", () => {
    expect(brightness(null)).toBeNull();
    expect(brightness(undefined)).toBeNull();
    expect(brightness(NaN)).toBeNull();
  });
});

describe("colour", () => {
  it("uses the documented BP-RP boundaries", () => {
    expect([0.49, 0.5, 0.99, 1.0, 1.59, 1.6].map((c) => colour(c, 0)?.word)).toEqual([
      "Blue-white", "Yellow-white", "Yellow-white", "Orange", "Orange", "Red",
    ]);
  });
  it("needs both bands", () => {
    expect(colour(9.9, null)).toBeNull();
    expect(colour(undefined, 7)).toBeNull();
    expect(colour(knownDetail.bpMag, knownDetail.rpMag)?.bpRp).toBeCloseTo(3.014, 3);
  });
});

describe("distance", () => {
  it("converts a well-measured parallax", () => {
    const d = distance(546.976, 0.04);
    expect(d.kind).toBe("measured");
    expect(distanceText(d)).toBe("5.96 light-years (1.83 pc)");
  });
  it("requires parallax over error of at least five", () => {
    expect(distance(5, 1).kind).toBe("measured");
    expect(distance(4.9, 1).kind).toBe("uncertain");
  });
  it("refuses negative, zero and missing parallaxes", () => {
    for (const p of [-1, 0, null, undefined, NaN]) expect(distance(p, 0.1).kind).toBe("uncertain");
    expect(distanceText(distance(null))).toBe("Distance too uncertain to state");
  });
  it("is only approximate without an uncertainty, and only for nearby sources", () => {
    expect(distance(2, null).kind).toBe("approximate");
    expect(distance(1.99, null).kind).toBe("uncertain");
    expect(distanceText(distance(546.976))).toMatch(/^About 5\.96 light-years .*uncertainty not available$/);
  });
});

describe("motion", () => {
  it("names the eight compass directions, measured from north through east", () => {
    const pairs: [number, number][] = [[0, 100], [100, 100], [100, 0], [100, -100], [0, -100], [-100, -100], [-100, 0], [-100, 100]];
    expect(pairs.map(([ra, dec]) => {
      const m = motion(ra, dec);
      return m && m.kind !== "insignificant" ? m.compass : null;
    })).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
  });
  it("classifies by total rate", () => {
    expect(motion(49, 0)?.kind).toBe("slow");
    expect(motion(50, 0)?.kind).toBe("moving");
    expect(motion(499, 0)?.kind).toBe("moving");
    expect(motion(500, 0)?.kind).toBe("fast");
  });
  it("describes Barnard's Star", () => {
    const m = motion(knownSource.pmRaCosDecMasYr, knownSource.pmDecMasYr, 0.031, 0.042);
    expect(m).toMatchObject({ kind: "fast", compass: "N" });
    expect(motionText(m!)).toBe("10.4″ per year, heading N");
    expect(m && m.kind !== "insignificant" && m.pixelsPerDecade).toBeCloseTo(16.76, 1);
  });
  it("reports no significant motion below three sigma", () => {
    expect(motion(2, 1, 1, 1)).toEqual({ kind: "insignificant" });
    expect(motion(0, 0)).toEqual({ kind: "insignificant" });
    expect(motion(3.1, 0, 1, 1)?.kind).toBe("slow");
    expect(motionText({ kind: "insignificant" })).toBe("No significant motion measured");
  });
  it("returns null when a component is missing", () => {
    expect(motion(null, 5)).toBeNull();
    expect(motion(5, undefined)).toBeNull();
  });
});

describe("identifiers and export", () => {
  it("shortens long IDs", () => {
    expect(shortId("4472832130942575872")).toBe("…2575872");
    expect(shortId("12345")).toBe("12345");
  });
  it("keeps three significant figures", () => {
    expect([5.9629, 10.39, 1234.5, 0.2104].map(sig3)).toEqual(["5.96", "10.4", "1230", "0.210"]);
  });
  it("exports every value as text and labels predictions", () => {
    const text = sourceAsText(knownSource, knownDetail, { ra: 269.4, dec: 4.7, fromEpoch: 2016, toEpoch: 2026.2, predicted: true });
    expect(text).toContain("Gaia DR3 source 4472832130942575872");
    expect(text).toContain("Parallax: 546.976 ± 0.040 mas");
    expect(text).toContain("Radial velocity: -110.35 ± 0.12 km/s");
    expect(text).toContain("Predicted position (not an observation)");
    expect(text).toContain(knownDetail.provenance.sourceDetailUrl);
  });
  it("says not measured instead of a dash", () => {
    const text = sourceAsText(ambiguousSources[2], null, null);
    expect(text).toContain("Parallax: not measured");
    expect(text).not.toContain("—");
    expect(text).not.toContain("Predicted");
  });
});
