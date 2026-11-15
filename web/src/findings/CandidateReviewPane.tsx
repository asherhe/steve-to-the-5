import { useEffect, useRef, useState } from 'react';
import type { Comparison, ComparisonFrame, SkyPosition } from '../viewer/comparison';
import type { ReviewClient } from './api';
import { isUnauthorized, messageFor } from './api';
import type { AuthSession } from './auth';
import type { CandidateReview, EvidenceMark, Survey } from './types';
import { Composer } from './Composer';
import { ReviewReport } from './ReviewReport';

export interface CandidateReviewSlotProps {
  comparison: Comparison | null;
  frame: ComparisonFrame | null;
  position: SkyPosition | null;
  survey: Survey;
  synthetic: boolean;
  simulation?: boolean;
  onPrepareSignIn(): void;
  onCreated(findingId: string, comparisonId: string, survey: Survey): void;
}
type Props = CandidateReviewSlotProps & { client: ReviewClient; session: AuthSession | null; onRequestSignIn(): void };
export function CandidateReviewPane(props: Props) {
  const [radius, setRadius] = useState(120);
  const ready = !!props.comparison && !!props.frame && !!props.position;
  const real = !props.synthetic && ['real_archive', 'saved_real_example'].includes(String(props.comparison?.provenance?.evidenceKind));
  const key = JSON.stringify([props.survey, props.comparison?.id, props.frame?.id, props.position, props.session?.userId, radius]);
  return <section className="candidate-review" aria-label="Review a candidate">
    <p>Look for nearby cold substellar-object candidates, including brown dwarfs. A selected point is not an identification or a detection.</p>
    <details><summary>Before reviewing</summary><ul>
      <li>Explore roughly 4–5 µm as a starting hint. The wavelength map combines dates; it is not a dated spectrum or a temperature measurement.</li>
      <li>Blink comparable dated frames. Check image quality and whether the point stays visible.</li>
      <li>Switch to WISE for infrared context and optionally DSS for optical context. Neither detection nor Gaia absence is required.</li>
    </ul></details>
    {!ready ? <p role="status">Load dated images, then select a point inside the dated overlay or Compare details image. Reference-map clicks cannot create a review.</p> : !real ? <p role="status">Reviews require saved real dated images. Synthetic fixtures cannot be submitted or ranked.</p> : <>
      <p>Selected {props.survey === 'wise' ? 'WISE' : 'SPHEREx'} frame <time dateTime={props.frame!.observedAtUtc}>{props.frame!.observedAtUtc}</time>.</p>
      {props.frame!.observationStartUtc && props.frame!.observationEndUtc && <p>Exposure interval: {props.frame!.observationStartUtc} to {props.frame!.observationEndUtc}. SkyBoT uses the displayed time and a geocentric viewpoint.</p>}
      <label>Catalog search radius<select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value={30}>30 arcsec</option><option value={120}>120 arcsec (default)</option><option value={300}>300 arcsec (wider context)</option></select></label>
      {props.simulation ? <p className="example-notice">Local simulation: catalog checks are skipped; posts and participation points are simulated and saved only in this browser. No sign-in or live catalog query occurs.</p> : <p>Six independent searches; nearby records are not automatic matches. VizieR checks AllWISE only. Fast motion and different catalog epochs can cause missed associations.</p>}
      <ReviewSelection key={key} {...props} radius={radius} />
    </>}
  </section>;
}
function ReviewSelection(p: Props & { radius: number }) {
  const [report, setReport] = useState<CandidateReview | null>(null);
  const [marks, setMarks] = useState<EvidenceMark[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function signIn() { p.onPrepareSignIn(); p.onRequestSignIn(); }
  async function run() {
    if (busy) return;
    if (!p.session) { signIn(); return; }
    const ctl = new AbortController(); controller.current = ctl;
    setBusy(true); setError(''); setExpired(false); setReport(null);
    try {
      const result = await p.client.createReview({ comparisonId: p.comparison!.id, frameId: p.frame!.id, survey: p.survey, ...p.position!, radiusArcsec: p.radius }, ctl.signal);
      if (ctl.signal.aborted) return;
      setReport(result); setMarks([{ frameId: result.frameId, ra: result.ra, dec: result.dec }]);
    } catch (e) {
      if (ctl.signal.aborted) return;
      setExpired(isUnauthorized(e));
      setError(isUnauthorized(e) ? 'Sign in again to review. Your selection is kept.' : messageFor(e, 'The review did not complete. Retry; no absence or catalog points are inferred.'));
    } finally { if (!ctl.signal.aborted) setBusy(false); }
  }
  return <>
    <p>RA {p.position!.ra.toFixed(6)}°, Dec {p.position!.dec.toFixed(6)}°. Changing the point, frame, survey, account or radius starts a separate review.</p>
    {busy ? <><p role="status">{p.simulation ? 'Preparing local simulation…' : 'Checking six catalogs… This can take up to 40 seconds.'}</p><button onClick={() => { controller.current?.abort(); setBusy(false); }}>Cancel review</button></> : <button className="primary" onClick={() => void run()}>{p.simulation ? report ? 'Run a new simulation' : 'Run simulated catalog checks' : p.session ? report ? 'Run a new review' : 'Run six catalog checks' : 'Sign in to review'}</button>}
    {error && <p role="alert">{error}</p>}
    {expired && <button onClick={signIn}>Sign in again</button>}
    {report && <>
      <ReviewReport review={report} />
      <Composer client={p.client} session={p.session} comparisonId={report.comparisonId} frameIds={p.comparison!.frames.map(f => f.id)} activeFrameId={report.frameId} selection={{ ra: report.ra, dec: report.dec }} marks={marks} onMarksChange={setMarks} survey={report.survey} reviewId={report.id} requiredMark={{ frameId: report.frameId, ra: report.ra, dec: report.dec }} onRequestSignIn={signIn} onCreated={id => p.onCreated(id, report.comparisonId, report.survey)} />
    </>}
  </>;
}
