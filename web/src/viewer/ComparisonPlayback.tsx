import { useEffect, useState } from "react";
import type { Comparison, ComparisonFrame, SkyPosition } from "./comparison";
import { cutoutWcs, type ImagePoint } from "./cutoutWcs";
import { bandColors } from "./SpectralRuler";
import { bandForWavelength } from "./spherexSurvey";

function formatInterval(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes % 60}m`].filter(Boolean);
  return parts.join(" ");
}

const icons = {
  previous: <path d="m15 6-6 6 6 6" />,
  next: <path d="m9 6 6 6-6 6" />,
  play: <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />,
  pause: <path d="M8 5v14M16 5v14" />,
};

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      aria-hidden="true">{icons[name]}</svg>
  );
}

const alignmentLabels: Record<string, string> = {
  reference_frame: "Reference frame",
  verified: "Alignment verified against background sources",
  wcs_only_not_empirically_verified: "WCS alignment, empirical check unavailable",
  single_frame_not_applicable: "Single frame",
};

export function ComparisonPlayback({
  comparison, visible = true, selectedPosition, frameMark, savedMarks = [], onInspect, onFrameChange,
}: {
  comparison: Comparison;
  visible?: boolean;
  selectedPosition: SkyPosition | null;
  frameMark: (SkyPosition & { frameId: string | null; predicted: boolean }) | null;
  savedMarks?: readonly (SkyPosition & { frameId: string })[];
  onInspect: (position: SkyPosition, frame: ComparisonFrame) => void;
  /** Called with the frame on screen, for the spectral ruler. */
  onFrameChange?: (frame: ComparisonFrame) => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [loadedFrame, setLoadedFrame] = useState<string | null>(null);
  const [imageAttempt, setImageAttempt] = useState(0);
  const frames = comparison.frames;
  const frame = frames[index];
  const multi = frames.length > 1;
  const { width, height } = comparison.grid;
  const wcs = cutoutWcs(comparison.grid);
  const canInspect = !!wcs && loadedFrame === frame.id && !failed;

  function inspect(x: number, y: number) {
    if (!canInspect || !wcs) return;
    setPlaying(false);
    onInspect(wcs.toSky({ x, y }), frame);
  }

  function marker(point: ImagePoint | null, label: string, className: string) {
    if (!point || point.x < -0.5 || point.x >= width - 0.5 ||
        point.y < -0.5 || point.y >= height - 0.5) return null;
    return (
      <span className={`cutout-marker ${className}`} role="img" aria-label={label} title={label}
        style={{ left: `${(point.x + 0.5) / width * 100}%`, top: `${(point.y + 0.5) / height * 100}%` }} />
    );
  }

  useEffect(() => {
    onFrameChange?.(frame);
  }, [frame, onFrameChange]);

  useEffect(() => {
    if (!visible) setPlaying(false);
  }, [visible]);

  useEffect(() => {
    if (!visible || !playing || failed || !multi || loadedFrame !== frame.id) return;
    const timer = setTimeout(() => {
      setLoadedFrame(null);
      setIndex((current) => (current + 1) % frames.length);
    }, 1000 / speed);
    return () => clearTimeout(timer);
  }, [visible, playing, failed, multi, frames.length, speed, frame.id, loadedFrame]);

  function select(next: number) {
    setPlaying(false);
    setFailed(false);
    setIndex(next);
  }

  const times = frames.map(({ observedAtUtc }) => Date.parse(observedAtUtc));
  const span = Math.max(...times) - Math.min(...times);
  const band = bandForWavelength(frame.wavelengthUm);

  return (
    <section aria-label="Comparison playback" className="playback">
      <figure className="comparison-frame">
        <div className="cutout" style={{ aspectRatio: `${comparison.grid.width} / ${comparison.grid.height}` }}>
          {failed ? (
            <div role="status">
              This frame could not be loaded.{" "}
              <button type="button" onClick={() => {
                setImageAttempt((attempt) => attempt + 1);
                setFailed(false);
              }}>Retry frame</button>
            </div>
          ) : (
            <>
              <img key={`${frame.id}-${imageAttempt}`} src={frame.imageUrl} width={width}
                height={height} alt={`SPHEREx frame ${index + 1} of ${frames.length}`}
                onLoad={() => setLoadedFrame(frame.id)}
                onError={() => { setFailed(true); setPlaying(false); }} />
              {canInspect && (
                <button type="button" className="cutout-inspect" aria-label="Inspect image. Press Enter to inspect its center."
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    if (event.detail === 0) inspect((width - 1) / 2, (height - 1) / 2);
                    else inspect((event.clientX - bounds.left) / bounds.width * width - 0.5,
                      (event.clientY - bounds.top) / bounds.height * height - 0.5);
                  }} />
              )}
              {wcs && savedMarks.filter(mark => mark.frameId === frame.id).map((mark, i) =>
                <span key={i}>{marker(wcs.toImage(mark), "Saved finding mark", "cutout-selection")}</span>)}
              {wcs && selectedPosition && marker(wcs.toImage(selectedPosition), "Selected sky position", "cutout-selection")}
              {wcs && frameMark?.frameId === frame.id && marker(wcs.toImage(frameMark),
                frameMark.predicted ? "Predicted Gaia position" : "Gaia catalog position", "cutout-gaia-mark")}
            </>
          )}
          <span className="cutout-chip">
            Shared stretch {comparison.stretch.min.toPrecision(4)}–{comparison.stretch.max.toPrecision(4)} {comparison.stretch.unit}
          </span>
        </div>
        <figcaption>
          <time className="frame-time" dateTime={frame.observedAtUtc}>{frame.observedAtUtc}</time>
          <span className="frame-meta">
            {band && <span className="band-swatch" style={{ background: bandColors[band - 1] }} aria-hidden="true" />}
            {band ? `Band ${band} · ` : ""}{frame.wavelengthUm.toFixed(4)} µm · {frame.release.toUpperCase()}
            {frame.sourceUrl && <> · <a href={frame.sourceUrl}>Source observation</a></>}
          </span>
          {frame.observationStartUtc && frame.observationEndUtc && (
            <span className="frame-meta">Exposure interval (UTC) {frame.observationStartUtc} to {frame.observationEndUtc}</span>
          )}
        </figcaption>
      </figure>
      {multi && span > 0 && (
        <div className="timeline" aria-hidden="true">
          <div className="timeline-track">
            {times.map((time, i) => (
              <span key={frames[i].id} className={`timeline-tick${i === index ? " timeline-tick-current" : ""}`}
                style={{ left: `${4 + 92 * (time - Math.min(...times)) / span}%` }} />
            ))}
            <span className="timeline-span">Δt {formatInterval(span)}</span>
          </div>
          <div className="timeline-ends">
            <span>{frames[times.indexOf(Math.min(...times))].observedAtUtc.slice(0, 10)}</span>
            <span>{frames[times.indexOf(Math.max(...times))].observedAtUtc.slice(0, 10)}</span>
          </div>
        </div>
      )}
      {multi && (
        <div className="playback-controls">
          <div className="controls">
            <button type="button" onClick={() => select(index - 1)} disabled={index === 0}><Icon name="previous" />Previous</button>
            <button type="button" className="primary" onClick={() => setPlaying(!playing)} disabled={failed}>
              <Icon name={playing ? "pause" : "play"} />{playing ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={() => select(index + 1)} disabled={index === frames.length - 1}>Next<Icon name="next" /></button>
          </div>
          <div className="controls">
            <label className="playback-scrub">
              Observation {index + 1} of {frames.length}
              <input type="range" min={0} max={frames.length - 1} value={index}
                aria-valuetext={frame.observedAtUtc} onChange={(event) => select(Number(event.target.value))} />
            </label>
            <label>
              Playback speed
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
                <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
              </select>
            </label>
          </div>
        </div>
      )}
      {(frame.validFraction !== undefined || frame.alignment) && (
        <dl className="stats">
          {frame.validFraction !== undefined && (
            <div><dt>Valid pixels</dt><dd>{(frame.validFraction * 100).toFixed(1)}%</dd></div>
          )}
          {frame.alignment && (
            <div><dt>Alignment</dt><dd data-caution={frame.alignment === "wcs_only_not_empirically_verified" || undefined}>
              {alignmentLabels[frame.alignment] ?? frame.alignment}
            </dd></div>
          )}
        </dl>
      )}
      {wcs ? <p className="hint">Click the image to inspect a sky position with Gaia.</p> :
        <p className="hint">Point inspection is unavailable for this image grid.</p>}
      {Object.keys(frame.qualityFlags).length > 0 && (
        <details>
          <summary>Frame quality flags</summary>
          <dl>
            {Object.entries(frame.qualityFlags).map(([label, value]) => (
              <div key={label}><dt>{label.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </details>
      )}
      {typeof comparison.coverage?.targetRegionCommonValidFraction === "number" && comparison.coverage.targetRegionCommonValidFraction < 1 && (
        <p>Some pixels near the requested position are masked or uncovered in at least one frame.</p>
      )}
      {comparison.limitations?.map((limitation) => <p key={limitation}>{limitation}</p>)}
      {typeof comparison.provenance?.acknowledgement === "string" && <p>{comparison.provenance.acknowledgement}</p>}
      {comparison.frames.some(({ release }) => release === "dr1") && (
        <p><a href="https://doi.org/10.26131/IRSA678">SPHEREx DR1 spectral image dataset</a></p>
      )}
    </section>
  );
}
