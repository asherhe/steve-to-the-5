// Pure summary of a catalog-chain check for a marked point (rendered by PointCheck.tsx).
import type { CatalogReview } from "../inspector/api.ts";
import { angularSeparationArcsec, predictAtObservation } from "../inspector/propagate.ts";
import type { SkyPosition } from "./comparison";

type CatalogCheck = CatalogReview["checks"][number];

const nameKeys = ["main_id", "name", "Name", "designation", "source_name", "AllWISE", "sourceId", "source_id"];
const positionKeys: [string, string][] = [["ra", "dec"], ["RAJ2000", "DEJ2000"], ["ra_j2000_formula", "dec_j2000_formula"], ["RA", "DEC"]];

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
      const position = publishedPosition(row);
      if (position) arcsec = angularSeparationArcsec(point, position);
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
  const undatedSkybot = review.checks.some(c => c.catalog === "SkyBoT" && c.status === "skipped") && !review.observedAtUtc;
  const unchecked = review.checks.filter(c => c.status === "unavailable" || (c.status === "skipped" && !(c.catalog === "SkyBoT" && undatedSkybot)));
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
    title: undatedSkybot ? "No record in the checked catalogs" : "No record in any of the six catalogs",
    detail: `Nothing within ${review.radiusArcsec}″.${undatedSkybot ? " SkyBoT needs an observation time and was not run." : ""} That makes this point worth a closer look, not a discovery: catalogs have depth and epoch limits, and image artifacts or moving objects can explain it.`,
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

/** Provisional point-check-v3 guidance; only the server awards points. */
export function expectedPoints(review: CatalogReview): { points: number | null; label: string; detail: string; needsBrightness: boolean } {
  const summary = summarize(review);
  if (summary.tone === "offline")
    return { points: null, label: "No points while catalogs are offline", detail: "Points need a live catalog check.", needsBrightness: false };
  if (summary.tone === "listed")
    return { points: 10, label: "10 points · known object", detail: "A catalog already lists a source here.", needsBrightness: false };
  if (summary.tone === "incomplete")
    return { points: 0, label: "0 points so far", detail: "A catalog could not be checked. Check again for points; you can still submit it for discussion.", needsBrightness: false };
  return { points: 20, label: "20 points if bright in 2 surveys",
    detail: "No checked catalog lists a source here. The server fetches SPHEREx, WISE, DSS and NEOSSat images and measures the point: at least 5σ above its surroundings in any two surveys earns 20 points. Otherwise it earns 0 and can still be submitted. No loaded frames are needed.",
    needsBrightness: true };
}

function sexagesimal(value: unknown, hours: boolean): number | null {
  const direct = numeric(value);
  if (direct !== null) return direct;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([+-]?)(\d{1,3})[hHdD:\s]+(\d{1,2})[mM:'\s]+(\d+(?:\.\d*)?)[sS\"]?$/);
  if (!match) return null;
  const first = Number(match[2]), minute = Number(match[3]), second = Number(match[4]);
  if (minute >= 60 || second >= 60 || first > (hours ? 23 : 90) || (hours && match[1] === "-")) return null;
  return (match[1] === "-" ? -1 : 1) * (first + minute / 60 + second / 3600) * (hours ? 15 : 1);
}

/** Published coordinates remain catalog positions; only Gaia has a propagation model here. */
export function publishedPosition(row: Record<string, unknown>): SkyPosition | null {
  for (const [raKey, decKey] of positionKeys) {
    const ra = raKey === "RA" ? sexagesimal(row[raKey], true) : numeric(row[raKey]);
    const dec = decKey === "DEC" ? sexagesimal(row[decKey], false) : numeric(row[decKey]);
    if (ra !== null && dec !== null && ra >= 0 && ra < 360 && Math.abs(dec) <= 90) return { ra, dec };
  }
  return null;
}

export interface CatalogSource extends SkyPosition {
  key: string;
  catalog: string;
  name: string;
  label: string;
  separationArcsec: number;
  /** Gaia is retained so the viewer can update its prediction with dated playback. */
  gaia?: GaiaNeighbour;
  placeable: boolean;
}

export function catalogSources(review: CatalogReview, point: SkyPosition, predictionTimeUtc: string | null): CatalogSource[] {
  const gaia = new Map(gaiaNeighbours(review, point, predictionTimeUtc).map(source => [source.sourceId, source]));
  const result = new Map<string, CatalogSource>();
  for (const check of review.checks) {
    for (const row of check.rows ?? []) {
      const position = publishedPosition(row);
      if (!position) continue;
      const nameKey = nameKeys.find(key => (typeof row[key] === "string" && String(row[key]).trim()) || typeof row[key] === "number") ?? (row.Num != null ? "Num" : undefined);
      const name = nameKey ? String(row[nameKey]).trim() : "unnamed record";
      const neighbour = check.catalog === "Gaia DR3" ? gaia.get(String(row.sourceId ?? row.source_id)) : undefined;
      const at = neighbour?.predicted ?? position;
      const epoch = neighbour?.predicted ? `predicted for ${predictionTimeUtc?.slice(0, 10)}` : "published catalog position";
      const key = `${check.catalog}:${name}:${position.ra}:${position.dec}`;
      result.set(key, { key, catalog: check.catalog, name, ...at, gaia: neighbour,
        label: `${check.catalog} ${name} (${epoch})`, separationArcsec: angularSeparationArcsec(point, at),
        placeable: !(check.catalog === "Gaia DR3" && predictionTimeUtc && !neighbour?.predicted) });
    }
  }
  return [...result.values()].sort((a, b) => a.separationArcsec - b.separationArcsec);
}
