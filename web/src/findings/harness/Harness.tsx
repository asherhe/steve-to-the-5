// Standalone development harness: fixture client, stub map/marker callbacks.
import { useMemo, useState } from 'react';
import { activateMarker } from '../adapter.ts';
import type { FindingMarker } from '../adapter.ts';
import { FindingsPanel } from '../FindingsPanel.tsx';
import { readReplayParams } from '../links.ts';
import type { EvidenceRequest, FindingsSession, SkyPosition } from '../types.ts';
import { createFixtureClient, FIXTURE_SCENARIOS } from './fixtureClient.ts';
import type { FixtureScenario } from './fixtureClient.ts';
import { FIXTURE_COMPARISONS, PIN_ZOOM } from './fixtures.ts';

export function Harness() {
  const initial = readReplayParams(globalThis.location?.search ?? '');
  const [scenario, setScenario] = useState<FixtureScenario>('normal');
  const [session, setSession] = useState<FindingsSession>(null);
  const [comparisonIdx, setComparisonIdx] = useState(Math.max(0, FIXTURE_COMPARISONS.findIndex((c) => c.id === initial.comparisonId)));
  const cmp = FIXTURE_COMPARISONS[comparisonIdx];
  const [activeFrameId, setActiveFrameId] = useState<string>(cmp.frameIds[0]);
  const [selection, setSelection] = useState<SkyPosition | null>({ ra: 269.4521, dec: 4.6934 });
  const [view, setView] = useState({ ra: 269.45, dec: 4.69, radiusDeg: 1, zoom: PIN_ZOOM });
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(initial.findingId);
  const [markers, setMarkers] = useState<FindingMarker[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 20));

  // Refs keep the client stable while scenario/session change.
  const refs = useMemo(() => ({ scenario: 'normal' as FixtureScenario, session: null as FindingsSession }), []);
  refs.scenario = scenario;
  refs.session = session;
  const client = useMemo(() => createFixtureClient({ scenario: () => refs.scenario, session: () => refs.session, latencyMs: 300 }), [refs]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,380px)', gap: 16, padding: 16, fontFamily: 'system-ui' }}>
      <div>
        <h2>Findings harness (synthetic fixtures)</h2>
        <fieldset>
          <legend>Stub app shell</legend>
          <label>
            Scenario{' '}
            <select value={scenario} onChange={(e) => setScenario(e.target.value as FixtureScenario)} aria-label="Scenario">
              {FIXTURE_SCENARIOS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>{' '}
          <button type="button" onClick={() => setSession(session ? null : { displayName: 'Harness user (fixture)' })}>
            {session ? 'Sign out' : 'Sign in (stub)'}
          </button>{' '}
          <label>
            Comparison{' '}
            <select
              value={comparisonIdx}
              onChange={(e) => {
                const i = Number(e.target.value);
                setComparisonIdx(i);
                setActiveFrameId(FIXTURE_COMPARISONS[i].frameIds[0]);
              }}
            >
              {FIXTURE_COMPARISONS.map((c, i) => (
                <option key={c.id} value={i}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            Frame{' '}
            <select value={activeFrameId} onChange={(e) => setActiveFrameId(e.target.value)}>
              {cmp.frameIds.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <p>
            View RA {view.ra} Dec {view.dec} r={view.radiusDeg}° zoom{' '}
            <input type="number" value={view.zoom} onChange={(e) => setView({ ...view, zoom: Number(e.target.value) })} style={{ width: 50 }} aria-label="Zoom" />{' '}
            <button type="button" onClick={() => setView({ ra: 76.96, dec: 30.4, radiusDeg: 1, zoom: view.zoom })}>Go to RW Aur</button>{' '}
            <button type="button" onClick={() => setView({ ra: 269.45, dec: 4.69, radiusDeg: 1, zoom: view.zoom })}>Go to Barnard</button>{' '}
            <button type="button" onClick={() => setSelection(null)}>Clear selection</button>{' '}
            <button type="button" onClick={() => setSelection({ ra: view.ra, dec: view.dec })}>Select view centre</button>
          </p>
        </fieldset>
        <h3>Stub map markers ({markers.length})</h3>
        <ul aria-label="Stub markers">
          {markers.map((m) => (
            <li key={m.key}>
              <button
                type="button"
                onClick={() =>
                  activateMarker(m, {
                    onSelectFinding: (id) => {
                      setSelectedFindingId(id);
                      note(`select finding ${id}`);
                    },
                    onZoomTo: (z) => {
                      setView((v) => ({ ...v, ra: z.ra, dec: z.dec, zoom: z.zoom }));
                      note(`zoomTo ${z.zoom}`);
                    },
                  })
                }
              >
                {m.kind === 'pin' ? `Pin: ${m.title}` : `Cluster of ${m.count}`}
              </button>
            </li>
          ))}
        </ul>
        <h3>Callback log</h3>
        <ol aria-label="Callback log">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      </div>
      <FindingsPanel
        client={client}
        session={session}
        comparisonId={cmp.id}
        frameIds={cmp.frameIds}
        activeFrameId={activeFrameId}
        selection={selection}
        viewport={view}
        selectedFindingId={selectedFindingId}
        onSelectedFindingChange={setSelectedFindingId}
        onMarkersChange={setMarkers}
        onShowEvidence={(r: EvidenceRequest) => note(`showEvidence ${r.comparisonId} ${r.marks.map((m) => m.frameId).join(',') || '(no marks)'}`)}
        onRequestSignIn={() => note('requestSignIn (draft saved)')}
      />
    </div>
  );
}
