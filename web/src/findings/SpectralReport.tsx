import type { PointReview } from './types';
import { safeSourceUrl } from './reviewContract';

export function SpectralReport({ review }: { review: PointReview }) {
  const spectrum = review.spectral, wise = review.wiseVariability;
  if (!spectrum) return null;
  const samples = spectrum.samples ?? [];
  const measured = samples.filter(m => m.status === 'measured');
  const minWave = Math.min(...measured.map(m => m.wavelengthUm!));
  const maxWave = Math.max(...measured.map(m => m.wavelengthUm!));
  const minValue = Math.min(0, ...measured.map(m => m.brightnessMjySr! - m.uncertaintyMjySr!));
  const maxValue = Math.max(...measured.map(m => m.brightnessMjySr! + m.uncertaintyMjySr!));
  const x = (v: number) => 48 + (v - minWave) / Math.max(.01, maxWave - minWave) * 410;
  const y = (v: number) => 170 - (v - minValue) / Math.max(.001, maxValue - minValue) * 140;
  return <section aria-label="Spectral and variability evidence">
    <h4>SPHEREx wavelength measurements</h4>
    <p>{spectrum.message}</p>
    <p>{spectrum.sourceDetected ? 'SPHEREx signal qualifies for spectral bonuses.' : 'SPHEREx eligibility has not been established.'} {spectrum.independentChannels} independent wavelength samples.</p>
    {measured.length >= 2 && <figure style={{ margin: '1rem 0' }}>
      <svg viewBox="0 0 500 210" role="img" aria-label="SPHEREx aperture brightness by wavelength, with one-sigma uncertainty bars" style={{ width: '100%', background: '#111827', borderRadius: 8 }}>
        <title>SPHEREx aperture brightness and uncertainty</title>
        <path d="M48 25V170H470" stroke="#94a3b8" fill="none" />
        <text x="50" y="16" fill="#cbd5e1" fontSize="11">Aperture brightness (MJy/sr)</text>
        <text x="48" y="188" fill="#cbd5e1" fontSize="11">{minWave.toFixed(2)}</text>
        <text x="430" y="188" fill="#cbd5e1" fontSize="11">{maxWave.toFixed(2)}</text>
        <text x="205" y="204" fill="#cbd5e1" fontSize="11">Wavelength (µm)</text>
        <text x="3" y="34" fill="#cbd5e1" fontSize="10">{maxValue.toPrecision(2)}</text>
        <text x="3" y="170" fill="#cbd5e1" fontSize="10">{minValue.toPrecision(2)}</text>
        {measured.map((m, i) => <g key={i}>
          <title>{m.wavelengthUm!.toFixed(3)} µm: {m.brightnessMjySr!.toPrecision(3)} ± {m.uncertaintyMjySr!.toPrecision(2)} MJy/sr, {m.observedAtUtc}</title>
          <line x1={x(m.wavelengthUm!)} x2={x(m.wavelengthUm!)} y1={y(m.brightnessMjySr! - m.uncertaintyMjySr!)} y2={y(m.brightnessMjySr! + m.uncertaintyMjySr!)} stroke="#38bdf8" />
          <circle cx={x(m.wavelengthUm!)} cy={y(m.brightnessMjySr!)} r="3" fill="#7dd3fc" />
        </g>)}
      </svg>
      <figcaption>Fixed aperture, local background removed. Points may come from different dates; gaps are not interpolated. Full values and dates are below.</figcaption>
    </figure>}
    {(spectrum.features ?? []).map(f => <details key={f.key} open={f.points > 0}>
      <summary>{f.points > 0 ? `+5 · Possibly contains ${f.label}` : `${f.label} · ${f.status === 'insufficient' ? 'insufficient coverage' : 'pattern not supported'}`}</summary>
      <p>A tentative absorption-pattern match is not a confirmed chemical identification. Both regions must pass the provisional screen.</p>
      <ul>{f.bands.map(b => <li key={b.name}>{b.name} ({b.startUm.toFixed(3)}–{b.endUm.toFixed(3)} µm): {b.message}
        {b.depthFraction != null && b.significance != null && <> Depth {(b.depthFraction * 100).toFixed(1)}%; screen statistic {b.significance.toFixed(1)}σ.</>}
      </li>)}</ul>
      {safeSourceUrl(f.sourceUrl) && <a href={safeSourceUrl(f.sourceUrl)} target="_blank" rel="noreferrer">Spectral feature reference</a>}
    </details>)}
    {!!samples.length && <details><summary>Measurements, uncertainties and original FITS ({samples.length})</summary>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Wavelength</th><th>Brightness ± error (MJy/sr)</th><th>Observation UTC</th><th>Evidence</th></tr></thead><tbody>
        {samples.map((m, i) => <tr key={i}>
          <td>{m.wavelengthUm?.toFixed(4) ?? '—'} µm</td>
          <td>{m.status === 'measured' ? `${m.brightnessMjySr!.toPrecision(4)} ± ${m.uncertaintyMjySr!.toPrecision(3)}` : m.reason || 'Rejected'}</td>
          <td>{m.observedAtUtc ?? 'Unknown'}{m.observedUntilUtc && <> to {m.observedUntilUtc}</>}</td>
          <td>{m.assetUrl && <a href={m.assetUrl}>Saved FITS</a>} {safeSourceUrl(m.sourceUrl) && <a href={safeSourceUrl(m.sourceUrl)} target="_blank" rel="noreferrer">Archive</a>}</td>
        </tr>)}
      </tbody></table></div>
      {spectrum.manifestUrl && <p><a href={spectrum.manifestUrl} target="_blank" rel="noreferrer">Saved measurement manifest and processing settings</a></p>}
    </details>}
    {wise && <section aria-label="WISE variable brightness">
      <h4>WISE brightness change · +{wise.points}</h4><p>{wise.message}</p>
      {wise.fractionalChange != null && wise.significance != null && <p>Fractional change {(wise.fractionalChange * 100).toFixed(1)}%; screen statistic {wise.significance.toFixed(1)}σ.</p>}
      <a href={`?view=wise&comparison=${encodeURIComponent(wise.comparisonId)}`} target="_blank" rel="noreferrer">Open the exact WISE blink used</a>
      <details><summary>WISE measurements and limitations</summary>
        {(wise.epochs ?? []).map(e => <p key={e.frameId}>{e.observedStartUtc} to {e.observedEndUtc}: {e.relativeFlux.toExponential(3)} ± {e.uncertainty.toExponential(2)} relative Vega flux ({e.exposures.length} exposures).</p>)}
        <ul>{(wise.limitations ?? []).map(l => <li key={l}>{l}</li>)}</ul>
      </details>
    </section>}
    <details><summary>How spectral bonuses are measured</summary>
      <p>+10 requires a SPHEREx aperture signal of at least 5σ. +5 per substance requires both declared absorption regions to be at least 20% below their local continua at a screen statistic of at least 5σ, including a 10% uncertainty floor. Continuum and feature samples must share detector, release and processing version within seven days. WISE requires a calibrated change of at least 20% and 5σ between its first and last visits; it also needs SPHEREx eligibility.</p>
      <ul>{(spectrum.limitations ?? []).map(l => <li key={l}>{l}</li>)}</ul>
    </details>
  </section>;
}
