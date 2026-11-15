// Pure summary of a catalog-chain check for a marked point (rendered by PointCheck.tsx).
import type { CatalogReview } from "../inspector/api.ts";
import { angularSeparationArcsec, predictAtObservation } from "../inspector/propagate.ts";
import type { SkyPosition } from "./comparison";

type CatalogCheck = CatalogReview["checks"][number];

const nameKeys = ["main_id", "name", "Name", "designation", "source_name", "AllWISE", "sourceId", "source_id"];
const positionKeys: [string, string][] = [["ra", "dec"], ["RAJ2000", "DEJ2000"], ["ra_j2000_formula", "dec_j2000_formula"]];

function numeric(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The closest returned row, by the catalog's own separation or its published position.
 *  Positions are as catalogued (not moved to an epoch), so this is a guide, not a match. */
export function nearestRow(check: CatalogCheck, point: SkyPosition): { name: string; arcsec: number } | null {
  let best: { name: string; arcsec: number } | null = null;
  for (const row of check.rows ?? []) {
    let arcsec = numeric(row.separationArcsec);
    if (arcsec === null) {
      for (const [raKey, decKey] of positionKeys) {
        const ra = numeric(row[raKey]), dec = numeric(row[decKey]);
        if (ra !== null && dec !== null) { arcsec = angularSeparationArcsec(point, { ra, dec }); break; }
      }
    }
    if (arcsec === null) continue;
    const key = nameKeys.find(k => typeof row[k] === "string" || typeof row[k] === "number");
    const raw = key ? String(row[key]).trim() : "unnamed record";
    const name = key && /^source_?id$/i.test(key) && /^\d+$/.test(raw) ? `Gaia DR3 ${raw}` : raw;
    if (!best || arcsec < best.arcsec) best = { name, arcsec };
  }
  return best;
}

export function summarize(review: CatalogReview): { tone: "listed" | "empty" | "incomplete" | "offline"; title: string; detail: string } {
  if (review.mode === "offline")
    return { tone: "offline", title: "Catalogs not searched", detail: "The catalog service is running offline, so no catalog was queried. Start it with CATALOGS_LIVE=1 to check real points." };
  const listed = review.checks.filter(c => c.status === "candidates" || c.status === "partial");
  const unchecked = review.checks.filter(c => c.status === "unavailable" || c.status === "skipped");
  if (listed.length)
    return {
      tone: "listed",
      title: `Listed in ${listed.length} of ${review.checks.length} catalogs`,
      detail: `${listed.map(c => c.catalog).join(", ")} ${listed.length === 1 ? "has a record" : "have records"} within ${review.radiusArcsec}″. This point is probably a known source, but a nearby record is not a confirmed match: check the separations and the image.`,
    };
  if (unchecked.length)
    return {
      tone: "incomplete",
      title: "Nothing listed so far, check incomplete",
      detail: `${unchecked.map(c => c.catalog).join(", ")} ${unchecked.length === 1 ? "was" : "were"} not checked. An incomplete check is not evidence that nothing is catalogued here.`,
    };
  return {
    tone: "empty",
    title: "No record in any of the six catalogs",
    detail: `Nothing within ${review.radiusArcsec}″. That makes this point worth a closer look, not a discovery: catalogs have depth and epoch limits, and image artifacts or moving objects can explain it.`,
  };
}

/** A Gaia DR3 row from the check, with its position at the time the map shows. */
export interface GaiaNeighbour {
  sourceId: string;
  ra: number;
  dec: number;
  refEpoch: number;
  pmRaCosDecMasYr: number | null;
  pmDecMasYr: number | null;
  gMag: number | null;
  /** Position moved to `predictionTimeUtc` by proper motion, or null without one. */
  predicted: SkyPosition | null;
  /** Separation from the marked point at that time (catalog epoch when not predicted). */
  separationArcsec: number;
}

/** Gaia rows nearest first. With a time, positions are propagated to it, as the inspector does;
 *  a row without proper motion cannot be moved and keeps its catalog position. */
export function gaiaNeighbours(review: CatalogReview, point: SkyPosition, predictionTimeUtc: string | null): GaiaNeighbour[] {
  const gaia = review.checks.find(c => c.catalog === "Gaia DR3");
  const result: GaiaNeighbour[] = [];
  for (const row of gaia?.rows ?? []) {
    const ra = numeric(row.ra), dec = numeric(row.dec), refEpoch = numeric(row.refEpoch);
    const sourceId = typeof row.sourceId === "string" ? row.sourceId : typeof row.sourceId === "number" ? String(row.sourceId) : null;
    if (ra === null || dec === null || refEpoch === null || !sourceId) continue;
    const source = { sourceId, ra, dec, refEpoch, pmRaCosDecMasYr: numeric(row.pmRaCosDecMasYr), pmDecMasYr: numeric(row.pmDecMasYr) };
    const moved = predictionTimeUtc ? predictAtObservation(source, predictionTimeUtc) : null;
    const predicted = moved ? { ra: moved.ra, dec: moved.dec } : null;
    result.push({ ...source, gMag: numeric(row.gMag), predicted, separationArcsec: angularSeparationArcsec(point, predicted ?? source) });
  }
  return result.sort((a, b) => a.separationArcsec - b.separationArcsec);
}

/** What the point would score under point-check-v2. The server recomputes it on submit, from
 *  its own catalog check and its own brightness measurement on the saved frames. */
export function expectedPoints(review: CatalogReview): { points: number | null; label: string; detail: string; needsBrightness: boolean } {
  const summary = summarize(review);
  if (summary.tone === "offline")
    return { points: null, label: "No points while catalogs are offline", detail: "Points need a live catalog check.", needsBrightness: false };
  if (summary.tone === "listed")
    return { points: 10, label: "10 points · known object", detail: "A catalog already lists a source here.", needsBrightness: false };
  if (summary.tone === "incomplete")
    return { points: 0, label: "0 points so far", detail: "A catalog could not be checked. Check again for points; you can still submit it for discussion.", needsBrightness: false };
  return { points: 20, label: "20 points if bright in 2 surveys",
    detail: "No catalog lists a source here. On submit, the server measures the point in each saved frame; it must be at least 5σ above its surroundings in two surveys (SPHEREx, WISE). Otherwise it scores 0 and can still be submitted.",
    needsBrightness: true };
}
