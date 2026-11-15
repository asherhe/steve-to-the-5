import type { Playback } from "./usePlayback";
import type { Comparison, ComparisonFrame, SkyPosition } from "./comparison";
import { cutoutWcs, type ImagePoint } from "./cutoutWcs";
import { bandColors } from "./SpectralRuler";
import { bandForWavelength } from "./spherexSurvey";
import { InfoTip } from "./InfoTip";

const alignmentLabels: Record<string, string> = {
  reference_frame: "Reference frame",
  verified: "Alignment verified against background sources",
  wcs_only_not_empirically_verified: "WCS alignment, empirical check unavailable",
  single_frame_not_applicable: "Single frame",
};

export function ComparisonPlayback({
  comparison, playback, selectedPosition, frameMark, savedMarks = [], onInspect,
}: {
  comparison: Comparison;
  playback: Playback;
  selectedPosition: SkyPosition | null;
  frameMark: SkyPosition | null;
  savedMarks?: readonly (SkyPosition & { frameId: string })[];
  onInspect: (position: SkyPosition, frame: ComparisonFrame) => void;
}) {
  const { frame, index, frames, attempt: imageAttempt } = playback;
  const failed = playback.assets[frame.id]?.state === "failed";
  const { width, height } = comparison.grid;
  const wcs = cutoutWcs(comparison.grid);
  const canInspect = !!wcs && playback.assets[frame.id]?.state === "ready" && !failed;

  function inspect(x: number, y: number) {
    if (!canInspect || !wcs) return;
    playback.pause();
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

  const band = bandForWavelength(frame.wavelengthUm);

  return (
    <section aria-label="Comparison playback" className="playback">
      <figure className="comparison-frame">
        <div className="cutout" style={{ aspectRatio: `${comparison.grid.width} / ${comparison.grid.height}` }}>
          {failed ? (
            <div role="status">
              This frame could not be loaded.{" "}
              <button type="button" onClick={playback.retry}>Retry frame</button>
            </div>
          ) : (
            <>
              <img key={`${frame.id}-${imageAttempt}`} src={frame.imageUrl} width={width}
                height={height} alt={`SPHEREx frame ${index + 1} of ${frames.length}`}
                onError={playback.fail} />
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
              {wcs && frameMark && marker(wcs.toImage(frameMark),
                "Predicted Gaia position", "cutout-gaia-mark")}
            </>
          )}
          <span className="cutout-chip">
            Shared stretch{" "}
            <InfoTip term="Shared stretch">
              A brightness scale applied identically to every frame, so the same pixel value looks
              the same across dates. Without a shared stretch, images could look different just
              because they were scaled differently, not because anything changed.
            </InfoTip>
            {" "}{comparison.stretch.min.toPrecision(4)}–{comparison.stretch.max.toPrecision(4)} {comparison.stretch.unit}
          </span>
        </div>
        <figcaption>
          <time className="frame-time" dateTime={frame.observedAtUtc}>{frame.observedAtUtc}</time>
          <span className="frame-meta">
            {band && <span className="band-swatch" style={{ background: bandColors[band - 1] }} aria-hidden="true" />}
            {band ? `Band ${band} · ` : ""}{frame.wavelengthUm.toFixed(4)} µm{" "}
            <InfoTip term="Wavelength (µm)">
              The color of infrared light being shown, in micrometres (µm, millionths of a metre).
              SPHEREx sees infrared, which is beyond what human eyes detect. Different wavelengths
              make different objects stand out.
            </InfoTip>
            {" · "}{frame.release.toUpperCase()}
            {frame.sourceUrl && <> · <a href={frame.sourceUrl}>Source observation</a></>}
          </span>
          {frame.observationStartUtc && frame.observationEndUtc && (
            <span className="frame-meta">Exposure interval (UTC) {frame.observationStartUtc} to {frame.observationEndUtc}</span>
          )}
        </figcaption>
      </figure>
      {frames.length > 1 && (
        <p className="hint">Observation {index + 1} of {frames.length}. Use the Time window to blink or select another date.</p>
      )}
      {(frame.validFraction !== undefined || frame.alignment) && (
        <dl className="stats">
          {frame.validFraction !== undefined && (
            <div><dt>Valid pixels <InfoTip term="Valid pixels">
              The share of pixels in this frame with usable data. The rest are masked or uncovered
              (for example, edges, gaps, or flagged detector regions). A low fraction means less of
              the patch can be trusted for comparison.
            </InfoTip></dt><dd>{(frame.validFraction * 100).toFixed(1)}%</dd></div>
          )}
          {frame.alignment && (
            <div><dt>Alignment <InfoTip term="Alignment">
              How the frames were registered onto a common grid so the same sky position lands on
              the same pixel. &ldquo;Verified&rdquo; means it was checked against background stars;
              otherwise it relies on the recorded pointing (WCS) only.
            </InfoTip></dt><dd data-caution={frame.alignment === "wcs_only_not_empirically_verified" || undefined}>
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
