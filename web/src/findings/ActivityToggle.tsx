import { describeActivity } from './adapter.ts';
import type { ActivityState } from './useFindingsActivity.ts';

export function ActivityToggle(props: { enabled: boolean; onChange(next: boolean): void; state: ActivityState; onRetry?(): void }) {
  const { enabled, onChange, state, onRetry } = props;
  return (
    <div className="findings-activity">
      <label>
        <input type="checkbox" role="switch" checked={enabled} onChange={(e) => onChange(e.target.checked)} /> Community findings
      </label>
      <p role="status" aria-live="polite" data-status={state.status}>
        {describeActivity(state)}
      </p>
      {state.status === 'error' && onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
