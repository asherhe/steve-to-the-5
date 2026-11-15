/** Explicitly simulated local workflow; never sent to the findings service. The public
 *  catalog check runs for real so known objects score as they would; brightness is only
 *  measured by the findings service, so the simulation never awards the 20-point rule. */
import { createCatalogClient } from '../inspector/api';
import fixture from '../../../services/findings/fixtures/candidate-flow.json';
import examples from './retained-examples.json';
import type { ReviewClient } from './api';
import type { CandidateReview, FindingDetail, FindingReply } from './types';
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
let reviews = new Map<string, CandidateReview>();
const catalog = createCatalogClient();
export const mockFindings: ReviewClient = {
  authConfig: async () => { throw new Error('Local demo has no sign-in service.'); },
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
    const review = req.reviewId ? reviews.get(req.reviewId) : null;
    if (!review) throw new Error('Run the local simulated review first.');
    const existing = read();
    if (existing.some(f => f.comparisonId === req.comparisonId && f.ra === req.ra && f.dec === req.dec)) throw new Error('This demo position was already posted.');
    const finding: FindingDetail = { id: crypto.randomUUID(), comparisonId: req.comparisonId, survey: req.survey ?? 'spherex',
      ra: req.ra, dec: req.dec, title: req.title, note: req.note, marks: req.marks ?? [],
      authorDisplayName: observer.displayName, createdAtUtc: new Date().toISOString(), replies: [], candidateReview: review };
    write([finding, ...existing]); return { id: finding.id };
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
      comparisonId: f.comparisonId, survey: f.survey ?? 'spherex', title: f.title, displayName: f.authorDisplayName,
      ra: f.ra, dec: f.dec, fovArcmin: examples.find(item => item.id === f.comparisonId)?.fovArcmin ?? 6, enteredAtUtc: f.createdAtUtc, rank: i+1,
      rarityScore: f.candidateReview?.score ?? 0, tier: null, reasons: ['LOCAL SIMULATION — not a public ranking'] })) };
  },
};
