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
export function ReviewReport({ review }: { review: CandidateReview }) {
  return <section aria-label="Saved candidate review" className="review-report">
    <h3>{review.score} participation points</h3>
    <p>Points reward review effort, regardless of match count. No discovery has been verified.</p>
    <details><summary>Score breakdown · {review.scoreVersion}</summary><ul>{review.reasons.map(x => <li key={x}>{x}</li>)}</ul></details>
    <p>Search radius {review.radiusArcsec}″ · RA {review.ra.toFixed(6)}°, Dec {review.dec.toFixed(6)}°</p>
    <p>Image time <time dateTime={review.observedAtUtc}>{review.observedAtUtc}</time>. Review saved <time dateTime={review.reviewedAtUtc}>{review.reviewedAtUtc}</time>.</p>
    <p>Nearby records are not verified identities or image detections. Catalog positions use different epochs; motion can move a counterpart outside this cone.</p>
    {review.catalogReview.checks.map(check => <details className="review-check" key={check.catalog}>
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
    </details>)}
    <details><summary>Review limitations</summary><ul>{[...review.limitations, ...review.catalogReview.limitations].map((x, i) => <li key={i}>{x}</li>)}</ul></details>
  </section>;
}
