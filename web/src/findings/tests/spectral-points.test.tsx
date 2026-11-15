import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parsePointReview } from '../reviewContract';
import { ReviewReport } from '../ReviewReport';
import { createFindingsClient } from '../api';
import fixture from '../../../../services/findings/fixtures/spectral-flow.json';

afterEach(cleanup);
describe('spectral v4 points', () => {
  it('accepts a server-produced score with known-object bonuses and renders the evidence', () => {
    const review = parsePointReview(fixture.review);
    expect(review.score).toBe(30);
    render(<ReviewReport review={review} />);
    expect(screen.getByText(/Possibly contains water/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /brightness by wavelength/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the exact WISE blink used' })).toHaveAttribute('href', '?view=wise&comparison=synthetic-wise-blink');
  });
  it.each(['score', 'nan', 'species', 'no-source', 'wise', 'identity', 'hash', 'duplicate-part'])('rejects invalid %s evidence', key => {
    const r = structuredClone(fixture.review);
    if (key === 'score') r.score += 5;
    if (key === 'nan') r.spectral.samples[0].uncertaintyMjySr = NaN;
    if (key === 'species') r.spectral.features[0].bands[0].status = 'insufficient';
    if (key === 'no-source') r.spectral.sourceDetected = false;
    if (key === 'wise') r.wiseVariability.significance = 0;
    if (key === 'identity') r.wiseComparisonId = 'another';
    if (key === 'hash') r.spectral.samples[0].sourceSha256 = 'changed';
    if (key === 'duplicate-part') r.scoreBreakdown[1] = r.scoreBreakdown[0];
    expect(() => parsePointReview(r)).toThrow(/invalid point review/);
  });
  it('rejects a score for a different requested WISE blink', async () => {
    const client = createFindingsClient({ fetch: vi.fn(async () => Response.json(fixture.review)), getAuthHeaders: () => ({ Authorization: 'Bearer synthetic' }) });
    await expect(client.pointReview({ ...fixture.request, wiseComparisonId: 'different' })).rejects.toThrow();
  });
});
