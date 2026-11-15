import type { Playback } from "./usePlayback";
import type { Comparison, ComparisonFrame, SkyPosition } from "./comparison";
import { cutoutWcs, type ImagePoint } from "./cutoutWcs";

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
  frameMark: (SkyPosition & { frameId: string | null; predicted: boolean }) | null;
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


  return (
    <section aria-label="Comparison playback">
      <p>
        {comparison.wavelengthRangeUm.map((value) => value.toFixed(4)).join("–")} µm · Shared stretch{" "}
        {comparison.stretch.min.toPrecision(4)}–{comparison.stretch.max.toPrecision(4)} {comparison.stretch.unit}
      </p>
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
              {wcs && frameMark?.frameId === frame.id && marker(wcs.toImage(frameMark),
                frameMark.predicted ? "Predicted Gaia position" : "Gaia catalog position", "cutout-gaia-mark")}
            </>
          )}
        </div>
        <figcaption>
          <time dateTime={frame.observedAtUtc}>{frame.observedAtUtc}</time>
          {" · "}{frame.wavelengthUm.toFixed(4)} µm · {frame.release.toUpperCase()}
          {frame.sourceUrl && <> · <a href={frame.sourceUrl}>Source observation</a></>}
        </figcaption>
      </figure>
      {wcs ? <p>Click the image to inspect a sky position with Gaia.</p> :
        <p>Point inspection is unavailable for this image grid.</p>}
      {frame.observationStartUtc && frame.observationEndUtc && (
        <p>Exposure interval (UTC) {frame.observationStartUtc} to {frame.observationEndUtc}</p>
      )}
      <p>Observation {index+1} of {frames.length} · Use the Time window to blink or select another date.</p>
      {frame.validFraction !== undefined && (
        <p>{(frame.validFraction * 100).toFixed(1)}% valid pixels
          {frame.alignment && <> · {alignmentLabels[frame.alignment] ?? frame.alignment}</>}
        </p>
      )}
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
