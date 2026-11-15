import { fmtDecDms, fmtDeg, fmtRaHms, fmtWithUnit } from "../format";
import { isoToDecimalYear, propagate } from "../propagate";
import type { GaiaDetail, MarkAction, NearbySource, SelectedFrameMeta } from "../types";
import { InspectorInfoTip } from "./InspectorInfoTip";

interface Props {
  source: NearbySource;
  detail: GaiaDetail | null;
  selectedFrame?: SelectedFrameMeta | null;
  onMark: (mark: MarkAction) => void;
}

/** Full presentation of one catalog source plus the mark action.
 *
 *  When a frame is selected, the observed catalog position (epoch 2016.0) is propagated to
 *  the frame's observation date and shown as a PREDICTED position, labelled as such and kept
 *  distinct from the observed position. The mark emitted uses the predicted coordinates in
 *  that case, otherwise the observed coordinates. */
export function SourceDetailView({ source, detail, selectedFrame, onMark }: Props) {
  const d = detail;

  const predicted = selectedFrame
    ? propagate(
        source.ra,
        source.dec,
        source.refEpoch,
        isoToDecimalYear(selectedFrame.observedAtUtc),
        source.pmRaCosDecMasYr,
        source.pmDecMasYr
      )
    : null;

  const markRa = predicted ? predicted.ra : source.ra;
  const markDec = predicted ? predicted.dec : source.dec;

  function handleMark() {
    onMark({
      frameId: selectedFrame ? selectedFrame.frameId : null,
      ra: markRa,
      dec: markDec,
      sourceId: source.sourceId,
      predicted: predicted !== null,
    });
  }

  return (
    <div className="si-detail">
      <header className="si-detail__header">
        <span className="si-detail__catalog">
          {d ? d.provenance.dataRelease : "Gaia DR3"}
        </span>
        <span className="si-detail__id">{source.sourceId}</span>
      </header>

      <section className="si-group" aria-label="Observed position">
        <h4 className="si-group__title">Observed position <InspectorInfoTip term="Observed position">
          Where Gaia actually measured this star, given as right ascension and declination. The
          reference epoch is the date those coordinates are valid for.
        </InspectorInfoTip></h4>
        <dl className="si-fields">
          <Field label="RA" value={`${fmtRaHms(source.ra)}  (${fmtDeg(source.ra)}°)`} />
          <Field label="Dec" value={`${fmtDecDms(source.dec)}  (${fmtDeg(source.dec)}°)`} />
          <Field label="Reference epoch" value={`${source.refEpoch.toFixed(1)}`} />
        </dl>
      </section>

      <section className="si-group" aria-label="Proper motion and parallax">
        <h4 className="si-group__title">Motion &amp; distance <InspectorInfoTip term="Proper motion & parallax">
          Proper motion is how fast the star drifts across the sky each year
          (milliarcseconds per year). Parallax is its tiny apparent wobble as Earth orbits the
          Sun; a larger parallax means the star is closer. Both come from Gaia&rsquo;s
          measurements.
        </InspectorInfoTip></h4>
        <dl className="si-fields">
          <Field
            label="PM (RA·cosδ)"
            value={fmtWithUnit(
              source.pmRaCosDecMasYr,
              "mas/yr",
              3,
              d?.pmRaCosDecErrorMasYr
            )}
          />
          <Field
            label="PM (Dec)"
            value={fmtWithUnit(source.pmDecMasYr, "mas/yr", 3, d?.pmDecErrorMasYr)}
          />
          <Field
            label="Parallax"
            value={fmtWithUnit(source.parallaxMas, "mas", 3, d?.parallaxErrorMas)}
          />
          {d && (
            <Field
              label="Radial velocity"
              value={fmtWithUnit(d.radialVelocityKmS, "km/s", 2, d.radialVelocityErrorKmS)}
            />
          )}
        </dl>
      </section>

      <section className="si-group" aria-label="Photometry">
        <h4 className="si-group__title">Photometry <InspectorInfoTip term="Photometry">
          How bright the star appears, measured in magnitudes. Lower numbers mean brighter. G, BP,
          and RP are Gaia&rsquo;s three brightness bands across different colors of light.
        </InspectorInfoTip></h4>
        <dl className="si-fields">
          <Field label="G" value={fmtWithUnit(source.gMag, "mag", 3)} />
          {d && <Field label="BP" value={fmtWithUnit(d.bpMag, "mag", 3)} />}
          {d && <Field label="RP" value={fmtWithUnit(d.rpMag, "mag", 3)} />}
        </dl>
      </section>

      {predicted && (
        <section className="si-group si-group--predicted" aria-label="Predicted position">
          <h4 className="si-group__title">
            Predicted position
            <span className="si-badge si-badge--predicted">predicted</span>
            <InspectorInfoTip term="Predicted position">
              Gaia measured this star in 2016. Because it drifts over time, we calculate where it
              should be on the SPHEREx observation date. This is a calculation, not a new
              measurement, so it is labelled a prediction and kept separate from the image.
            </InspectorInfoTip>
          </h4>
          <p className="si-group__note">
            Catalog position propagated from epoch {predicted.fromEpoch.toFixed(1)} to the
            frame epoch {predicted.toEpoch.toFixed(2)} by proper motion. A prediction, not an
            observation; perspective terms omitted.
          </p>
          <dl className="si-fields">
            <Field label="RA" value={`${fmtRaHms(predicted.ra)}  (${fmtDeg(predicted.ra)}°)`} />
            <Field
              label="Dec"
              value={`${fmtDecDms(predicted.dec)}  (${fmtDeg(predicted.dec)}°)`}
            />
          </dl>
        </section>
      )}

      {d?.provenance.sourceDetailUrl && (
        <a
          className="si-detail__source-link"
          href={d.provenance.sourceDetailUrl}
          target="_blank"
          rel="noreferrer"
        >
          View in {d.provenance.dataRelease} archive
        </a>
      )}

      <button type="button" className="si-mark-button" onClick={handleMark}>
        {predicted ? "Mark predicted position on frame" : "Mark position"}
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="si-field">
      <dt className="si-field__label">{label}</dt>
      <dd className="si-field__value">{value}</dd>
    </div>
  );
}
