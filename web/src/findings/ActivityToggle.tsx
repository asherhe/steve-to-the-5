import { describeActivity } from './adapter.ts';
import type { ActivityState } from './useFindingsActivity.ts';
import './community.css';

/** Header of the Community findings list: a show-on-map switch and the layer's status. */
export function ActivityToggle(props: { enabled: boolean; onChange(next: boolean): void; state: ActivityState; onRetry?(): void }) {
  const { enabled, onChange, state, onRetry } = props;
  return (
    <div className="findings-activity">
      <button type="button" role="switch" aria-checked={enabled} className="activity-switch" onClick={() => onChange(!enabled)}>
        <span className="activity-switch-track" aria-hidden="true"><span className="activity-switch-thumb" /></span>
        Show on map
      </button>
      <p role="status" aria-live="polite" data-status={state.status} className="activity-status">
        {describeActivity(state)}
      </p>
      {state.status === 'error' && onRetry ? (
        <button type="button" className="activity-retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
