import type { Playback } from "./usePlayback";
import type { Comparison, SkyPosition } from "./comparison";
import { cutoutWcs, type ImagePoint } from "./cutoutWcs";
import { bandColors } from "./SpectralRuler";
import { bandForWavelength } from "./spherexSurvey";
import { InfoTip } from "./InfoTip";
import { wiseBandName, type SkyView } from "./wiseSurvey";

const alignmentLabels: Record<string, string> = {
  reference_frame: "Reference frame",
  verified: "Alignment verified against background sources",
  wcs_only_not_empirically_verified: "WCS alignment, empirical check unavailable",
  single_frame_not_applicable: "Single frame",
};

/**
 * Evidence for the dated frame shown in the Blink window: its source and release (always
 * visible), the frame image, and the measurement details. The dated image is normally drawn
 * on the sky map; the image section opens by itself when the map cannot place it.
 */
export function FrameDetails({
  comparison, playback, survey = "spherex", label, selectedPosition, frameMark, savedMarks = [],
}: {
  comparison: Comparison;
  playback: Playback;
  /** Survey the frames come from; it changes labels only. */
  survey?: SkyView;
  /** What kind of comparison this is, for example "Saved real SPHEREx example". */
  label: string;
  selectedPosition: SkyPosition | null;
  frameMark: SkyPosition | null;
  savedMarks?: readonly (SkyPosition & { frameId: string })[];
}) {
  const { frame, index, frames, attempt: imageAttempt } = playback;
  const failed = playback.assets[frame.id]?.state === "failed";
  const { width, height } = comparison.grid;
  const wcs = cutoutWcs(comparison.grid);
  const wise = survey === "wise";
  const band = wise ? null : bandForWavelength(frame.wavelengthUm);
  const combined = frame.qualityFlags.combinedExposures;

  function marker(point: ImagePoint | null, text: string, className: string) {
    if (!point || point.x < -0.5 || point.x >= width - 0.5 ||
        point.y < -0.5 || point.y >= height - 0.5) return null;
    return (
      <span className={`cutout-marker ${className}`} role="img" aria-label={text} title={text}
        style={{ left: `${(point.x + 0.5) / width * 100}%`, top: `${(point.y + 0.5) / height * 100}%` }} />
    );
  }

  return (
    <section aria-label="Frame details" className="frame-details">
      <p className="frame-source">
        {label} · {frame.release.toUpperCase()}
        {frame.sourceUrl && <> · <a href={frame.sourceUrl}>{wise ? "First source exposure" : "Source observation"}</a></>}
        {comparison.frames.some(({ release }) => release === "dr1") && (
          <> · <a href="https://doi.org/10.26131/IRSA678">SPHEREx DR1 spectral image dataset</a></>
        )}
      </p>

      {typeof comparison.coverage?.targetRegionCommonValidFraction === "number" && comparison.coverage.targetRegionCommonValidFraction < 1 && (
        <p>Some pixels near the requested position are masked or uncovered in at least one frame.</p>
      )}
      {comparison.limitations?.map((limitation) => <p key={limitation}>{limitation}</p>)}
      {typeof comparison.provenance?.acknowledgement === "string" && <p className="hint">{comparison.provenance.acknowledgement}</p>}

      {/* Without sky coordinates the map cannot draw the frame, so the image is shown here instead. */}
      <details open={!wcs || undefined}>
        <summary>Frame image</summary>
        <p className="hint">Striped pixels are masked or uncovered.</p>
        <figure className="comparison-frame">
          <div className="cutout" style={{ aspectRatio: `${width} / ${height}` }}>
            {failed ? (
              <div role="status">
                This frame could not be loaded.{" "}
                <button type="button" onClick={playback.retry}>Retry frame</button>
              </div>
            ) : (
              <>
                <img key={`${frame.id}-${imageAttempt}`} src={frame.imageUrl} width={width}
                  height={height} alt={`${wise ? "WISE" : "SPHEREx"} frame ${index + 1} of ${frames.length}`}
                  onError={playback.fail} />
                {wcs && savedMarks.filter(mark => mark.frameId === frame.id).map((mark, i) =>
                  <span key={i}>{marker(wcs.toImage(mark), "Saved finding mark", "cutout-selection")}</span>)}
                {wcs && selectedPosition && marker(wcs.toImage(selectedPosition), "Selected sky position", "cutout-selection")}
                {wcs && frameMark && marker(wcs.toImage(frameMark), "Predicted Gaia position", "cutout-gaia-mark")}
              </>
            )}
          </div>
        </figure>
      </details>

      <details>
        <summary>Frame details</summary>
        <dl className="stats">
          <div><dt>Observed (UTC)</dt><dd><time dateTime={frame.observedAtUtc}>{frame.observedAtUtc}</time></dd></div>
          {frame.observationStartUtc && frame.observationEndUtc && (
            <div><dt>{wise ? `Median of ${combined ?? "several"} exposures (UTC)` : "Exposure interval (UTC)"}</dt>
              <dd>{frame.observationStartUtc} to {frame.observationEndUtc}</dd></div>
          )}
          <div><dt>Wavelength</dt><dd>
            {band && <span className="band-swatch" style={{ background: bandColors[band - 1] }} aria-hidden="true" />}
            {band ? `Band ${band} · ` : ""}
            {wise ? `${wiseBandName(frame.wavelengthUm)} broad band · ${frame.wavelengthUm.toFixed(2)} µm` : (
              <>
                {frame.wavelengthUm.toFixed(4)} µm{" "}
                <InfoTip term="Wavelength (µm)">
                  The color of infrared light being shown, in micrometres (µm, millionths of a metre).
                  SPHEREx sees infrared, which is beyond what human eyes detect. Different wavelengths
                  make different objects stand out.
                </InfoTip>
              </>
            )}
          </dd></div>
          <div><dt>Shared stretch <InfoTip term="Shared stretch">
            A brightness scale applied identically to every frame, so the same pixel value looks
            the same across dates. Without a shared stretch, images could look different just
            because they were scaled differently, not because anything changed.
          </InfoTip></dt><dd>{comparison.stretch.min.toPrecision(4)}–{comparison.stretch.max.toPrecision(4)} {comparison.stretch.unit}</dd></div>
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
        {Object.keys(frame.qualityFlags).length > 0 && (
          <details>
            <summary>Frame quality flags</summary>
            <dl>
              {Object.entries(frame.qualityFlags).map(([flag, value]) => (
                <div key={flag}><dt>{flag.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </details>
        )}
      </details>
    </section>
  );
}
