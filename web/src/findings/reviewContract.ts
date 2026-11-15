import type { CandidateReview, FrameRef, PointReview } from './types';

export const reviewCatalogs = ['Gaia DR3', 'SIMBAD', 'CatWISE2020', 'UltracoolSheet', 'SkyBoT', 'VizieR'] as const;
const states = ['candidates', 'no_candidates', 'partial', 'unavailable', 'skipped'];
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string');
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
function validCatalogReview(value: unknown, r: Record<string, unknown>): boolean {
  const c = value;
  if (!object(c) || c.mode !== 'live' || c.ra !== r.ra || c.dec !== r.dec || c.radiusArcsec !== r.radiusArcsec || (c.observedAtUtc == null || r.observedAtUtc == null ? c.observedAtUtc != null || r.observedAtUtc != null : Date.parse(String(c.observedAtUtc)) !== Date.parse(String(r.observedAtUtc))) || !strings(c.limitations) || !Array.isArray(c.checks) || c.checks.length !== 6) return false;
  const names = new Set<string>();
  for (const check of c.checks) {
    if (!object(check) || !reviewCatalogs.includes(check.catalog as typeof reviewCatalogs[number]) || names.has(String(check.catalog)) || !states.includes(String(check.status)) || typeof check.scope !== 'string' || typeof check.sourceUrl !== 'string' || !Array.isArray(check.rows) || check.rows.length > 50 || !check.rows.every(object) || !Array.isArray(check.columns) || !check.columns.every(col => object(col) && Object.values(col).every(v => v === null || typeof v === 'string')) || !strings(check.limitations)) return false;
    if (!['servedBy', 'retrievedAtUtc', 'responseSha256'].every(key => check[key] === undefined || check[key] === null || typeof check[key] === 'string')) return false;
    names.add(String(check.catalog));
  }
  return true;
}
export function parseReview(value: unknown): CandidateReview {
  const bad = () => { throw new Error('The service returned an invalid review. Try again.'); };
  if (!object(value)) return bad();
  const r = value;
  if (!['id', 'comparisonId', 'frameId', 'observedAtUtc', 'reviewedAtUtc', 'scoreVersion'].every(k => typeof r[k] === 'string' && r[k]) || !Number.isFinite(Date.parse(String(r.observedAtUtc))) || !Number.isFinite(Date.parse(String(r.reviewedAtUtc))) || !['spherex', 'wise'].includes(String(r.survey)) || !finite(r.ra) || r.ra < 0 || r.ra >= 360 || !finite(r.dec) || Math.abs(r.dec) > 90 || !finite(r.radiusArcsec) || r.radiusArcsec < 5 || r.radiusArcsec > 300 || !Number.isInteger(r.score) || (r.score as number) < 0 || (r.score as number) > 50 || !strings(r.reasons) || !strings(r.limitations)) return bad();
  if (!validCatalogReview(r.catalogReview, r)) return bad();
  return value as unknown as CandidateReview;
}

export function safeSourceUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}

export function sameFrame(a: FrameRef | null | undefined, b: FrameRef | null | undefined): boolean {
  return !a && !b || !!a && !!b && a.comparisonId === b.comparisonId && a.frameId === b.frameId && a.survey === b.survey;
}

/** Decode the point-review wire shape separately from historical frame-backed reviews. */
export function parsePointReview(value: unknown): PointReview {
  const bad = (): never => { throw new Error('The service returned an invalid point review. Try again.'); };
  const position = (r: Record<string, unknown>) => finite(r.ra) && r.ra >= 0 && r.ra < 360 && finite(r.dec) && Math.abs(r.dec) <= 90;
  const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  if (!object(value)) return bad();
  const r = value;
  if (typeof r.id !== 'string' || !r.id || r.scoreVersion !== 'point-check-v3' || !position(r)
      || !finite(r.radiusArcsec) || r.radiusArcsec < 5 || r.radiusArcsec > 300
      || !['known', 'uncatalogued', 'incomplete'].includes(String(r.classification))
      || (r.classification === 'known' ? r.score !== 10 : r.classification === 'incomplete' ? r.score !== 0 : ![0, 20].includes(r.score as number))
      || !time(r.reviewedAtUtc) || (r.observedAtUtc != null && !time(r.observedAtUtc)) || !strings(r.reasons) || !strings(r.limitations)) return bad();
  if (r.frame != null && (!object(r.frame) || !['spherex', 'wise'].includes(String(r.frame.survey))
      || typeof r.frame.comparisonId !== 'string' || !r.frame.comparisonId || typeof r.frame.frameId !== 'string' || !r.frame.frameId || !r.observedAtUtc)) return bad();
  if (!r.frame && r.observedAtUtc != null) return bad();
  if (!validCatalogReview(r.catalogReview, r)) return bad();
  if (r.identity != null && (!object(r.identity) || !position(r.identity) || typeof r.identity.catalog !== 'string'
      || typeof r.identity.name !== 'string' || !r.identity.name || (r.identity.separationArcsec != null && (!finite(r.identity.separationArcsec) || r.identity.separationArcsec < 0)))) return bad();
  if (r.duplicate != null && (!object(r.duplicate) || typeof r.duplicate.findingId !== 'string' || !r.duplicate.findingId
      || typeof r.duplicate.title !== 'string' || typeof r.duplicate.displayName !== 'string' || typeof r.duplicate.sameObject !== 'boolean'
      || (r.duplicate.separationArcsec != null && (!finite(r.duplicate.separationArcsec) || r.duplicate.separationArcsec < 0)))) return bad();
  if (!Array.isArray(r.brightness) || r.brightness.length > 8) return bad();
  for (const m of r.brightness) {
    if (!object(m) || !['spherex', 'wise', 'dss', 'neossat'].includes(String(m.survey))
        || !['measured', 'outside', 'unmeasurable', 'no_coverage', 'unavailable'].includes(String(m.status))
        || typeof m.bright !== 'boolean' || (m.snr != null && !finite(m.snr))
        || (m.observedAtUtc != null && !time(m.observedAtUtc)) || (m.sourceUrl != null && typeof m.sourceUrl !== 'string')
        || (m.message != null && typeof m.message !== 'string') || (m.label != null && typeof m.label !== 'string')
        || (m.status === 'measured' && !finite(m.snr)) || (m.bright && (m.status !== 'measured' || !finite(m.snr) || m.snr < 5))) return bad();
  }
  return value as unknown as PointReview;
}
