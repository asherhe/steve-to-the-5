import { useEffect, useRef, useState } from 'react';
import type { ReviewClient } from './api';
import { FindingsApiError, isUnauthorized, messageFor } from './api';
import type { AuthSession } from './auth';
import type { FrameRef, PointReview, SkyPosition } from './types';
import { isValidSkyPosition, LIMITS, charCount } from './validation';
import { ReviewReport } from './ReviewReport';

export interface PointSubmissionSlotProps {
  position: SkyPosition | null;
  frame?: FrameRef | null;
  defaultRadiusArcsec?: number;
  synthetic?: boolean;
  simulation?: boolean;
  wiseComparisonId?: string | null;
  wiseLoading?: boolean;
  wiseMessage?: string;
  onGetWiseBlink?(): void;
  onPrepareSignIn(): void;
  onCreated(findingId: string): void;
  onShowDuplicate?(findingId: string): void;
}
type Props = PointSubmissionSlotProps & { client: ReviewClient; session: AuthSession | null; onRequestSignIn(): void };

export function PointSubmissionPane(p: Props) {
  if (!isValidSkyPosition(p.position)) return <p role="status">Double-click the map to choose a point first.</p>;
  if (p.synthetic && !p.simulation) return <p role="status">Synthetic image points cannot be submitted. Choose a point on the reference map or a real observation.</p>;
  const selection = JSON.stringify([p.position.ra, p.position.dec, p.frame?.survey ?? null, p.frame?.comparisonId ?? null, p.frame?.frameId ?? null, p.defaultRadiusArcsec ?? 30, p.wiseComparisonId ?? null]);
  return <section className="candidate-review" aria-label="Submit a checked point">
    <p>Get a WISE blink for this point, then calculate its score.</p>
    <details><summary>Scoring and duplicate rules</summary>
      <p>Base: 10 points for a catalog-listed source; otherwise 20 if bright in two surveys, or 0. Known objects qualify for bonuses too: +10 for a usable SPHEREx signal, then +5 each for tentative water, methane and hydrogen absorption patterns, and +5 for possible variable brightness in the WISE blink. Maximum 50 points. Zero-point submissions are welcome.</p>
      <p>Each substance needs both of its specified spectral regions to pass. These are provisional pattern matches requiring follow-up, not confirmed composition.</p>
      <p>One entry per object: the same catalog source or a point within 15″ of an existing entry is blocked. Points are for discussion, not a discovery.</p>
    </details>
    {p.simulation && <p className="example-notice">Local demo: SPHEREx spectra and WISE brightness are measured from real survey data. Posts and rankings are saved only in this browser. No sign-in is needed.</p>}
    <div className="example-notice" role="status">
      {p.wiseComparisonId ? <p>WISE blink ready. Its saved first and last visits will be measured.</p> : <>
        <p>{p.wiseLoading ? 'Loading the WISE blink… Scoring unlocks when two real dated visits cover this point.' : p.wiseMessage || 'A real WISE blink with two dated visits is required before scoring.'}</p>
        {p.onGetWiseBlink && <button type="button" disabled={p.wiseLoading} onClick={p.onGetWiseBlink}>Get WISE blink</button>}
      </>}
    </div>
    <Selection key={`${selection}:${p.session?.userId ?? 'anonymous'}`} {...p} position={p.position} selectionKey={selection} />
  </section>;
}

function readDraft(key: string): { title: string; note: string } {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? '{}');
    return { title: typeof value.title === 'string' ? value.title : '', note: typeof value.note === 'string' ? value.note : '' };
  } catch { return { title: '', note: '' }; }
}

function Selection(p: Props & { position: SkyPosition; selectionKey: string }) {
  const draftKey = `spherex.point-draft.v3:${p.selectionKey}`;
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [report, setReport] = useState<PointReview | null>(null);
  const [phase, setPhase] = useState<'idle' | 'reviewing' | 'posting'>('idle');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [conflict, setConflict] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  function change(next: typeof draft) {
    setDraft(next);
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* In-memory editing still works. */ }
  }
  function signIn() { p.onPrepareSignIn(); p.onRequestSignIn(); }
  async function run() {
    if (phase !== 'idle') return;
    if (!p.wiseComparisonId) return;
    if (!p.session) { signIn(); return; }
    const ctl = new AbortController(); controller.current = ctl;
    setPhase('reviewing'); setError(''); setExpired(false); setConflict(false); setReport(null);
    try {
      const value = await p.client.pointReview({ ra: p.position.ra, dec: p.position.dec, radiusArcsec: p.defaultRadiusArcsec ?? 30, ...(p.frame ? { frame: p.frame } : {}), ...(p.wiseComparisonId ? { wiseComparisonId: p.wiseComparisonId } : {}) }, ctl.signal);
      if (mounted.current && !ctl.signal.aborted) setReport(value);
    } catch (cause) {
      if (mounted.current && !ctl.signal.aborted) {
        setExpired(isUnauthorized(cause));
        setError(isUnauthorized(cause) ? 'Sign in again. Your point and draft are kept.' : messageFor(cause, cause instanceof Error ? cause.message : 'The point could not be scored. Try again.'));
      }
    } finally { if (mounted.current && !ctl.signal.aborted) setPhase('idle'); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (phase !== 'idle' || !report || report.duplicate || conflict) return;
    if (!p.session) { signIn(); return; }
    if (!draft.title.trim() || !draft.note.trim()) { setError('Enter a title and note.'); return; }
    if (charCount(draft.title) > LIMITS.titleMaxChars || charCount(draft.note) > LIMITS.noteMaxChars) { setError('Shorten the title or note to the limits shown.'); return; }
    setPhase('posting'); setError(''); setExpired(false);
    try {
      const value = await p.client.createFinding({ ra: p.position.ra, dec: p.position.dec, title: draft.title.trim(), note: draft.note.trim(), reviewId: report.id });
      if (!mounted.current) return;
      try { sessionStorage.removeItem(draftKey); } catch { /* No stored draft. */ }
      p.onCreated(value.id);
    } catch (cause) {
      if (!mounted.current) return;
      setExpired(isUnauthorized(cause));
      setConflict(cause instanceof FindingsApiError && cause.code === 'already_on_leaderboard');
      setError(isUnauthorized(cause) ? 'Sign in again. Your point and draft are kept.' : messageFor(cause, 'The point could not be submitted. Your draft is kept.'));
    } finally { if (mounted.current) setPhase('idle'); }
  }
  return <>
    <p>RA {p.position.ra.toFixed(6)}°, Dec {p.position.dec.toFixed(6)}° · radius {p.defaultRadiusArcsec ?? 30}″.
      {p.frame ? ' Marked on a dated frame; its saved observation time is used for the asteroid check.' : ' Reference-map point; no observation time is assumed.'}</p>
    {phase === 'reviewing' ? <>
      <p role="status">{p.simulation ? 'Running simulated submission with catalog checks…' : 'Checking catalogs, measuring SPHEREx wavelengths and the saved WISE blink… This can take up to three minutes.'}</p>
      <button type="button" onClick={() => { controller.current?.abort(); setPhase('idle'); }}>Cancel review</button>
    </> : <button type="button" className="primary" disabled={phase === 'posting' || !p.wiseComparisonId} onClick={() => void run()}>
      {!p.session ? 'Sign in to submit' : report ? 'Score again' : 'Check and score this point'}
    </button>}
    {error && <p role="alert">{error}</p>}
    {expired && <button type="button" onClick={signIn}>Sign in again</button>}
    {conflict && <button type="button" onClick={() => void run()}>Find existing entry</button>}
    {report && <>
      <ReviewReport review={report} compact />
      {report.duplicate ? <div className="example-notice" role="status">
        <p>Already on the leaderboard: “{report.duplicate.title}” by {report.duplicate.displayName}.
          {report.duplicate.sameObject ? ' This is the same catalog object.' : ` This entry is ${report.duplicate.separationArcsec?.toFixed(1) ?? 'within 15'}″ from the point.`} Join its discussion instead.</p>
        {p.onShowDuplicate && <button type="button" onClick={() => p.onShowDuplicate!(report.duplicate!.findingId)}>Open existing discussion</button>}
      </div> : <form aria-label="Submit this point" onSubmit={submit} noValidate>
        <label>Title<input value={draft.title} onChange={e => change({ ...draft, title: e.target.value })} disabled={phase === 'posting'} /></label>
        <small>{charCount(draft.title)}/{LIMITS.titleMaxChars}</small>
        <label>Note<textarea value={draft.note} onChange={e => change({ ...draft, note: e.target.value })} disabled={phase === 'posting'} /></label>
        <small>{charCount(draft.note)}/{LIMITS.noteMaxChars}</small>
        <button type="submit" className="primary" disabled={phase !== 'idle' || conflict || expired}>{phase === 'posting' ? 'Posting…' : 'Post finding'}</button>
      </form>}
    </>}
  </>;
}
