import type { FindingListItem } from './types.ts';
import { LIMITS, isFiniteNumber, isValidSkyPosition, normalizeRa } from './validation.ts';

/** Marker data handed to the viewer's marker primitives (same sky coordinates as image positions). */
export type PinMarker = { kind: 'pin'; key: string; findingId: string; ra: number; dec: number; title: string };
export type ClusterMarker = { kind: 'cluster'; key: string; ra: number; dec: number; count: number; zoomTo: number };
export type FindingMarker = PinMarker | ClusterMarker;

export function isClusterItem(item: FindingListItem): item is Extract<FindingListItem, { count: number }> {
  return typeof (item as { count?: unknown }).count === 'number' && !('id' in item);
}

/**
 * Convert API list items into markers. Malformed rows are dropped rather than
 * rendered at a wrong position; output is bounded to maxMarkers.
 */
export function toMarkers(items: readonly unknown[], maxMarkers: number = LIMITS.maxMarkers): { markers: FindingMarker[]; dropped: number } {
  const markers: FindingMarker[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') {
      dropped++;
      continue;
    }
    const r = raw as Record<string, unknown>;
    const pos = isFiniteNumber(r.ra) && isFiniteNumber(r.dec) ? { ra: normalizeRa(r.ra), dec: r.dec } : null;
    if (!pos || !isValidSkyPosition(pos)) {
      dropped++;
      continue;
    }
    let m: FindingMarker | null = null;
    if (typeof r.id === 'string' && r.id && typeof r.title === 'string') {
      m = { kind: 'pin', key: `pin:${r.id}`, findingId: r.id, title: r.title, ...pos };
    } else if (isFiniteNumber(r.count) && Number.isInteger(r.count) && r.count > 0 && isFiniteNumber(r.zoomTo)) {
      m = { kind: 'cluster', key: `cluster:${pos.ra.toFixed(5)}:${pos.dec.toFixed(5)}:${r.count}`, count: r.count, zoomTo: r.zoomTo, ...pos };
    }
    if (!m || seen.has(m.key)) {
      dropped++;
      continue;
    }
    if (markers.length >= maxMarkers) {
      dropped++;
      continue;
    }
    seen.add(m.key);
    markers.push(m);
  }
  return { markers, dropped };
}

/** What a click on a marker means: open a thread, or zoom the map into a cluster. */
export function activateMarker(
  marker: FindingMarker,
  handlers: { onSelectFinding(id: string): void; onZoomTo(target: { ra: number; dec: number; zoom: number }): void },
): void {
  if (marker.kind === 'pin') handlers.onSelectFinding(marker.findingId);
  else handlers.onZoomTo({ ra: marker.ra, dec: marker.dec, zoom: marker.zoomTo });
}

export function summarizeMarkers(markers: readonly FindingMarker[]): { pins: number; clusters: number; total: number } {
  let pins = 0;
  let clusters = 0;
  let total = 0;
  for (const m of markers) {
    if (m.kind === 'pin') {
      pins++;
      total++;
    } else {
      clusters++;
      total += m.count;
    }
  }
  return { pins, clusters, total };
}

export type ActivityStatus = 'off' | 'idle' | 'loading' | 'ready' | 'error';

export function describeActivity(state: { status: ActivityStatus; markers: readonly FindingMarker[]; dropped: number; error: string | null }): string {
  switch (state.status) {
    case 'off':
      return 'Community findings are hidden.';
    case 'idle':
      return 'Findings load once the map has a position.';
    case 'loading':
      return 'Loading findings…';
    case 'error':
      return `Findings unavailable: ${state.error ?? 'unknown error'}`;
    case 'ready': {
      const s = summarizeMarkers(state.markers);
      if (s.total === 0) return 'No findings in this part of the sky yet.';
      let text = `${s.total} finding${s.total === 1 ? '' : 's'} in view`;
      if (s.clusters > 0) text += ' (zoom in to see individual pins)';
      if (state.dropped > 0) text += `. ${state.dropped} item${state.dropped === 1 ? '' : 's'} not shown`;
      return `${text}.`;
    }
  }
}
