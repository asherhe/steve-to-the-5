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
  const v4 = r.scoreVersion === 'point-check-v4';
  if (typeof r.id !== 'string' || !r.id || (!v4 && r.scoreVersion !== 'point-check-v3') || !position(r)
      || !finite(r.radiusArcsec) || r.radiusArcsec < 5 || r.radiusArcsec > 300
      || !['known', 'uncatalogued', 'incomplete'].includes(String(r.classification))
      || (!v4 && (r.classification === 'known' ? r.score !== 10 : r.classification === 'incomplete' ? r.score !== 0 : ![0, 20].includes(r.score as number)))
      || (v4 && (!Number.isInteger(r.score) || (r.score as number) < 0 || (r.score as number) > 50))
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
  if (!Array.isArray(r.brightness) || r.brightness.length > (v4 ? 54 : 8)) return bad();
  for (const m of r.brightness) {
    if (!object(m) || !['spherex', 'wise', 'dss', 'neossat'].includes(String(m.survey))
        || !['measured', 'outside', 'unmeasurable', 'no_coverage', 'unavailable'].includes(String(m.status))
        || typeof m.bright !== 'boolean' || (m.snr != null && !finite(m.snr))
        || (m.observedAtUtc != null && !time(m.observedAtUtc)) || (m.sourceUrl != null && typeof m.sourceUrl !== 'string')
        || (m.message != null && typeof m.message !== 'string') || (m.label != null && typeof m.label !== 'string')
        || (m.status === 'measured' && !finite(m.snr)) || (m.bright && (m.status !== 'measured' || !finite(m.snr) || m.snr < 5))) return bad();
  }
  if (v4 && !validSpectralScore(r)) return bad();
  return value as unknown as PointReview;
}

function validSpectralScore(r: Record<string, unknown>): boolean {
  const s = r.spectral, w = r.wiseVariability;
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  if (!object(s) || !['not_eligible', 'unavailable', 'no_coverage', 'insufficient', 'measured'].includes(String(s.status))
      || typeof s.message !== 'string' || s.method !== 'fixed-aperture-v1' || !object(s.config) || !strings(s.limitations)
      || typeof s.sourceDetected !== 'boolean' || !Number.isInteger(s.independentChannels) || (s.independentChannels as number) < 0
      || !Array.isArray(s.samples) || s.samples.length > 48 || !Array.isArray(s.features) || s.features.length > 3) return false;
  if (s.samples.length && (!hash(s.evidenceId) || s.manifestUrl !== `/api/findings/spectral/${s.evidenceId}`)) return false;
  for (const m of s.samples) {
    if (!object(m) || !hash(m.sourceSha256) || typeof m.sourceUrl !== 'string' || !['measured', 'rejected'].includes(String(m.status))
        || m.assetUrl !== `/api/findings/spectral/${s.evidenceId}/assets/${m.sourceSha256}.fits`
        || (m.status === 'measured' && (!time(m.observedAtUtc) || !time(m.observedUntilUtc)
          || !finite(m.wavelengthUm) || m.wavelengthUm <= 0 || !finite(m.bandwidthUm) || m.bandwidthUm <= 0
          || !finite(m.brightnessMjySr) || !finite(m.uncertaintyMjySr) || m.uncertaintyMjySr <= 0 || !finite(m.snr)))) return false;
  }
  if (s.sourceDetected && !s.samples.some(m => object(m) && m.status === 'measured' && finite(m.snr) && m.snr >= 5)) return false;
  const awards = new Map<string, number>();
  const samples = s.samples;
  for (const feature of s.features) {
    if (!object(feature) || !['water', 'methane', 'hydrogen'].includes(String(feature.key)) || awards.has(String(feature.key))
        || typeof feature.label !== 'string' || typeof feature.sourceUrl !== 'string' || !['supported', 'not_supported', 'insufficient'].includes(String(feature.status))
        || feature.points !== (s.sourceDetected && feature.status === 'supported' ? 5 : 0) || !Array.isArray(feature.bands) || feature.bands.length !== 2) return false;
    for (const b of feature.bands) {
      if (!object(b) || typeof b.name !== 'string' || typeof b.message !== 'string' || !['supported', 'not_supported', 'insufficient'].includes(String(b.status))
          || !finite(b.startUm) || !finite(b.endUm) || b.startUm >= b.endUm || !strings(b.sampleHashes)
          || !b.sampleHashes.every(h => samples.some(m => object(m) && m.sourceSha256 === h))
          || (b.depthFraction != null && !finite(b.depthFraction)) || (b.significance != null && !finite(b.significance))
          || (b.status === 'supported' && (!finite(b.significance) || b.significance < 5 || !finite(b.depthFraction) || b.depthFraction < .2 || b.sampleHashes.length < 3))) return false;
    }
    if (feature.status === 'supported' && !feature.bands.every(b => object(b) && b.status === 'supported')) return false;
    awards.set(String(feature.key), feature.points as number);
  }
  if (typeof r.wiseComparisonId !== 'string' || !r.wiseComparisonId || !object(w) || w.comparisonId !== r.wiseComparisonId
      || !['candidate', 'stable', 'insufficient', 'unavailable'].includes(String(w.status)) || typeof w.message !== 'string'
      || !strings(w.limitations) || !object(w.config) || !Array.isArray(w.epochs) || w.epochs.length > 2
      || w.points !== (s.sourceDetected && w.status === 'candidate' ? 5 : 0)
      || (w.fractionalChange != null && !finite(w.fractionalChange)) || (w.significance != null && !finite(w.significance))) return false;
  for (const e of w.epochs) {
    if (!object(e) || typeof e.frameId !== 'string' || !time(e.observedStartUtc) || !time(e.observedEndUtc)
        || !finite(e.relativeFlux) || e.relativeFlux <= 0 || !finite(e.uncertainty) || e.uncertainty <= 0 || !Array.isArray(e.exposures) || e.exposures.length < 2 || e.exposures.length > 12) return false;
  }
  if (w.status === 'candidate' && (w.epochs.length !== 2 || !finite(w.significance) || w.significance < 5 || !finite(w.fractionalChange) || w.fractionalChange < .2)) return false;
  const brightSurveys = new Set((r.brightness as Record<string, unknown>[]).filter(m => m.bright).map(m => m.survey)).size;
  const base = r.classification === 'known' ? 10 : r.classification === 'incomplete' ? 0 : brightSurveys >= 2 ? 20 : 0;
  awards.set('base', base); awards.set('spherex', s.sourceDetected ? 10 : 0); awards.set('wise_variability', w.points as number);
  if (!Array.isArray(r.scoreBreakdown) || r.scoreBreakdown.length !== awards.size) return false;
  const seen = new Set<string>();
  for (const part of r.scoreBreakdown) {
    if (!object(part) || seen.has(String(part.key)) || awards.get(String(part.key)) !== part.points || typeof part.reason !== 'string') return false;
    seen.add(String(part.key));
  }
  return r.score === [...awards.values()].reduce((a, b) => a + b, 0);
}
