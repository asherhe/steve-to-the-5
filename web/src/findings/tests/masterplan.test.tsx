import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { CandidateReviewPane, type CandidateReviewSlotProps } from '../CandidateReviewPane';
import { AccountControls, AccountProvider, useAccount } from '../Account';
import { authReturnUrl, type AuthGateway } from '../auth';
import { parseReview } from '../reviewContract';
import { ReviewReport } from '../ReviewReport';
import { createFindingsClient, FindingsApiError } from '../api';
import { buildReplayUrl } from '../links';
import { createArchiveDataSource } from '../../viewer/archive';
import { useComparisonLoader } from '../../viewer/useComparisonLoader';
import { LeaderboardPanel } from '../../leaderboard/LeaderboardPanel';
import fixture from '../../../../services/findings/fixtures/candidate-flow.json';
import evidence from '../../../../fixtures/archive/real/response.json';

const report = parseReview(fixture.review);
const comparison = (await createArchiveDataSource(async () => Response.json(evidence)).loadSaved(evidence.comparison.id))!;
const session = { userId: 'observer-1', displayName: 'Observer 1' };
function setup(overrides: Partial<CandidateReviewSlotProps> = {}, fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/reviews') ? fixture.review : { id: 'new-finding' }))) {
  const client = createFindingsClient({ fetch, getAuthHeaders: () => ({ Authorization: 'Bearer fixture' }) });
  const p = { client, session, comparison, frame: comparison.frames[0], position: { ra: report.ra, dec: report.dec }, survey: 'spherex' as const, synthetic: false, onPrepareSignIn: vi.fn(), onRequestSignIn: vi.fn(), onCreated: vi.fn(), ...overrides };
  return { p, fetch };
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

describe('review contract and identity', () => {
  it('accepts the exported backend snapshot and equivalent UTC representations', () => {
    expect(report.catalogReview.checks).toHaveLength(6);
    const r = structuredClone(fixture.review); r.catalogReview.observedAtUtc = r.observedAtUtc.replace('Z', '+00:00');
    expect(parseReview(r).score).toBe(20);
  });
  it.each(['offline', 'duplicate', 'wrong-point', 'wrong-time', 'invalid-status', 'too-many-rows'])('rejects %s review payloads', kind => {
    const r = structuredClone(fixture.review);
    if (kind === 'offline') r.catalogReview.mode = 'offline';
    if (kind === 'duplicate') r.catalogReview.checks[0].catalog = 'SIMBAD';
    if (kind === 'wrong-point') r.catalogReview.ra = 0;
    if (kind === 'wrong-time') r.catalogReview.observedAtUtc = '2020-01-01T00:00:00Z';
    if (kind === 'invalid-status') r.catalogReview.checks[0].status = 'discovery';
    if (kind === 'too-many-rows') (r.catalogReview.checks[0].rows as unknown[]) = Array.from({ length: 51 }, () => ({}));
    expect(() => parseReview(r)).toThrow();
  });
  it('never accepts another frame in response to a review request', async () => {
    const client = createFindingsClient({ fetch: async () => Response.json(fixture.review) });
    await expect(client.createReview({ ...fixture.request, survey: 'spherex', frameId: 'other' })).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it.each(['unknown-survey', 'wrong-review'])('rejects %s in a saved finding', async kind => {
    const body = { id: 'finding', authorDisplayName: 'Observer', comparisonId: report.comparisonId, survey: kind === 'unknown-survey' ? 'other' : 'wise', candidateReview: kind === 'wrong-review' ? report : null };
    const client = createFindingsClient({ fetch: async () => Response.json(body) });
    await expect(client.getFinding(body.id)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('shows all six states, raw records, scopes, citations, and bounded participation copy', () => {
    const r = structuredClone(report);
    r.catalogReview.checks[0].status = 'unavailable';
    r.catalogReview.checks[1].status = 'partial';
    r.catalogReview.checks[2].status = 'candidates';
    r.catalogReview.checks[2].rows = [{ source_id: '9007199254740993', reference: 'https://example.org/paper' }];
    r.catalogReview.checks[3].status = 'skipped';
    render(<ReviewReport review={r} />);
    expect(screen.getByText(/Unavailable — no absence inferred/)).toBeTruthy();
    expect(screen.getByText(/Partial results/)).toBeTruthy();
    expect(screen.getByText('9007199254740993')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://example.org/paper', hidden: true })).toHaveAttribute('href', 'https://example.org/paper');
    expect(screen.getByText(/No discovery has been verified/)).toBeTruthy();
  });
});

describe('candidate workflow', () => {
  it('sign-in is requested before any persisted review', () => {
    const { p, fetch } = setup();
    render(<CandidateReviewPane {...p} session={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to submit' }));
    expect(p.onPrepareSignIn).toHaveBeenCalledOnce(); expect(p.onRequestSignIn).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it('posts the server review ID and locked original-frame mark, without a client score', async () => {
    const { p, fetch } = setup();
    render(<CandidateReviewPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    await screen.findByText(/^20 points/);
    expect(screen.getByRole('button', { name: /Remove mark/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Check this point' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Could this be an image artifact?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post finding' }));
    await waitFor(() => expect(p.onCreated).toHaveBeenCalledWith('new-finding', comparison.id, 'spherex'));
    const body = JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ reviewId: report.id, survey: 'spherex', marks: [{ frameId: report.frameId, ra: report.ra, dec: report.dec }] });
    expect(body).not.toHaveProperty('score'); expect(body).not.toHaveProperty('author');
  });
  it('invalidates a completed review when time, point, radius, or account changes', async () => {
    const { p } = setup(); const ui = render(<CandidateReviewPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' })); await screen.findByText(/^20 points/);
    ui.rerender(<CandidateReviewPane {...p} frame={comparison.frames[1]} />);
    expect(screen.queryByText('50 participation points')).toBeNull();
    ui.rerender(<CandidateReviewPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' })); await screen.findByText(/^20 points/);
    fireEvent.change(screen.getByLabelText('Catalog search radius'), { target: { value: 300 } });
    expect(screen.queryByText('50 participation points')).toBeNull();
    ui.rerender(<CandidateReviewPane {...p} session={{ ...session, userId: 'different' }} />);
    expect(screen.queryByRole('button', { name: 'Post finding' })).toBeNull();
  });
  it('ignores a stale review response after selection changed, even if fetch ignores abort', async () => {
    let respond!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(r => { respond = r; }));
    const { p } = setup({}, fetch);
    const ui = render(<CandidateReviewPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    ui.rerender(<CandidateReviewPane {...p} position={{ ra: report.ra + .001, dec: report.dec }} />);
    respond(Response.json(fixture.review));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check and score this point' })).toBeEnabled());
    expect(screen.queryByText('50 participation points')).toBeNull();
  });
  it.each([true, false])('prevents reference/synthetic selection from ranking (%s)', synthetic => {
    const { p, fetch } = setup(synthetic ? { synthetic: true } : { position: null });
    render(<CandidateReviewPane {...p} />);
    expect(screen.queryByRole('button', { name: 'Check and score this point' })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps text on duplicate rejection and gives session-expiry recovery', async () => {
    let expired = false;
    const fetch = vi.fn(async (url: string) => url.endsWith('/reviews') ? Response.json(fixture.review) : Response.json({ code: expired ? 'unauthorized' : 'duplicate_candidate', message: expired ? 'Sign in' : 'This candidate has already been posted.' }, { status: expired ? 401 : 409 }));
    const { p } = setup({}, fetch); render(<CandidateReviewPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' })); await screen.findByLabelText('Title');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft preserved' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'A question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post finding' })); await screen.findByText('This candidate has already been posted.');
    expect(screen.getByLabelText('Title')).toHaveValue('Draft preserved');
    expired = true; fireEvent.click(screen.getByRole('button', { name: 'Post finding' })); await screen.findByRole('button', { name: 'Sign in again' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' })); expect(p.onRequestSignIn).toHaveBeenCalled();
  });
  it('shows catalog failure as failure with retry rather than an empty report', async () => {
    const { p } = setup({}, vi.fn(async () => Response.json({ code: 'catalogs_unavailable', message: 'Catalog review could not complete.' }, { status: 503 })));
    render(<CandidateReviewPane {...p} />); fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
    await screen.findByRole('alert'); expect(screen.queryByText(/^\d+ points/)).toBeNull(); expect(screen.getByRole('button', { name: 'Check and score this point' })).toBeEnabled();
  });
});

describe('replay and public ranking', () => {
  it('preserves WISE and strips credentials in copied links', () => {
    const url = buildReplayUrl('https://viewer.test/?view=wise&code=secret#access_token=secret', { comparisonId: 'cmp', findingId: 'f' });
    expect(url).toBe('https://viewer.test/?view=wise&comparison=cmp&finding=f');
    expect(buildReplayUrl(url, { comparisonId: 'sph', survey: 'spherex' })).not.toContain('view=wise');
    expect(authReturnUrl('https://viewer.test/?comparison=c&reviewFrame=f&reviewRa=1&reviewDec=2&code=secret#token')).toBe('https://viewer.test/?comparison=c&reviewFrame=f&reviewRa=1&reviewDec=2');
  });
  it('finding-only WISE links redirect before calling the SPHEREx store', async () => {
    const source = { loadSaved: vi.fn(), search: vi.fn() };
    const loadFinding = async () => ({ id: 'f', comparisonId: comparison.id, survey: 'wise' as const, title: 'Title', note: '', marks: [] });
    const { result } = renderHook(() => useComparisonLoader({ source, survey: 'spherex', resolveName: vi.fn(), loadFinding, onFocus: vi.fn(), initial: { kind: 'saved', id: '', findingId: 'f' } }));
    await waitFor(() => expect(result.current.preview.kind).toBe('redirect')); expect(source.loadSaved).not.toHaveBeenCalled();
  });
  it('mismatched IDs fail before either evidence store is called', async () => {
    const source = { loadSaved: vi.fn(), search: vi.fn() };
    const loadFinding = async () => ({ id: 'f', comparisonId: comparison.id, survey: 'wise' as const, title: 'Title', note: '', marks: [] });
    const { result } = renderHook(() => useComparisonLoader({ source, resolveName: vi.fn(), loadFinding, onFocus: vi.fn(), initial: { kind: 'saved', id: 'wrong', findingId: 'f' } }));
    await waitFor(() => expect(result.current.preview.kind).toBe('error')); expect(source.loadSaved).not.toHaveBeenCalled();
  });
  it('loads real participation entries without auth and refreshes after submission', async () => {
    const fetch = vi.fn(async () => Response.json({ ...fixture.leaderboard, board: 'daily' }));
    const auth = vi.fn(); const client = createFindingsClient({ fetch, getAuthHeaders: auth }); const source = { list: client.leaderboard };
    const evidence = vi.fn(); const ui = render(<LeaderboardPanel dataSource={source} open onGoTo={vi.fn()} onShowEvidence={evidence} refresh={0} />);
    await screen.findByText('20 points'); expect(auth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Evidence & discussion' })); expect(evidence.mock.calls[0][0].survey).toBe('spherex');
    ui.rerender(<LeaderboardPanel dataSource={source} open onGoTo={vi.fn()} onShowEvidence={evidence} refresh={1} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
  it('rejects invented production leaderboard rows', async () => {
    const c = createFindingsClient({ fetch: async () => Response.json({ ...fixture.leaderboard, placeholder: true }) });
    await expect(c.leaderboard('allTime')).rejects.toBeInstanceOf(FindingsApiError);
  });
});

it('handles sign-in in place and signs out without touching evidence state', async () => {
  let listener: (next: typeof session | null) => void = () => {};
  const gateway: AuthGateway = { initialize: vi.fn(async () => null), subscribe: cb => { listener = cb; return () => {}; }, headers: vi.fn(async () => ({})), sendEmail: vi.fn(async () => {}), verifyCode: vi.fn(async () => listener(session)), signOut: vi.fn(async () => listener(null)) };
  function Harness() { const account = useAccount(); return <><span>{account.session?.displayName ?? 'Anonymous'}</span><AccountControls mode="button" /><AccountControls mode="pane" /></>; }
  // Pane layout APIs are browser-only; these fakes do not assert real geometry.
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  render(<AccountProvider gateway={gateway}><Harness /></AccountProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); await screen.findByLabelText('Email');
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'observer@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in email' })); await screen.findByLabelText('Email code');
  fireEvent.change(screen.getByLabelText('Email code'), { target: { value: '123456' } }); fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));
  await screen.findByText('Observer 1'); expect(gateway.verifyCode).toHaveBeenCalledWith('observer@example.test', '123456');
  fireEvent.click(screen.getByRole('button', { name: 'Account' })); fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); await screen.findByText('Anonymous');
});
