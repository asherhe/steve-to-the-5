import type { CandidateReview } from './types';

export const reviewCatalogs = ['Gaia DR3', 'SIMBAD', 'CatWISE2020', 'UltracoolSheet', 'SkyBoT', 'VizieR'] as const;
const states = ['candidates', 'no_candidates', 'partial', 'unavailable', 'skipped'];
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string');
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function parseReview(value: unknown): CandidateReview {
  const bad = () => { throw new Error('The service returned an invalid review. Try again.'); };
  if (!object(value)) return bad();
  const r = value;
  if (!['id', 'comparisonId', 'frameId', 'observedAtUtc', 'reviewedAtUtc', 'scoreVersion'].every(k => typeof r[k] === 'string' && r[k]) || !Number.isFinite(Date.parse(String(r.observedAtUtc))) || !Number.isFinite(Date.parse(String(r.reviewedAtUtc))) || !['spherex', 'wise'].includes(String(r.survey)) || !finite(r.ra) || r.ra < 0 || r.ra >= 360 || !finite(r.dec) || Math.abs(r.dec) > 90 || !finite(r.radiusArcsec) || r.radiusArcsec < 5 || r.radiusArcsec > 300 || !Number.isInteger(r.score) || (r.score as number) < 0 || (r.score as number) > 50 || !strings(r.reasons) || !strings(r.limitations)) return bad();
  const c = r.catalogReview;
  if (!object(c) || c.mode !== 'live' || c.ra !== r.ra || c.dec !== r.dec || c.radiusArcsec !== r.radiusArcsec || Date.parse(String(c.observedAtUtc)) !== Date.parse(String(r.observedAtUtc)) || !strings(c.limitations) || !Array.isArray(c.checks) || c.checks.length !== 6) return bad();
  const names = new Set<string>();
  for (const check of c.checks) {
    if (!object(check) || !reviewCatalogs.includes(check.catalog as typeof reviewCatalogs[number]) || names.has(String(check.catalog)) || !states.includes(String(check.status)) || typeof check.scope !== 'string' || typeof check.sourceUrl !== 'string' || !Array.isArray(check.rows) || check.rows.length > 50 || !check.rows.every(object) || !Array.isArray(check.columns) || !check.columns.every(col => object(col) && Object.values(col).every(v => v === null || typeof v === 'string')) || !strings(check.limitations)) return bad();
    if (!['servedBy', 'retrievedAtUtc', 'responseSha256'].every(key => check[key] === undefined || check[key] === null || typeof check[key] === 'string')) return bad();
    names.add(String(check.catalog));
  }
  return value as unknown as CandidateReview;
}

export function safeSourceUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
