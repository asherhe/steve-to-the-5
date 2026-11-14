import { describe, expect, it, vi } from 'vitest';
import { toMarkers, activateMarker, describeActivity } from '../adapter.ts';
import { buildReplayUrl, readReplayParams } from '../links.ts';
import { clampViewport, normalizeRa, validateFindingDraft, validateReplyText, LIMITS } from '../validation.ts';
import { createFindingsClient, buildListQuery, FindingsApiError, isUnauthorized } from '../api.ts';
import { saveDraft, loadFindingDraft, loadReplyDraft, MAX_AGE_MS } from '../draft.ts';
import { copyText } from '../clipboard.ts';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe('adapter', () => {
  it('maps pins and clusters, drops malformed/duplicate rows, bounds output', () => {
    const { markers, dropped } = toMarkers([
      { id: 'a', ra: 10, dec: 5, title: 'A' },
      { id: 'a', ra: 10, dec: 5, title: 'A' },
      { ra: 370, dec: 1, count: 3, zoomTo: 8 },
      { ra: 1, dec: 95, id: 'bad', title: 'x' },
      { ra: NaN, dec: 0, id: 'nan', title: 'x' },
      null,
      { ra: 1, dec: 1 },
    ]);
    expect(markers.map((m) => m.kind)).toEqual(['pin', 'cluster']);
    expect(markers[1]).toMatchObject({ ra: 10, count: 3 });
    expect(dropped).toBe(5);
    expect(toMarkers(Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, ra: i, dec: 0, title: '' })), 4).markers).toHaveLength(4);
  });
  it('activates pins as thread selection and clusters as zoom', () => {
    const h = { onSelectFinding: vi.fn(), onZoomTo: vi.fn() };
    activateMarker({ kind: 'pin', key: 'k', findingId: 'f1', ra: 1, dec: 2, title: '' }, h);
    activateMarker({ kind: 'cluster', key: 'c', ra: 1, dec: 2, count: 2, zoomTo: 9 }, h);
    expect(h.onSelectFinding).toHaveBeenCalledWith('f1');
    expect(h.onZoomTo).toHaveBeenCalledWith({ ra: 1, dec: 2, zoom: 9 });
  });
  it('describes empty and clustered states', () => {
    expect(describeActivity({ status: 'ready', markers: [], dropped: 0, error: null })).toMatch(/No findings/);
    expect(describeActivity({ status: 'ready', markers: [{ kind: 'cluster', key: 'c', ra: 0, dec: 0, count: 4, zoomTo: 8 }], dropped: 0, error: null })).toMatch(/4 findings.*zoom in/);
  });
});

describe('links', () => {
  it('copy link carries both IDs and drops other params', () => {
    const url = buildReplayUrl('https://ex.test/app?code=secret&x=1#h', { comparisonId: 'cmp 1', findingId: 'f/2' });
    expect(url).toBe('https://ex.test/app?comparison=cmp+1&finding=f%2F2');
    expect(readReplayParams(new URL(url).search)).toEqual({ comparisonId: 'cmp 1', findingId: 'f/2' });
  });
});

describe('validation', () => {
  it('normalizes RA and bounds viewport', () => {
    expect(normalizeRa(-10)).toBe(350);
    expect(normalizeRa(360)).toBe(0);
    expect(clampViewport({ ra: 0, dec: 91, radiusDeg: 1, zoom: 1 })).toBeNull();
    expect(clampViewport({ ra: 0, dec: 0, radiusDeg: 999, zoom: 1 })?.radiusDeg).toBe(LIMITS.maxRadiusDeg);
  });
  it('rejects marks on frames outside the comparison', () => {
    const e = validateFindingDraft({ comparisonId: 'c', selection: { ra: 1, dec: 1 }, title: 't', note: '', marks: [{ frameId: 'x', ra: 1, dec: 1 }], frameIds: ['a'] });
    expect(e.marks).toBeTruthy();
    expect(validateReplyText('  ')).toBeTruthy();
    expect(validateReplyText('x'.repeat(LIMITS.replyMaxChars + 1))).toBeTruthy();
  });
});

describe('api client', () => {
  it('builds contract query and only sends auth on writes', async () => {
    expect(buildListQuery({ ra: -1, dec: 2, radiusDeg: 0.5, zoom: 8 })).toBe('ra=359&dec=2&radiusDeg=0.5&zoom=8');
    const calls: [string, RequestInit][] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init!]);
      return new Response(JSON.stringify(url.includes('replies') ? { id: 'r', text: 't', author: { displayName: 'a' }, createdAt: '' } : { items: [] }), { status: 200 });
    });
    const c = createFindingsClient({ fetch, getAuthHeaders: () => ({ Authorization: 'Bearer t' }) });
    await c.listFindings({ ra: 1, dec: 1, radiusDeg: 1, zoom: 1 });
    await c.createReply('f', { text: 't' });
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined();
    expect((calls[1][1].headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(calls[1][0]).toBe('/api/findings/f/replies');
  });
  it('maps {code, message} errors and network failures', async () => {
    const c = createFindingsClient({ fetch: async () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Sign in' }), { status: 401 }) });
    const err = await c.createFinding({ comparisonId: 'c', ra: 1, dec: 1, title: 't', note: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(FindingsApiError);
    expect(isUnauthorized(err)).toBe(true);
    const down = createFindingsClient({ fetch: async () => { throw new TypeError('x'); } });
    await expect(down.getFinding('f')).rejects.toMatchObject({ code: 'network_error' });
  });
});

describe('drafts and clipboard', () => {
  it('round-trips and expires drafts', () => {
    const s = memStorage();
    saveDraft({ kind: 'finding', comparisonId: 'c', title: 't', note: 'n', selection: { ra: 1, dec: 2 }, marks: [{ frameId: 'f', ra: 1, dec: 2 }] }, s, 0);
    expect(loadFindingDraft('c', s, 10)).toMatchObject({ title: 't', marks: [{ frameId: 'f' }] });
    saveDraft({ kind: 'reply', findingId: 'f', text: 'hi' }, s, 0);
    expect(loadReplyDraft('f', s, MAX_AGE_MS + 1)).toBeNull();
    expect(s.m.size).toBe(1);
  });
  it('copyText never throws', async () => {
    expect(await copyText('x', null)).toBe(false);
    expect(await copyText('x', { writeText: async () => { throw new Error('denied'); } })).toBe(false);
  });
});
