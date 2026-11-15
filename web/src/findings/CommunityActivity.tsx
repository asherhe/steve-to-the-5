import { useEffect, useState } from 'react';
import { ActivityToggle } from './ActivityToggle';
import type { FindingsClient } from './api';
import type { FindingMarker } from './adapter';
import type { FindingsViewport } from './types';
import { useFindingsActivity } from './useFindingsActivity';

export interface CommunityActivityProps {
  viewport: FindingsViewport | null;
  onMarkersChange(markers: FindingMarker[]): void;
  onActivate(marker: FindingMarker): void;
  refresh: number;
}
export function CommunityActivity(p: CommunityActivityProps & { client: FindingsClient }) {
  const [enabled, setEnabled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const state = useFindingsActivity(p.client, enabled, p.viewport, 250, p.refresh + attempt);
  useEffect(() => { p.onMarkersChange(state.markers); }, [state.markers, p.onMarkersChange]);
  return <>
    <ActivityToggle enabled={enabled} onChange={setEnabled} state={state} onRetry={() => setAttempt(n => n + 1)} />
    {enabled && <ul className="community-list">{state.markers.map(marker => <li key={marker.key}><button onClick={() => p.onActivate(marker)}>{marker.kind === 'pin' ? `Open ${marker.title}` : `Zoom to ${marker.count} findings`}</button></li>)}</ul>}
  </>;
}
