import { useEffect, useState } from 'react';
import type { FindingsClient } from './api.ts';
import { isAbortError, messageFor } from './api.ts';
import { toMarkers } from './adapter.ts';
import type { ActivityStatus, FindingMarker } from './adapter.ts';
import type { FindingsViewport } from './types.ts';

export type ActivityState = { status: ActivityStatus; markers: FindingMarker[]; dropped: number; error: string | null };

const OFF: ActivityState = { status: 'off', markers: [], dropped: 0, error: null };

/** Loads pins/clusters for the viewport while enabled. Stale requests are aborted. */
export function useFindingsActivity(client: FindingsClient, enabled: boolean, viewport: FindingsViewport | null, debounceMs = 250, reloadKey = 0): ActivityState {
  const [state, setState] = useState<ActivityState>(OFF);
  const { ra, dec, radiusDeg, zoom } = viewport ?? { ra: NaN, dec: NaN, radiusDeg: NaN, zoom: NaN };
  const hasViewport = viewport !== null;

  useEffect(() => {
    if (!enabled) return setState(OFF);
    if (!hasViewport) return setState({ status: 'idle', markers: [], dropped: 0, error: null });
    const ctl = new AbortController();
    setState((s) => ({ ...s, status: 'loading', error: null }));
    const t = setTimeout(() => {
      client
        .listFindings({ ra, dec, radiusDeg, zoom }, ctl.signal)
        .then((r) => {
          const { markers, dropped } = toMarkers(r.items);
          setState({ status: 'ready', markers, dropped, error: null });
        })
        .catch((e) => {
          if (isAbortError(e) || ctl.signal.aborted) return;
          setState({ status: 'error', markers: [], dropped: 0, error: messageFor(e, 'Could not load findings.') });
        });
    }, debounceMs);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [client, enabled, hasViewport, ra, dec, radiusDeg, zoom, debounceMs, reloadKey]);

  return state;
}
