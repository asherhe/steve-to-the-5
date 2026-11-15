import type { CandidateReview, CatalogCheck } from './types';
import { safeSourceUrl } from './reviewContract';
const labels: Record<CatalogCheck['status'], string> = {
  candidates: 'Nearby records returned', no_candidates: 'No records in this cone', partial: 'Partial results — search incomplete',
  unavailable: 'Unavailable — no absence inferred', skipped: 'Not checked',
};
function Value({ value }: { value: unknown }) {
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—');
  const url = typeof value === 'string' ? safeSourceUrl(value) : undefined;
  return url ? <a href={url} target="_blank" rel="noreferrer">{text}</a> : <>{text}</>;
}
const classLabels: Record<NonNullable<CandidateReview['classification']>, string> = {
  known: 'known object', uncatalogued: 'not in any of the six catalogs', incomplete: 'catalog check incomplete',
};
const brightnessStatus: Record<string, string> = { outside: 'outside this frame', unmeasurable: 'could not be measured', unavailable: 'frame unavailable' };
export function ReviewReport({ review }: { review: CandidateReview }) {
  return <section aria-label="Saved candidate review" className="review-report">
    <h3>{review.score} points{review.classification ? ` · ${classLabels[review.classification]}` : ''}</h3>
    <ul>{review.reasons.map(x => <li key={x}>{x}</li>)}</ul>
    <p>Points sort submitted points for discussion. No discovery has been verified. Rules: {review.scoreVersion}.</p>
    {(review.brightness ?? []).length > 0 && <details open><summary>Brightness at the point ({review.brightness!.filter(m => m.bright).length} of {review.brightness!.length} frames bright)</summary>
      <table className="review-brightness"><thead><tr><th>Survey</th><th>Frame time</th><th>Local peak</th></tr></thead><tbody>
        {review.brightness!.map(m => <tr key={`${m.comparisonId}-${m.frameId}`}><td>{m.survey === 'wise' ? 'WISE' : 'SPHEREx'}</td>
          <td>{m.observedAtUtc ? <time dateTime={m.observedAtUtc}>{m.observedAtUtc.slice(0, 10)}</time> : '—'}</td>
          <td>{m.status === 'measured' ? `${m.snr?.toFixed(1)}σ${m.bright ? ' · bright' : ''}` : brightnessStatus[m.status]}</td></tr>)}
      </tbody></table>
      <p>Bright means a local peak at least 5σ above the surrounding pixels in that frame's saved FITS: a contrast test, not a flux or detection measurement.</p>
    </details>}
    <p>Search radius {review.radiusArcsec}″ · RA {review.ra.toFixed(6)}°, Dec {review.dec.toFixed(6)}°</p>
    <p>Image time <time dateTime={review.observedAtUtc}>{review.observedAtUtc}</time>. Review saved <time dateTime={review.reviewedAtUtc}>{review.reviewedAtUtc}</time>.</p>
    <p>Nearby records are not verified identities or image detections. Catalog positions use different epochs; motion can move a counterpart outside this cone.</p>
    <CatalogChecks checks={review.catalogReview.checks} />
    <details><summary>Review limitations</summary><ul>{[...review.limitations, ...review.catalogReview.limitations].map((x, i) => <li key={i}>{x}</li>)}</ul></details>
  </section>;
}

/** One expandable entry per catalog: status, scope, provenance, limitations and every returned row. */
export function CatalogChecks({ checks }: { checks: CatalogCheck[] }) {
  return <>{checks.map(check => <details className="review-check" key={check.catalog}>
      <summary><strong>{check.catalog}</strong> · {labels[check.status]} ({check.rows?.length ?? 0})</summary>
      <p>{check.scope}</p>
      {check.servedBy && <p>Served by {check.servedBy}{check.retrievedAtUtc ? ` · retrieved ${check.retrievedAtUtc}` : ''}</p>}
      {safeSourceUrl(check.sourceUrl) && <p><a href={safeSourceUrl(check.sourceUrl)} target="_blank" rel="noreferrer">Original {check.catalog} query / data</a></p>}
      {(check.limitations ?? []).map(x => <p key={x}>{x}</p>)}
      {check.catalog === 'UltracoolSheet' && <p>Credit: UltracoolSheet compilation and the original papers referenced in each record. <a href="https://zenodo.org/records/15802304" target="_blank" rel="noreferrer">Release, column definitions and acknowledgements</a>.</p>}
      {(check.rows ?? []).map((row, index) => <details key={index} className="review-record"><summary>Record {index + 1}{typeof row.main_id === 'string' ? ` · ${row.main_id}` : typeof row.name === 'string' ? ` · ${row.name}` : ''}</summary>
        <dl>{Object.entries(row).map(([key, value]) => {
          const column = check.columns?.find(col => col.name === key);
          return <div key={key}><dt>{key}{column?.unit ? ` (${column.unit})` : ''}{column?.description && <small>{column.description}</small>}</dt><dd><Value value={value} /></dd></div>;
        })}</dl>
      </details>)}
      {check.responseSha256 && <details><summary>Response fingerprint</summary><code>{check.responseSha256}</code></details>}
    </details>)}</>;
}
