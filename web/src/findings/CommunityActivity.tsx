import { useEffect, useMemo, useState } from 'react';
import { ActivityToggle } from './ActivityToggle';
import type { FindingsClient } from './api';
import type { FindingMarker } from './adapter';
import type { FindingsViewport } from './types';
import { useFindingsActivity } from './useFindingsActivity';
import { pinMeta, sortLabels, sortMarkers, type CommunitySort } from './community';
import './community.css';

export interface CommunityActivityProps {
  viewport: FindingsViewport | null;
  /** Markers in list order; the map numbers pins in this order. */
  onMarkersChange(markers: FindingMarker[]): void;
  onActivate(marker: FindingMarker): void;
  refresh: number;
  /** Marker key hovered or focused here or on the map; both highlight it. */
  highlighted?: string | null;
  onHighlight?(key: string | null): void;
  /** The finding whose thread is open; its row and pin stay marked. */
  activeFindingId?: string | null;
}

const sorts = Object.keys(sortLabels) as CommunitySort[];

export function CommunityActivity(p: CommunityActivityProps & { client: FindingsClient }) {
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sort, setSort] = useState<CommunitySort>('newest');
  const state = useFindingsActivity(p.client, enabled, p.viewport, 250, p.refresh + attempt);
  const center = p.viewport ? { ra: p.viewport.ra, dec: p.viewport.dec } : null;
  const markers = useMemo(() => sortMarkers(state.markers, sort, center),
    // The centre is compared by value; a new viewport object with the same centre keeps the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.markers, sort, center?.ra, center?.dec]);
  useEffect(() => { p.onMarkersChange(markers); }, [markers, p.onMarkersChange]);
  const pins = markers.filter((m) => m.kind === 'pin');
  const now = Date.now();
  let number = 0;

  return (
    <div className="community">
      <ActivityToggle enabled={enabled} onChange={setEnabled} state={state} onRetry={() => setAttempt((n) => n + 1)} />
      {enabled && pins.length > 1 && (
        <div className="community-sort" role="group" aria-label="Sort findings">
          {sorts.map((option) => (
            <button key={option} type="button" aria-pressed={sort === option} onClick={() => setSort(option)}>
              {sortLabels[option]}
            </button>
          ))}
        </div>
      )}
      {enabled && markers.length > 0 && (
        <ol className="community-list" onMouseLeave={() => p.onHighlight?.(null)}>
          {markers.map((marker) => {
            const isPin = marker.kind === 'pin';
            if (isPin) number += 1;
            const active = isPin && marker.findingId === p.activeFindingId;
            return (
              <li key={marker.key} className="community-entry" data-kind={marker.kind}
                data-highlighted={p.highlighted === marker.key || undefined} aria-current={active ? 'true' : undefined}>
                <button type="button" className="community-row"
                  aria-label={isPin ? `Open finding ${number}: ${marker.title}` : `Zoom in to see ${marker.count} findings`}
                  onClick={() => p.onActivate(marker)}
                  onMouseEnter={() => p.onHighlight?.(marker.key)} onFocus={() => p.onHighlight?.(marker.key)}
                  onBlur={() => p.onHighlight?.(null)}>
                  <span className="community-badge" aria-hidden="true">{isPin ? number : marker.count}</span>
                  <span className="community-body">
                    <span className="community-title">{isPin ? marker.title : `Zoom in to see ${marker.count} findings`}</span>
                    {isPin && (
                      <span className="community-meta">
                        {pinMeta(marker, center, now).map((part) => <span key={part}>{part}</span>)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {enabled && state.status === 'ready' && markers.length === 0 && (
        <p className="community-hint">Double-click the map to check a point. Findings you post appear here.</p>
      )}
    </div>
  );
}
