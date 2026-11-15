/** Explicitly simulated local workflow: posts, replies and the leaderboard live only in this
 *  browser. Points come from the local findings service when it runs in demo mode
 *  (FINDINGS_LOCAL_DEMO=1, started by `npm run dev`): same rules as the live service, including
 *  the brightness measurement, so 20 points are possible. Without it, the public catalog check
 *  still runs, but brightness is not measured and the simulation cannot award 20 points. */
import { createCatalogClient } from '../inspector/api';
import fixture from '../../../services/findings/fixtures/candidate-flow.json';
import examples from './retained-examples.json';
import type { ReviewClient } from './api';
import type { CandidateReview, FindingDetail, FindingReply, FrameRef, PointReview, PointReviewInput, SavedReview } from './types';
import { FindingsApiError } from './api';
import { catalogSources, catalogAvailability } from '../viewer/catalogCheckSummary';
import { angularSeparationArcsec } from '../inspector/propagate';
import { createArchiveDataSource, createWiseDataSource } from '../viewer/archive';
import { parsePointReview, sameFrame } from './reviewContract';
import type { LeaderboardResult } from '../leaderboard/types';
import type { AuthGateway, AuthSession } from './auth';

const key = 'spherex.local-demo.findings.v1';
const observer: AuthSession = { userId: 'local-demo', displayName: 'Local observer' };
const read = (): FindingDetail[] => {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as FindingDetail[]; } catch { return []; }
};
const write = (items: FindingDetail[]) => localStorage.setItem(key, JSON.stringify(items));
const aborted = (signal?: AbortSignal) => signal?.throwIfAborted();
export const mockAuth: AuthGateway = {
  initialize: async () => observer,
  subscribe: () => () => {},
  headers: async () => ({}),
  sendEmail: async () => {}, verifyCode: async () => {}, signOut: async () => {},
};
const reviews = new Map<string, SavedReview>();
const catalog = createCatalogClient();

function duplicateOf(review: PointReview, existing = read()): PointReview['duplicate'] {
  for (const f of existing) {
    const prior = f.candidateReview && 'identity' in f.candidateReview ? f.candidateReview.identity : null;
    const sameObject = !!review.identity && !!prior && review.identity.catalog === prior.catalog && review.identity.name === prior.name;
    const separationArcsec = angularSeparationArcsec(f, review);
    if (sameObject || separationArcsec <= 15) return { findingId: f.id, title: f.title, displayName: f.authorDisplayName, separationArcsec, sameObject };
  }
  return null;
}
// Saved comparisons the viewer can load, by survey (the WISE band only affects new searches).
// `fetch` is looked up on each call, not captured when this module loads.
const request: typeof fetch = (input, init) => fetch(input, init);
const savedComparisons = { spherex: createArchiveDataSource(request), wise: createWiseDataSource(1, request) };
const realEvidence = new Set(['real_archive', 'saved_real_example']);

/** Observation time of a marked frame, as the findings service would establish it: from the
 *  bundled examples, or else from the saved SPHEREx or WISE comparison the frame belongs to. */
async function frameObservedAt(ref: FrameRef, signal?: AbortSignal): Promise<string> {
  const bundled = examples.find(item => item.id === ref.comparisonId)?.frames.find(item => item.id === ref.frameId);
  if (bundled) return bundled.observedAtUtc;
  let saved;
  try { saved = await savedComparisons[ref.survey].loadSaved(ref.comparisonId, signal); }
  catch {
    aborted(signal);
    throw new FindingsApiError(503, 'comparison_unavailable',
      `The ${ref.survey === 'wise' ? 'WISE time-lapse' : 'SPHEREx archive'} service could not load this frame's comparison. Try again, or mark the point on the reference map.`);
  }
  aborted(signal);
  if (!saved) throw new FindingsApiError(422, 'invalid_frame', 'This frame\'s saved comparison was not found. Mark the point on the reference map instead.');
  if (!realEvidence.has(String(saved.provenance?.evidenceKind)))
    throw new FindingsApiError(422, 'not_real_evidence', 'Points need real observations; synthetic data cannot earn points.');
  const frame = saved.frames.find(item => item.id === ref.frameId);
  if (!frame) throw new FindingsApiError(422, 'invalid_frame', 'Choose a frame from the saved comparison.');
  return frame.observedAtUtc;
}

/** Scores a point with the local findings service in demo mode. Returns null when that service
 *  is not reachable (or is the live service, which has no demo route), so the browser can fall
 *  back. A structured error from the service, such as a synthetic frame, is passed on. */
async function scoreWithLocalService(req: PointReviewInput, signal?: AbortSignal): Promise<PointReview | null> {
  let response: Response;
  try {
    response = await fetch('/api/findings/demo/points/review', {
      method: 'POST', body: JSON.stringify(req), signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
  } catch {
    aborted(signal);
    if (req.wiseComparisonId) throw new FindingsApiError(0, 'network_error', 'Could not reach the demo scoring service. Start npm run dev:scoring or npm run dev.');
    return null;
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    let review: PointReview;
    try { review = parsePointReview(body); }
    catch (error) { throw new FindingsApiError(502, 'invalid_response', error instanceof Error ? error.message : 'The local scoring service returned an invalid point review.'); }
    if (review.ra !== req.ra || review.dec !== req.dec || review.radiusArcsec !== req.radiusArcsec || !sameFrame(review.frame, req.frame) || (review.scoreVersion === 'point-check-v4' && review.wiseComparisonId !== req.wiseComparisonId))
      throw new FindingsApiError(502, 'invalid_response', 'The local scoring service returned a different point.');
    return review;
  }
  const error = body && typeof body === 'object' ? body as { code?: unknown; message?: unknown } : null;
  if (response.status !== 404 && typeof error?.code === 'string' && typeof error.message === 'string')
    throw new FindingsApiError(response.status, error.code, error.message);
  if (req.wiseComparisonId) throw new FindingsApiError(response.status, 'scoring_unavailable', 'The demo scoring service is unavailable. Start npm run dev:scoring or npm run dev.');
  return null;
}

export const mockFindings: ReviewClient = {
  authConfig: async () => { throw new Error('Local demo has no sign-in service.'); },
  async pointReview(req, signal) {
    aborted(signal);
    const radiusArcsec = req.radiusArcsec ?? 30;
    const scored = await scoreWithLocalService({ ...req, radiusArcsec }, signal);
    aborted(signal);
    if (scored) {
      scored.duplicate = duplicateOf(scored);
      reviews.set(scored.id, scored);
      return scored;
    }
    const observedAtUtc = req.frame ? await frameObservedAt(req.frame, signal) : null;
    let catalogReview: PointReview['catalogReview'];
    try { catalogReview = await catalog.review({ ...req, radiusArcsec, observedAtUtc }, signal); }
    catch (error) {
      aborted(signal);
      const template = structuredClone(fixture.review.catalogReview) as unknown as PointReview['catalogReview'];
      catalogReview = { ...template, mode: 'offline', ra: req.ra, dec: req.dec, observedAtUtc, radiusArcsec,
        checks: template.checks.map(c => ({ ...c, status: 'unavailable', rows: [] })),
        limitations: ['The catalog service could not be reached. No real checks completed.'] };
    }
    aborted(signal);
    const availability = catalogAvailability(catalogReview);
    const listed = catalogReview.mode === 'live' && availability.listed.length > 0;
    const incomplete = catalogReview.mode !== 'live' || availability.unchecked.length > 0;
    const priority = ['Gaia DR3', 'SIMBAD', 'CatWISE2020', 'VizieR', 'UltracoolSheet', 'SkyBoT'];
    const source = listed ? catalogSources(catalogReview, req, observedAtUtc)
      .filter(s => catalogReview.checks.some(c => c.catalog === s.catalog && ['candidates', 'partial'].includes(c.status)))
      .sort((a, b) => priority.indexOf(a.catalog) - priority.indexOf(b.catalog) || a.separationArcsec - b.separationArcsec)[0] : null;
    const result: PointReview = { ...req, radiusArcsec, id: crypto.randomUUID(), observedAtUtc, reviewedAtUtc: new Date().toISOString(),
      scoreVersion: 'point-check-v3', score: listed ? 10 : 0, classification: listed ? 'known' : incomplete ? 'incomplete' : 'uncatalogued',
      reasons: [listed ? '+10: a live catalog lists a source in this cone. No brightness check is needed.'
        : '+0 (LOCAL SIMULATION): the local scoring service is not running, so brightness was not measured and 20 points are not possible. Start it with `npm run dev:findings`, or restart `npm run dev`.'],
      identity: source ? { catalog: source.catalog, name: source.name, ra: source.ra, dec: source.dec, separationArcsec: source.separationArcsec } : null,
      catalogReview, brightness: [], duplicate: null, limitations: ['LOCAL SIMULATION: posts and points exist only in this browser; brightness was not measured.'] };
    result.duplicate = duplicateOf(result);
    reviews.set(result.id, result);
    return result;
  },
  async createReview(req, signal) {
    aborted(signal);
    const template = structuredClone(fixture.review) as unknown as CandidateReview;
    const saved = examples.find(item => item.id === req.comparisonId);
    const frame = saved?.frames.find(item => item.id === req.frameId);
    if (!frame) throw new Error('The local demo supports the four retained real comparison fields. Open a saved example first.');
    const radiusArcsec = req.radiusArcsec ?? 120;
    let catalogReview: CandidateReview['catalogReview'];
    try {
      catalogReview = await catalog.review({ ra: req.ra, dec: req.dec, radiusArcsec, observedAtUtc: frame.observedAtUtc }, signal);
    } catch (error) {
      aborted(signal);
      catalogReview = { ...template.catalogReview, mode: 'offline', ra: req.ra, dec: req.dec, observedAtUtc: frame.observedAtUtc, radiusArcsec,
        checks: template.catalogReview.checks.map(check => ({ ...check, status: 'unavailable' as const, scope: 'Catalog service unreachable', rows: [], servedBy: null })),
        limitations: [`The catalog check could not run: ${error instanceof Error ? error.message : 'unknown error'}`] };
    }
    const statuses = catalogReview.checks.map(c => c.status);
    const listed = catalogReview.checks.filter(c => c.status === 'candidates' || c.status === 'partial').map(c => c.catalog);
    const classification = listed.length ? 'known' as const : statuses.every(x => x === 'no_candidates') && catalogReview.mode === 'live' ? 'uncatalogued' as const : 'incomplete' as const;
    const score = classification === 'known' ? 10 : 0;
    const reasons = [classification === 'known'
      ? `+10: known object. ${listed.join(', ')} ${listed.length === 1 ? 'lists' : 'list'} a source within ${radiusArcsec}″.`
      : classification === 'uncatalogued'
        ? '+0 (LOCAL SIMULATION): no catalog lists a source, but brightness is only measured by the findings service, so the 20-point rule cannot be scored here.'
        : '+0: the catalog check is incomplete or offline. Retry for points.'];
    const result: CandidateReview = { ...template, id: crypto.randomUUID(), comparisonId: req.comparisonId,
      survey: req.survey ?? 'spherex', frameId: req.frameId, ra: req.ra, dec: req.dec, radiusArcsec,
      brightnessEvidence: req.brightnessEvidence ?? [],
      observedAtUtc: frame.observedAtUtc, reviewedAtUtc: new Date().toISOString(), score, classification, reasons,
      brightness: [], catalogReview,
      limitations: ['LOCAL SIMULATION: points and posts exist only in this browser; brightness was not measured.', ...template.limitations] };
    reviews.set(result.id, result);
    return result;
  },
  async createFinding(req) {
    const save = () => {
    const review = req.reviewId ? reviews.get(req.reviewId) : null;
    if (!review) throw new Error('Run the local simulated review first.');
    if (review.ra !== req.ra || review.dec !== req.dec) throw new FindingsApiError(422, 'invalid_review', 'Check this point again before submitting.');
    const existing = read();
    if (review.scoreVersion === 'point-check-v3' || review.scoreVersion === 'point-check-v4') {
      const duplicate = duplicateOf(review as PointReview, existing);
      if (duplicate) throw new FindingsApiError(409, 'already_on_leaderboard', `This point is already on the leaderboard: “${duplicate.title}” by ${duplicate.displayName}. Join its discussion.`);
    }
    if (existing.some(f => f.comparisonId === req.comparisonId && f.ra === req.ra && f.dec === req.dec)) throw new Error('This demo position was already posted.');
    const finding: FindingDetail = { id: crypto.randomUUID(), comparisonId: req.comparisonId ?? null, survey: req.survey ?? ('frameId' in review ? review.survey : review.frame?.survey) ?? 'spherex',
      ra: req.ra, dec: req.dec, title: req.title, note: req.note, marks: req.marks ?? [],
      authorDisplayName: observer.displayName, createdAtUtc: new Date().toISOString(), replies: [], candidateReview: review };
    write([finding, ...existing]); return { id: finding.id };
    };
    // Serialize across same-origin demo tabs when supported, just as the real DB serializes submissions.
    if (globalThis.navigator?.locks) return navigator.locks.request('spherex.local-demo.point-submission', save);
    return save();
  },
  async createReply(id, req) {
    const list = read(), finding = list.find(f => f.id === id);
    if (!finding) throw new Error('Demo finding not found.');
    const reply: FindingReply = { id: crypto.randomUUID(), text: req.text, authorDisplayName: observer.displayName, createdAtUtc: new Date().toISOString() };
    finding.replies.push(reply); write(list); return reply;
  },
  async getFinding(id, signal) { aborted(signal); const finding = read().find(f => f.id === id); if (!finding) throw new Error('Demo finding not found.'); return finding; },
  async listFindings(_viewport, signal) { aborted(signal); return { items: read().map(f => ({ id: f.id, ra: f.ra, dec: f.dec, title: f.title, authorDisplayName: f.authorDisplayName, createdAtUtc: f.createdAtUtc, replyCount: f.replies.length, survey: f.survey ?? 'spherex' })) }; },
  async leaderboard(board, signal): Promise<LeaderboardResult> {
    aborted(signal);
    const today = new Date().toISOString().slice(0, 10);
    const items = read().filter(f => board === 'allTime' || f.createdAtUtc.slice(0, 10) === today);
    items.sort((a,b) => (b.candidateReview?.score ?? 0) - (a.candidateReview?.score ?? 0) || a.createdAtUtc.localeCompare(b.createdAtUtc));
    return { board, placeholder: false, entries: items.map((f,i) => ({ id: f.id, findingId: f.id,
      comparisonId: f.comparisonId ?? null, survey: f.survey ?? 'spherex', title: f.title, displayName: f.authorDisplayName,
      ra: f.ra, dec: f.dec, fovArcmin: examples.find(item => item.id === f.comparisonId)?.fovArcmin ?? 6, enteredAtUtc: f.createdAtUtc, rank: i+1,
      rarityScore: f.candidateReview?.score ?? 0, tier: null, reasons: ['LOCAL SIMULATION — not a public ranking'] })) };
  },
};
