/** Explicitly simulated local workflow; never sent to findings or catalog services. */
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
export const mockFindings: ReviewClient = {
  authConfig: async () => { throw new Error('Local demo has no sign-in service.'); },
  async createReview(req, signal) {
    aborted(signal);
    const template = structuredClone(fixture.review) as unknown as CandidateReview;
    const saved = examples.find(item => item.id === req.comparisonId);
    const frame = saved?.frames.find(item => item.id === req.frameId);
    if (!frame) throw new Error('The local demo supports the four retained real comparison fields. Open a saved example first.');
    const result: CandidateReview = { ...template, id: crypto.randomUUID(), comparisonId: req.comparisonId,
      survey: req.survey ?? 'spherex', frameId: req.frameId, ra: req.ra, dec: req.dec,
      radiusArcsec: req.radiusArcsec ?? 120,
      observedAtUtc: frame.observedAtUtc, reviewedAtUtc: new Date().toISOString(), score: 20,
      reasons: ['+10: saved real dated image with a marked sky position', '+10: saved comparison contains at least two observation dates'],
      catalogReview: { ...template.catalogReview, ra: req.ra, dec: req.dec, observedAtUtc: frame.observedAtUtc, radiusArcsec: req.radiusArcsec ?? 120,
        checks: template.catalogReview.checks.map(check => ({ ...check, status: 'skipped' as const, scope: 'Local simulation; no catalog query was made', rows: [], servedBy: null })),
        limitations: ['LOCAL SIMULATION: no catalog query was made. These review-effort points exist only in this browser.'] } };
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
  async listFindings(_viewport, signal) { aborted(signal); return { items: read().map(f => ({ id: f.id, ra: f.ra, dec: f.dec, title: f.title })) }; },
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
