// Contract check against the Brief 4 backend's own fixture responses
// (services/findings/fixtures/responses.json). Synthetic data, no live backend.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import backend from '../../../../services/findings/fixtures/responses.json';
import { createFindingsClient, FindingsApiError, isUnauthorized } from '../api.ts';
import { toMarkers } from '../adapter.ts';
import { FindingThread } from '../FindingThread.tsx';

function clientReturning(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  return { fetch, client: createFindingsClient({ fetch }) };
}
afterEach(cleanup);

describe('backend fixture contract', () => {
  it('parses viewport pins and clusters into markers', async () => {
    const pins = await clientReturning(200, backend.pins).client.listFindings({ ra: 359.8, dec: -0.25, radiusDeg: 1, zoom: 9 });
    expect(toMarkers(pins.items)).toMatchObject({ dropped: 0, markers: [{ kind: 'pin', findingId: backend.pins.items[0].id }] });
    const clusters = await clientReturning(200, backend.clusters).client.listFindings({ ra: 359.8, dec: -0.25, radiusDeg: 1, zoom: 2 });
    expect(toMarkers(clusters.items)).toMatchObject({ dropped: 0, markers: [{ kind: 'cluster', count: 1, zoomTo: 8 }] });
  });
  it('parses create and unauthorized responses', async () => {
    const created = await clientReturning(201, backend.create).client.createFinding({ comparisonId: 'fixture-comparison', ra: 1, dec: 1, title: 't', note: 'n' });
    expect(created.id).toBe(backend.create.id);
    const err = await clientReturning(401, backend.unauthorized).client.createReply('x', { text: 't' }).catch((e) => e);
    expect(err).toBeInstanceOf(FindingsApiError);
    expect(isUnauthorized(err)).toBe(true);
    expect(err.message).toBe('Sign in to post or reply.');
  });
  it('maps a 422 for a malformed finding ID to not found', async () => {
    const err = await clientReturning(422, { code: 'invalid_request', message: 'finding_id: Input should be a valid UUID' }).client.getFinding('nope').catch((e) => e);
    expect(err).toMatchObject({ status: 404, message: 'Finding not found.' });
  });
  it('renders the backend thread fixture', async () => {
    const { client } = clientReturning(200, backend.thread);
    const evidence = vi.fn();
    render(<FindingThread client={client} session={null} findingId={backend.thread.id} onClose={() => {}} onShowEvidence={evidence} onRequestSignIn={() => {}} currentHref="https://example.test/" />);
    await screen.findByRole('heading', { name: 'Possible motion' });
    expect(screen.getByText(/Observer One · 2026-11-14 19:00 UTC/)).toBeTruthy();
    expect(screen.getByText('Observer Two')).toBeTruthy();
    expect(screen.getByText('I see the shift too.')).toBeTruthy();
    screen.getByRole('button', { name: 'Show evidence' }).click();
    expect(evidence).toHaveBeenCalledWith({ findingId: backend.thread.id, comparisonId: 'fixture-comparison', position: { ra: 359.8, dec: -0.25 }, marks: backend.thread.marks });
  });
});
