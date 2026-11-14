// Fixture-backed end-to-end flow of the findings UI (synthetic data, no backend).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FindingsPanel } from '../FindingsPanel.tsx';
import type { FindingMarker } from '../adapter.ts';
import type { EvidenceRequest, FindingsSession, FindingsViewport, SkyPosition } from '../types.ts';
import { createFixtureClient } from '../harness/fixtureClient.ts';
import type { FixtureScenario } from '../harness/fixtureClient.ts';
import { FIXTURE_COMPARISONS, PIN_ZOOM } from '../harness/fixtures.ts';

const CMP = FIXTURE_COMPARISONS[0];
const BARNARD: FindingsViewport = { ra: 269.45, dec: 4.69, radiusDeg: 1, zoom: PIN_ZOOM };

type Ctl = { scenario: FixtureScenario; session: FindingsSession };

function setup(opts: { session?: FindingsSession; viewport?: FindingsViewport; findingId?: string | null; selection?: SkyPosition | null; scenario?: FixtureScenario } = {}) {
  const ctl: Ctl = { scenario: opts.scenario ?? 'normal', session: opts.session ?? null };
  const client = createFixtureClient({ scenario: () => ctl.scenario, session: () => ctl.session, now: () => new Date('2026-11-14T18:00:00Z') });
  const spies = { markers: vi.fn<(m: FindingMarker[]) => void>(), evidence: vi.fn<(r: EvidenceRequest) => void>(), signIn: vi.fn(), selected: vi.fn() };
  let setSession: (s: FindingsSession) => void = () => {};
  function Shell() {
    const [selected, setSelected] = useState<string | null>(opts.findingId ?? null);
    const [session, _setSession] = useState<FindingsSession>(ctl.session);
    setSession = (s) => {
      ctl.session = s;
      _setSession(s);
    };
    return (
      <FindingsPanel
        client={client}
        session={session}
        comparisonId={CMP.id}
        frameIds={CMP.frameIds}
        activeFrameId={CMP.frameIds[1]}
        selection={opts.selection === undefined ? { ra: 269.45, dec: 4.69 } : opts.selection}
        viewport={opts.viewport ?? BARNARD}
        selectedFindingId={selected}
        onSelectedFindingChange={(id) => {
          spies.selected(id);
          setSelected(id);
        }}
        onMarkersChange={spies.markers}
        onShowEvidence={spies.evidence}
        onRequestSignIn={spies.signIn}
      />
    );
  }
  const r = render(<Shell />);
  return { ...r, ctl, spies, setSession: (s: FindingsSession) => act(() => setSession(s)) };
}

const lastMarkers = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0] as FindingMarker[];

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/map?code=auth-return');
});
afterEach(cleanup);

describe('activity layer', () => {
  it('emits pins when zoomed in and clusters when zoomed out', async () => {
    const a = setup();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch('3 findings in view'));
    expect(lastMarkers(a.spies.markers).every((m) => m.kind === 'pin')).toBe(true);
    cleanup();
    const b = setup({ viewport: { ...BARNARD, zoom: 2 } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/zoom in/));
    expect(lastMarkers(b.spies.markers).some((m) => m.kind === 'cluster')).toBe(true);
  });
  it('shows no-findings, failure and toggled-off states', async () => {
    setup({ scenario: 'empty' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch('No findings in this part of the sky yet.'));
    cleanup();
    const f = setup({ scenario: 'list_unavailable' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Findings unavailable/));
    f.ctl.scenario = 'normal';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch('3 findings'));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch('hidden'));
    expect(lastMarkers(f.spies.markers)).toEqual([]);
  });
});

describe('thread', () => {
  it('anonymous reader sees evidence, restores frames, copies link with both IDs', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { spies } = setup({ findingId: 'fnd_fixture_001' });
    await screen.findByRole('heading', { name: 'Bright source position differs between frames?' });
    expect(screen.getByText(/Ada \(fixture\) · 2026-11-14 15:02 UTC/)).toBeTruthy();
    expect(screen.getByText(/Synthetic fixture reply/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show evidence' }));
    expect(spies.evidence).toHaveBeenCalledWith({
      findingId: 'fnd_fixture_001',
      comparisonId: 'cmp_fixture_barnard',
      position: { ra: 269.4521, dec: 4.6934 },
      marks: [
        { frameId: 'frm_fixture_barnard_a', ra: 269.4521, dec: 4.6934 },
        { frameId: 'frm_fixture_barnard_b', ra: 269.4519, dec: 4.6941 },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await screen.findByText('Link copied.');
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/map?comparison=cmp_fixture_barnard&finding=fnd_fixture_001');
  });
  it('falls back to a manual link when clipboard is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('no'); } }, configurable: true });
    setup({ findingId: 'fnd_fixture_002' });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    const input = (await screen.findByLabelText('Copy this link manually')) as HTMLInputElement;
    expect(input.value).toContain('finding=fnd_fixture_002');
  });
  it('renders markup as plain text', async () => {
    const { container } = setup({ findingId: 'fnd_fixture_003' });
    await screen.findByRole('heading', { name: '<b>Markup in a title stays plain text</b>' });
    expect(container.querySelector('b, script')).toBeNull();
  });
  it('reports a missing finding', async () => {
    setup({ findingId: 'nope' });
    expect((await screen.findByRole('alert')).textContent).toMatch('Finding not found.');
  });
  it('signed-out reply saves draft, requests sign-in, and restores it on return', async () => {
    const a = setup({ findingId: 'fnd_fixture_002' });
    fireEvent.change(await screen.findByLabelText('Reply'), { target: { value: 'Checked the flags.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to reply' }));
    expect(a.spies.signIn).toHaveBeenCalled();
    cleanup(); // simulate the redirect: page reloads signed in
    setup({ findingId: 'fnd_fixture_002', session: { displayName: 'Grace (fixture)' } });
    const box = (await screen.findByLabelText('Reply')) as HTMLTextAreaElement;
    expect(box.value).toBe('Checked the flags.');
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const list = await screen.findByText('Checked the flags.', { selector: 'p' });
    expect(within(list.closest('li')!).getByText('Grace (fixture)')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Replies (1)' })).toBeTruthy();
    expect(((await screen.findByLabelText('Reply')) as HTMLTextAreaElement).value).toBe('');
  });
  it('failed reply keeps the text and shows an error', async () => {
    setup({ findingId: 'fnd_fixture_002', session: { displayName: 'G' }, scenario: 'write_fails' });
    fireEvent.change(await screen.findByLabelText('Reply'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/temporarily unavailable/);
    expect((screen.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe('hello');
  });
});

describe('composer', () => {
  it('requires a selected point and title', async () => {
    setup({ selection: null, session: { displayName: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post finding' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toEqual(['Select a point on the map first.', 'Add a short title.', 'Describe what you saw or what you want checked.']);
  });
  it('signed-in post with a mark opens the new thread and refreshes pins', async () => {
    const { spies } = setup({ session: { displayName: 'Ada (fixture)' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch('3 findings'));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New question' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Is this real?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark this position on the current frame' }));
    expect(screen.getByText('frm_fixture_barnard_b')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Post finding' }));
    await screen.findByRole('heading', { name: 'New question' });
    expect(spies.selected).toHaveBeenCalledWith('fnd_fixture_new_1');
    await waitFor(() => expect(lastMarkers(spies.markers).some((m) => m.kind === 'pin' && m.findingId === 'fnd_fixture_new_1')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Show evidence' }));
    expect(spies.evidence.mock.calls[0][0].marks).toEqual([{ frameId: 'frm_fixture_barnard_b', ra: 269.45, dec: 4.69 }]);
  });
  it('signed-out post keeps the draft through sign-in; expired session keeps it too', async () => {
    const a = setup();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Draft title' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Draft note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to post' }));
    expect(a.spies.signIn).toHaveBeenCalled();
    cleanup();
    setup({ session: { displayName: 'A' }, scenario: 'session_expired' });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Draft title');
    expect((screen.getByLabelText('Note') as HTMLTextAreaElement).value).toBe('Draft note');
    fireEvent.click(screen.getByRole('button', { name: 'Post finding' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/session expired/);
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Draft title');
  });
});
