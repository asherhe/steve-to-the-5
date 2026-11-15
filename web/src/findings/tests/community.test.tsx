import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toMarkers, type FindingMarker, type PinMarker } from '../adapter.ts';
import { pinMeta, relativeTime, sortMarkers } from '../community.ts';
import { CommunityActivity } from '../CommunityActivity.tsx';
import type { FindingsClient } from '../api.ts';

const now = Date.parse('2026-11-15T12:00:00Z');
const pin = (id: string, extra: Partial<PinMarker> = {}): PinMarker =>
  ({ kind: 'pin', key: `pin:${id}`, findingId: id, ra: 10, dec: 0, title: `Finding ${id}`, ...extra });

describe('pin summaries', () => {
  it('keeps well-formed summary fields and drops malformed ones', () => {
    const { markers } = toMarkers([
      { id: 'a', ra: 1, dec: 1, title: 'A', authorDisplayName: ' Ada ', createdAtUtc: '2026-11-15T10:00:00Z', replyCount: 2, survey: 'wise' },
      { id: 'b', ra: 1, dec: 1, title: 'B', authorDisplayName: '', createdAtUtc: 'yesterday', replyCount: -1, survey: 'other' },
      { id: 'c', ra: 1, dec: 1, title: 'C' },
    ]);
    expect(markers[0]).toMatchObject({ author: 'Ada', createdAtUtc: '2026-11-15T10:00:00Z', replyCount: 2, survey: 'wise' });
    for (const marker of markers.slice(1)) {
      expect(marker).not.toHaveProperty('author');
      expect(marker).not.toHaveProperty('createdAtUtc');
      expect(marker).not.toHaveProperty('replyCount');
      expect(marker).not.toHaveProperty('survey');
    }
  });
  it('builds the meta line from the fields it has, and never says "open"', () => {
    const center = { ra: 10, dec: 0.01 };
    expect(pinMeta(pin('a', { author: 'Ada', createdAtUtc: '2026-11-15T10:00:00Z', replyCount: 1, survey: 'spherex' }), center, now))
      .toEqual(['Ada', '2 h ago', '1 reply', 'SPHEREx', '36″ from centre']);
    expect(pinMeta(pin('b'), null, now)).toEqual([]);
    expect(relativeTime('2026-10-01T00:00:00Z', now)).toBe('2026-10-01');
  });
});

describe('sorting', () => {
  const center = { ra: 10, dec: 0 };
  const markers: FindingMarker[] = [
    { kind: 'cluster', key: 'c', ra: 11, dec: 0, count: 3, zoomTo: 8 },
    pin('far', { ra: 10, dec: 0.5, createdAtUtc: '2026-11-15T11:00:00Z', replyCount: 0 }),
    pin('near', { ra: 10, dec: 0.1, createdAtUtc: '2026-11-14T11:00:00Z', replyCount: 5 }),
    pin('old', { ra: 10, dec: 0.2 }),
  ];
  const ids = (list: FindingMarker[]) => list.map((m) => (m.kind === 'pin' ? m.findingId : m.key));
  it('puts pins first in the chosen order, groups last', () => {
    expect(ids(sortMarkers(markers, 'newest', center))).toEqual(['far', 'near', 'old', 'c']);
    expect(ids(sortMarkers(markers, 'replies', center))).toEqual(['near', 'far', 'old', 'c']);
    expect(ids(sortMarkers(markers, 'nearest', center))).toEqual(['near', 'old', 'far', 'c']);
  });
});

describe('Community findings pane', () => {
  it('lists titles without an "Open" prefix, numbers rows, and links hover to the map', async () => {
    const client = { listFindings: vi.fn(async () => ({ items: [
      { id: 'a', ra: 10, dec: 0, title: 'Bright patch shifts north', authorDisplayName: 'Ada', createdAtUtc: new Date().toISOString(), replyCount: 2, survey: 'spherex' },
      { id: 'b', ra: 10.01, dec: 0, title: 'Faint flicker' },
    ] })) } as unknown as FindingsClient;
    const onMarkersChange = vi.fn();
    const onHighlight = vi.fn();
    const onActivate = vi.fn();
    render(<CommunityActivity client={client} viewport={{ ra: 10, dec: 0, radiusDeg: 0.1, zoom: 12 }} refresh={0}
      onMarkersChange={onMarkersChange} onActivate={onActivate} onHighlight={onHighlight} activeFindingId="b" />);
    expect(screen.getByRole('status').textContent).toMatch(/hidden/);
    fireEvent.click(screen.getByRole('switch', { name: 'Show on map' }));
    const first = await screen.findByRole('button', { name: 'Open finding 1: Bright patch shifts north' });
    expect(screen.queryByText(/^open /i)).toBeNull();
    expect(screen.getByText('Bright patch shifts north')).toBeTruthy();
    expect(screen.getByText('2 replies')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Sort findings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open finding 2: Faint flicker' }).closest('li')?.getAttribute('aria-current')).toBe('true');
    fireEvent.mouseEnter(first);
    expect(onHighlight).toHaveBeenLastCalledWith('pin:a');
    fireEvent.click(first);
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ findingId: 'a' }));
    await waitFor(() => expect(onMarkersChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ findingId: 'a' }), expect.objectContaining({ findingId: 'b' }),
    ]));
  });
});
