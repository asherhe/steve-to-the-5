import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { PointSubmissionPane, type PointSubmissionSlotProps } from '../PointSubmissionPane';
import { PointCheck } from '../../viewer/PointCheck';
import { createFindingsClient } from '../api';
import { parsePointReview } from '../reviewContract';
import { ReviewReport } from '../ReviewReport';
import { FindingThread } from '../FindingThread';
import { LeaderboardPanel } from '../../leaderboard/LeaderboardPanel';
import { useComparisonLoader } from '../../viewer/useComparisonLoader';
import { authReturnUrl } from '../auth';
import type { PointReview } from '../types';
import fixture from '../../../../services/findings/fixtures/point-flow.json';

const session = { userId: 'observer-1', displayName: 'Observer' };
const report = parsePointReview(fixture.uncatalogued);
function setup(overrides: Partial<PointSubmissionSlotProps> = {}, response: unknown = fixture.uncatalogued) {
  const fetch = vi.fn(async (url: string, _options?: RequestInit) => Response.json(url.endsWith('/points/review') ? response : { id: 'new-point' }));
  const client = createFindingsClient({ fetch, getAuthHeaders: () => ({ Authorization: 'Bearer synthetic' }) });
  return { fetch, client, p: { client, session, position: fixture.request, wiseComparisonId: 'saved-wise', defaultRadiusArcsec: 30, onPrepareSignIn: vi.fn(), onRequestSignIn: vi.fn(), onCreated: vi.fn(), onShowDuplicate: vi.fn(), ...overrides } };
}
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks(); });

describe('point-check-v3 response boundary', () => {
  it.each(['known', 'uncatalogued', 'zero', 'duplicate'] as const)('accepts the server-produced %s fixture', key => {
    expect(parsePointReview(fixture[key]).score).toBe(fixture[key].score);
  });
  it.each(['wrong-position', 'wrong-time', 'duplicate-catalog', 'bad-measurement', 'bad-message', 'bad-duplicate', 'offline'])("rejects %s", kind => {
    const body = structuredClone(fixture.uncatalogued) as unknown as PointReview;
    if (kind === 'wrong-position') body.catalogReview.ra += 1;
    if (kind === 'wrong-time') body.observedAtUtc = '2025-01-01T00:00:00Z';
    if (kind === 'duplicate-catalog') body.catalogReview.checks[1].catalog = body.catalogReview.checks[0].catalog;
    if (kind === 'bad-measurement') body.brightness![1].snr = NaN;
    if (kind === 'bad-message') (body.brightness![1] as unknown as Record<string, unknown>).message = { unexpected: true };
    if (kind === 'bad-duplicate') body.duplicate = { findingId: '', title: '', displayName: '', sameObject: true };
    if (kind === 'offline') body.catalogReview.mode = 'offline';
    expect(() => parsePointReview(body)).toThrow(/invalid point review/);
  });
  it('rejects a response for a different point, radius, or optional frame', async () => {
    const { client } = setup();
    await expect(client.pointReview({ ...fixture.request, ra: 20 })).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(client.pointReview({ ...fixture.request, radiusArcsec: 120 })).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(client.pointReview({ ...fixture.request, frame: { survey: 'spherex', comparisonId: 'c', frameId: 'f' } })).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('submit a point with a saved WISE prerequisite', () => {
  it('blocks scoring until a real WISE blink is ready and provides the load action', () => {
    const { p, fetch } = setup({ wiseComparisonId: null, onGetWiseBlink: vi.fn() });
    const ui = render(<PointSubmissionPane {...p} />);
    expect(screen.getByRole('button', { name: 'Check and score this point' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Get WISE blink' }));
    expect(p.onGetWiseBlink).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
    ui.rerender(<PointSubmissionPane {...p} wiseComparisonId="ready-blink" />);
    expect(screen.getByRole('button', { name: 'Check and score this point' })).toBeEnabled();
  });
  it('requires sign-in before the persisted review and preserves the selection', () => {
    const { p, fetch } = setup(); render(<PointSubmissionPane {...p} session={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to submit' }));
    expect(fetch).not.toHaveBeenCalled(); expect(p.onPrepareSignIn).toHaveBeenCalledOnce(); expect(p.onRequestSignIn).toHaveBeenCalledOnce();
  });
  it.each(['known', 'uncatalogued', 'zero'] as const)('submits %s with only coordinates, text and the server review ID', async key => {
    const { p, fetch } = setup({}, fixture[key]); render(<PointSubmissionPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    await screen.findByRole('heading', { name: new RegExp(`^${fixture[key].score} points`) });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A point to discuss' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Please check the surrounding sources.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post finding' }));
    await waitFor(() => expect(p.onCreated).toHaveBeenCalledWith('new-point'));
    const first = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(first).toEqual({ ...fixture.request, wiseComparisonId: 'saved-wise' });
    const sent = JSON.parse(fetch.mock.calls[1][1]!.body as string);
    expect(sent).toEqual({ ra: report.ra, dec: report.dec, title: 'A point to discuss', note: 'Please check the surrounding sources.', reviewId: report.id });
    expect(fetch.mock.calls.every(([url]) => !url.includes('comparisons'))).toBe(true);
  });
  it('blocks a known duplicate before composing and opens its existing discussion', async () => {
    const { p } = setup({}, fixture.duplicate); render(<PointSubmissionPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    await screen.findByText(/Already on the leaderboard/);
    expect(screen.queryByLabelText('Title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open existing discussion' }));
    expect(p.onShowDuplicate).toHaveBeenCalledWith(fixture.duplicate.duplicate.findingId);
  });
  it('keeps the draft and prevents another post after a racing 409', async () => {
    const { p, fetch } = setup();
    fetch.mockImplementation(async url => url.endsWith('/points/review') ? Response.json(fixture.uncatalogued)
      : Response.json({ code: 'already_on_leaderboard', message: 'Another observer submitted this object.' }, { status: 409 }));
    render(<PointSubmissionPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' })); await screen.findByLabelText('Title');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Keep this draft' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'A question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post finding' })); await screen.findByRole('alert');
    expect(screen.getByLabelText('Title')).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Post finding' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Find existing entry' })).toBeEnabled();
  });
  it('invalidates a review on selection/radius/account changes and ignores stale responses', async () => {
    const { p, fetch } = setup();
    let resolve!: (value: Response) => void;
    fetch.mockImplementation(() => new Promise(r => { resolve = r; }));
    const ui = render(<PointSubmissionPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    ui.rerender(<PointSubmissionPane {...p} position={{ ra: 20, dec: 10 }} />);
    resolve(Response.json(fixture.uncatalogued));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check and score this point' })).toBeEnabled());
    expect(screen.queryByLabelText('Title')).toBeNull();
    ui.rerender(<PointSubmissionPane {...p} defaultRadiusArcsec={120} session={{ ...session, userId: 'other' }} />);
    expect(screen.queryByLabelText('Title')).toBeNull();
  });
  it('restores typed text after an account change but requires a fresh server review', async () => {
    const { p } = setup(); const ui = render(<PointSubmissionPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' })); await screen.findByLabelText('Title');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft for this position' } });
    ui.rerender(<PointSubmissionPane {...p} session={{ ...session, userId: 'other' }} />);
    expect(screen.queryByLabelText('Title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    expect(await screen.findByLabelText('Title')).toHaveValue('Draft for this position');
  });
  it('reports an outage without inventing a zero-point report and retries', async () => {
    const { p, fetch } = setup(); fetch.mockResolvedValue(Response.json({ code: 'review_busy', message: 'Try again shortly.' }, { status: 429 }));
    render(<PointSubmissionPane {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    await screen.findByRole('alert'); expect(screen.queryByLabelText('Title')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check and score this point' })).toBeEnabled();
  });
  it('sends an optional original-frame reference only to scoring, while the post remains point-only', async () => {
    const frame = { comparisonId: 'saved-real', frameId: 'original-frame', survey: 'wise' as const };
    const response = { ...structuredClone(fixture.known), frame, observedAtUtc: '2020-01-01T00:00:00Z',
      catalogReview: { ...structuredClone(fixture.known.catalogReview), observedAtUtc: '2020-01-01T00:00:00Z' } };
    const { p, fetch } = setup({ frame }, response); render(<PointSubmissionPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' })); await screen.findByLabelText('Title');
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ ...fixture.request, frame, wiseComparisonId: 'saved-wise' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Original dated point' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Use the frame time for asteroids.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post finding' })); await waitFor(() => expect(p.onCreated).toHaveBeenCalled());
    const body = JSON.parse(fetch.mock.calls[1][1]!.body as string);
    expect(body).not.toHaveProperty('frame'); expect(body).not.toHaveProperty('comparisonId'); expect(body).not.toHaveProperty('marks');
  });
  it('preserves text and provides reauthentication after a session expires during posting', async () => {
    const { p, fetch } = setup();
    fetch.mockImplementation(async url => url.endsWith('/points/review') ? Response.json(fixture.known)
      : Response.json({ code: 'unauthorized', message: 'Expired' }, { status: 401 }));
    render(<PointSubmissionPane {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    await screen.findByLabelText('Title'); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Keep for sign-in' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Keep this note.' } }); fireEvent.click(screen.getByRole('button', { name: 'Post finding' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Keep for sign-in'); expect(p.onRequestSignIn).toHaveBeenCalledOnce();
  });
});

describe('image-free discussion and replay', () => {
  const finding = { id: 'point-finding', ...fixture.request, comparisonId: null, title: 'A map point', note: 'Please discuss', marks: [],
    authorDisplayName: 'Observer', createdAtUtc: '2026-11-15T15:00:00Z', survey: 'spherex', replies: [], candidateReview: fixture.known };
  it('loads a finding-only link and focuses the point without touching either image store', async () => {
    const source = { loadSaved: vi.fn(), search: vi.fn() }; const focus = vi.fn();
    const client = createFindingsClient({ fetch: async () => Response.json(finding) });
    const { result } = renderHook(() => useComparisonLoader({ source, resolveName: vi.fn(), loadFinding: client.getFinding, onFocus: focus, initial: { kind: 'saved', id: '', findingId: finding.id } }));
    await waitFor(() => expect(result.current.preview.kind).toBe('point'));
    expect(source.loadSaved).not.toHaveBeenCalled(); expect(source.search).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith({ ra: report.ra, dec: report.dec, fovArcmin: 6 });
  });
  it('renders an image-free discussion and emits its position', async () => {
    const client = createFindingsClient({ fetch: async () => Response.json(finding) }); const show = vi.fn();
    render(<FindingThread client={client} session={null} findingId={finding.id} onClose={vi.fn()} onRequestSignIn={vi.fn()} onShowEvidence={show} />);
    await screen.findByRole('heading', { name: finding.title }); fireEvent.click(screen.getByRole('button', { name: 'Show point on map' }));
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ comparisonId: null, position: { ra: report.ra, dec: report.dec } }));
  });
  it('offers discussion for leaderboard entries with null image metadata', async () => {
    const entry = { id: finding.id, findingId: finding.id, comparisonId: null, fovArcmin: null, survey: 'spherex', rank: 1, displayName: 'Observer', title: finding.title,
      rarityScore: 10, tier: null, reasons: ['Known source'], ra: report.ra, dec: report.dec, enteredAtUtc: finding.createdAtUtc };
    const client = createFindingsClient({ fetch: async () => Response.json({ board: 'daily', placeholder: false, entries: [entry] }) }); const open = vi.fn();
    render(<LeaderboardPanel dataSource={{ list: client.leaderboard }} open onGoTo={vi.fn()} onShowEvidence={open} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Point & discussion' })); expect(open).toHaveBeenCalledWith(entry);
  });
  it('keeps reference-point selection/radius through sign-in without credentials', () => {
    expect(authReturnUrl('https://viewer.test/?reviewRa=10&reviewDec=20&reviewRadius=30&reviewWise=saved-wise&code=secret#token'))
      .toBe('https://viewer.test/?reviewRa=10&reviewDec=20&reviewRadius=30&reviewWise=saved-wise');
  });
});

it('offers submission for an undated marked point and shows every catalog source on the map', async () => {
  const rows = [
    { sourceId: '42', ra: report.ra, dec: report.dec, refEpoch: 2016, pmRaCosDecMasYr: 0, pmDecMasYr: 0 },
    { main_id: 'Test SIMBAD', ra: report.ra, dec: report.dec }, { source_name: 'Test CatWISE', ra: report.ra, dec: report.dec },
    { name: 'Test cool object', ra_j2000_formula: String(report.ra), dec_j2000_formula: String(report.dec) },
    { Name: 'Test asteroid', RA: '08 55 12', DEC: '-07 15 00' }, { AllWISE: 'Test WISE', RAJ2000: report.ra, DEJ2000: report.dec },
  ];
  const review = structuredClone(report.catalogReview); review.checks.forEach((check, index) => { check.status = 'candidates'; check.rows = [rows[index]]; });
  const show = vi.fn(); const submit = vi.fn();
  render(<PointCheck point={{ position: report, frame: null, onSpherexMosaic: true }} check={async () => review} onClear={vi.fn()} onReview={submit} onShowSource={show} />);
  const list = await screen.findByRole('region', { name: 'Catalog sources near the marked point' });
  const buttons = within(list).getAllByRole('button', { name: 'Show on map' }); expect(buttons).toHaveLength(6);
  for (const button of buttons) fireEvent.click(button);
  expect(new Set(show.mock.calls.map(([source]) => source.catalog)).size).toBe(6);
  fireEvent.click(screen.getByRole('button', { name: 'Submit to leaderboard' })); expect(submit).toHaveBeenCalledOnce();
});

it('distinguishes archive gaps from measured brightness in the saved point review', () => {
  const value = structuredClone(report);
  value.brightness![1].message = 'Only a bounded image sample was checked.';
  render(<ReviewReport review={value} />);
  expect(screen.getByText('archive unavailable')).toBeTruthy(); expect(screen.getByText('no image coverage returned')).toBeTruthy();
  expect(screen.getByRole('cell', { name: /WISE/ })).toBeTruthy(); expect(screen.getByRole('cell', { name: /DSS/ })).toBeTruthy();
  expect(screen.getByText('Only a bounded image sample was checked.')).toBeTruthy();
});
