// Client-side proper-motion propagation, matching services/catalogs/app/astrometry/propagate.py.
// The result is a PREDICTED position and is always labelled predicted by callers.
// Perspective (parallax / radial-velocity) terms are omitted for the MVP marker.

import type { CatalogAstrometry, PredictedPosition } from "./types";

const MAS_PER_DEG = 3_600_000;

/** Convert a UTC ISO-8601 timestamp to a decimal year (e.g. 2025.37). */
export function isoToDecimalYear(isoUtc: string): number {
  const d = new Date(isoUtc);
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const frac = (d.getTime() - start) / (end - start);
  return year + frac;
}

export function predictAtObservation(source: CatalogAstrometry, observedAtUtc: string): PredictedPosition | null {
  const epoch = isoToDecimalYear(observedAtUtc);
  if (!Number.isFinite(epoch)) return null;
  return propagate(source.ra, source.dec, source.refEpoch, epoch, source.pmRaCosDecMasYr, source.pmDecMasYr);
}

export function propagate(
  raDeg: number,
  decDeg: number,
  refEpoch: number,
  toEpoch: number,
  pmRaCosDecMasYr: number | null,
  pmDecMasYr: number | null
): PredictedPosition {
  const dtYr = toEpoch - refEpoch;
  const pmRa = pmRaCosDecMasYr ?? 0;
  const pmDec = pmDecMasYr ?? 0;

  const cosDec = Math.cos((decDeg * Math.PI) / 180);
  const dRaDeg = Math.abs(cosDec) < 1e-12 ? 0 : ((pmRa / cosDec) * dtYr) / MAS_PER_DEG;
  const dDecDeg = (pmDec * dtYr) / MAS_PER_DEG;

  const ra = ((raDeg + dRaDeg) % 360 + 360) % 360;
  const dec = Math.max(-90, Math.min(90, decDeg + dDecDeg));
  return { ra, dec, fromEpoch: refEpoch, toEpoch, predicted: true };
}
