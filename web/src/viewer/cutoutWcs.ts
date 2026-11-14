import type { Comparison, SkyPosition } from "./comparison";

export interface ImagePoint {
  x: number;
  y: number;
}

const radians = Math.PI / 180;
const wrapRa = (degrees: number) => ((degrees % 360) + 360) % 360;

export function cutoutWcs(grid: Comparison["grid"]) {
  const header = grid.fitsHeader;
  // The archive emits north-up, distortion-free ICRS TAN with a diagonal scale.
  if (!header || grid.coordinateFrame !== "ICRS" || grid.rowOrigin !== "top" ||
      header.CTYPE1 !== "RA---TAN" || header.CTYPE2 !== "DEC--TAN" ||
      header.CUNIT1 !== "deg" || header.CUNIT2 !== "deg" ||
      (header.LONPOLE ?? (header.CRVAL2 === 90 ? 0 : 180)) !== (header.CRVAL2 === 90 ? 0 : 180) ||
      Object.keys(header).some((key) => /^(CD|PC|PV)\d|^CROTA/.test(key))) return null;

  const { CRPIX1: refX, CRPIX2: refY, CRVAL1: refRa, CRVAL2: refDec, CDELT1: dx, CDELT2: dy } = header;
  if (typeof refX !== "number" || typeof refY !== "number" ||
      typeof refRa !== "number" || typeof refDec !== "number" ||
      typeof dx !== "number" || typeof dy !== "number" ||
      ![refX, refY, refRa, refDec, dx, dy].every(Number.isFinite) ||
      Math.abs(refDec) > 90 || dx === 0 || dy === 0) return null;

  const sinDec = Math.sin(refDec * radians);
  const cosDec = Math.cos(refDec * radians);
  // At the north pole the archive header uses LONPOLE=0, a half-turn of the TAN plane.
  const poleSign = refDec === 90 ? -1 : 1;
  return {
    toSky({ x, y }: ImagePoint): SkyPosition {
      // FITS uses one-based centers and counts rows from the bottom.
      const xi = (x + 1 - refX) * dx * radians * poleSign;
      const eta = (grid.height - y - refY) * dy * radians * poleSign;
      const meridian = cosDec - eta * sinDec;
      return {
        ra: wrapRa(refRa + Math.atan2(xi, meridian) / radians),
        dec: Math.atan2(sinDec + eta * cosDec, Math.hypot(meridian, xi)) / radians,
      };
    },
    toImage({ ra, dec }: SkyPosition): ImagePoint | null {
      const offset = (ra - refRa) * radians;
      const sinTarget = Math.sin(dec * radians);
      const cosTarget = Math.cos(dec * radians);
      const cosOffset = Math.cos(offset);
      const denominator = sinDec * sinTarget + cosDec * cosTarget * cosOffset;
      if (denominator <= 0) return null;
      const xi = cosTarget * Math.sin(offset) / denominator;
      const eta = (cosDec * sinTarget - sinDec * cosTarget * cosOffset) / denominator;
      return { x: poleSign * xi / (dx * radians) + refX - 1,
        y: grid.height - refY - poleSign * eta / (dy * radians) };
    },
  };
}
