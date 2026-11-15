import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { mockFindings, mockAuth } from '../mock';
import { PointSubmissionPane } from '../PointSubmissionPane';
import fixture from '../../../../services/findings/fixtures/spectral-flow.json';

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });

it('requires a loaded WISE blink in the demo too', async () => {
  const load = vi.fn();
  render(<PointSubmissionPane simulation position={fixture.request} client={mockFindings}
    session={await mockAuth.initialize()} onGetWiseBlink={load} onPrepareSignIn={vi.fn()}
    onRequestSignIn={vi.fn()} onCreated={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Check and score this point' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Get WISE blink' }));
  expect(load).toHaveBeenCalledOnce();
});

it('shows measured demo bonuses and saves the same score to the local ranking, blocking duplicate rewards', async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(fixture.review));
  vi.stubGlobal('fetch', fetch);
  render(<PointSubmissionPane simulation position={fixture.request} wiseComparisonId={fixture.request.wiseComparisonId}
    client={mockFindings} session={await mockAuth.initialize()} onPrepareSignIn={vi.fn()}
    onRequestSignIn={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check and score this point' }));
  await screen.findByRole('heading', { name: /^30 points/ });
  expect(screen.getByText(/Possibly contains water/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe('/api/findings/demo/points/review');
  const review = await mockFindings.pointReview(fixture.request);
  const input = { ra: review.ra, dec: review.dec, title: 'Demo spectrum', note: 'Follow up', reviewId: review.id };
  await mockFindings.createFinding(input);
  expect((await mockFindings.leaderboard('allTime')).entries[0].rarityScore).toBe(30);
  await expect(mockFindings.createFinding(input)).rejects.toMatchObject({ code: 'already_on_leaderboard' });
  expect((await mockFindings.pointReview(fixture.request)).duplicate?.sameObject).toBe(true);
});

it('reports a demo measurement outage without substituting a base-only or fixture score', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'unavailable', message: 'Archive unavailable.' }, { status: 503 })));
  await expect(mockFindings.pointReview(fixture.request)).rejects.toThrow(/Archive unavailable/);
});
