import { useEffect, useState } from 'react';
import type { FindingsClient } from './api.ts';
import type { FindingMarker } from './adapter.ts';
import { ActivityToggle } from './ActivityToggle.tsx';
import { Composer } from './Composer.tsx';
import { FindingThread } from './FindingThread.tsx';
import type { EvidenceMark, EvidenceRequest, FindingsSession, FindingsViewport, SkyPosition } from './types.ts';
import { useFindingsActivity } from './useFindingsActivity.ts';

export type FindingsPanelProps = {
  client: FindingsClient;
  session: FindingsSession;
  /** From the app shell. */
  comparisonId: string | null;
  frameIds: readonly string[];
  activeFrameId: string | null;
  selection: SkyPosition | null;
  viewport: FindingsViewport | null;
  /** Controlled: `finding` query parameter. */
  selectedFindingId: string | null;
  onSelectedFindingChange(id: string | null): void;
  /** Hand markers to the viewer's marker primitives (stub in the harness). */
  onMarkersChange(markers: FindingMarker[]): void;
  onShowEvidence(req: EvidenceRequest): void;
  onRequestSignIn(): void;
  activityEnabled?: boolean;
  onActivityEnabledChange?(v: boolean): void;
};

export function FindingsPanel(p: FindingsPanelProps) {
  const [localEnabled, setLocalEnabled] = useState(true);
  const enabled = p.activityEnabled ?? localEnabled;
  const [marks, setMarks] = useState<EvidenceMark[]>([]);
  const [reload, setReload] = useState(0);
  const activity = useFindingsActivity(p.client, enabled, p.viewport, 250, reload);

  // Markers go to the map only while the layer is on.
  useMarkerSync(activity.markers, p.onMarkersChange);

  return (
    <div className="findings-panel">
      <ActivityToggle
        enabled={enabled}
        onChange={(v) => (p.onActivityEnabledChange ? p.onActivityEnabledChange(v) : setLocalEnabled(v))}
        state={activity}
        onRetry={() => setReload((n) => n + 1)}
      />
      {p.selectedFindingId ? (
        <FindingThread
          client={p.client}
          session={p.session}
          findingId={p.selectedFindingId}
          onClose={() => p.onSelectedFindingChange(null)}
          onShowEvidence={p.onShowEvidence}
          onRequestSignIn={p.onRequestSignIn}
        />
      ) : (
        <Composer
          client={p.client}
          session={p.session}
          comparisonId={p.comparisonId}
          frameIds={p.frameIds}
          activeFrameId={p.activeFrameId}
          selection={p.selection}
          marks={marks}
          onMarksChange={setMarks}
          onRequestSignIn={p.onRequestSignIn}
          onCreated={(id) => {
            setReload((n) => n + 1);
            p.onSelectedFindingChange(id);
          }}
        />
      )}
    </div>
  );
}

function useMarkerSync(markers: FindingMarker[], cb: (m: FindingMarker[]) => void) {
  useEffect(() => cb(markers), [markers]); // eslint-disable-line react-hooks/exhaustive-deps
}
