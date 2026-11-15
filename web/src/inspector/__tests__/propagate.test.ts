import { describe, expect, it } from "vitest";

import { isoToDecimalYear, predictAtObservation, propagate } from "../propagate";

// Shared test vector, identical to services/catalogs/tests/test_propagate.py.
describe("propagate", () => {
  it("matches the known vector", () => {
    const p = propagate(10, 20, 2016.0, 2026.0, 3600, -3600);
    const expectedDRa = ((3600 / Math.cos((20 * Math.PI) / 180)) * 10) / 3.6e6;
    expect(p.ra).toBeCloseTo(10 + expectedDRa, 9);
    expect(p.dec).toBeCloseTo(19.99, 9);
    expect(p.predicted).toBe(true);
    expect(p.fromEpoch).toBe(2016.0);
    expect(p.toEpoch).toBe(2026.0);
  });

  it("is identity with zero proper motion", () => {
    const p = propagate(42, -13, 2016.0, 2025.5, null, null);
    expect(p.ra).toBe(42);
    expect(p.dec).toBe(-13);
  });

  it("moves north for positive pmDec", () => {
    const p = propagate(0, 0, 2016.0, 2017.0, 0, 3.6e6);
    expect(p.dec).toBeGreaterThan(0);
  });

  it("converts ISO to decimal year", () => {
    expect(isoToDecimalYear("2016-01-01T00:00:00Z")).toBeCloseTo(2016.0, 6);
    const mid = isoToDecimalYear("2025-07-02T12:00:00Z");
    expect(mid).toBeGreaterThan(2025.4);
    expect(mid).toBeLessThan(2025.6);
  });

  it("cannot predict a position for an invalid observation time", () => {
    const source = {
      sourceId: "123", ra: 10, dec: 20, refEpoch: 2016,
      pmRaCosDecMasYr: 0, pmDecMasYr: 3600,
    };
    expect(predictAtObservation(source, "invalid time")).toBeNull();
  });
});
