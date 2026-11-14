import { describe, expect, it } from "vitest";

import { fmtDecDms, fmtRaHms, fmtWithUnit } from "../format";

describe("format", () => {
  it("renders null measurements as a placeholder", () => {
    expect(fmtWithUnit(null, "mas", 3)).toBe("—");
    expect(fmtWithUnit(undefined, "mas", 3)).toBe("—");
  });

  it("includes units and uncertainties", () => {
    expect(fmtWithUnit(546.976, "mas", 3)).toBe("546.976 mas");
    expect(fmtWithUnit(546.976, "mas", 3, 0.04)).toBe("546.976 ± 0.040 mas");
  });

  it("formats RA as HMS", () => {
    // 269.45207 deg -> ~17h57m48.5s
    const s = fmtRaHms(269.45207);
    expect(s).toMatch(/^17h57m/);
  });

  it("formats Dec as DMS with sign", () => {
    expect(fmtDecDms(4.66829)).toMatch(/^\+04/);
    expect(fmtDecDms(-7.24515)).toMatch(/^-07/);
  });
});
