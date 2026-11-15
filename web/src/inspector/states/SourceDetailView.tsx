import { fmtDecDms, fmtDeg, fmtRaHms, fmtWithUnit } from "../format";
import { predictAtObservation } from "../propagate";
import type { GaiaDetail, MarkAction, NearbySource, SelectedFrameMeta } from "../types";

interface Props {
  source: NearbySource;
  detail: GaiaDetail | null;
  selectedFrame?: SelectedFrameMeta | null;
  mosaicGuideTimeUtc?: string;
  onMark: (mark: MarkAction) => void;
}

/** Shows the catalog position and, when available, the prediction used for the mark. */
export function SourceDetailView({ source, detail, selectedFrame, mosaicGuideTimeUtc, onMark }: Props) {
  const d = detail;

  const predictionTime = selectedFrame?.observedAtUtc ?? mosaicGuideTimeUtc;
  const predicted = predictionTime ? predictAtObservation(source, predictionTime) : null;

  const markRa = predicted ? predicted.ra : source.ra;
  const markDec = predicted ? predicted.dec : source.dec;

  function handleMark() {
    onMark({
      frameId: selectedFrame ? selectedFrame.frameId : null,
      ra: markRa,
      dec: markDec,
      sourceId: source.sourceId,
      predicted: predicted !== null,
      astrometry: source,
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
        <h4 className="si-group__title">Observed position</h4>
        <dl className="si-fields">
          <Field label="RA" value={`${fmtRaHms(source.ra)}  (${fmtDeg(source.ra)}°)`} />
          <Field label="Dec" value={`${fmtDecDms(source.dec)}  (${fmtDeg(source.dec)}°)`} />
          <Field label="Reference epoch" value={`${source.refEpoch.toFixed(1)}`} />
        </dl>
      </section>

      <section className="si-group" aria-label="Proper motion and parallax">
        <h4 className="si-group__title">Motion & distance</h4>
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
        <h4 className="si-group__title">Photometry</h4>
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
          </h4>
          <p className="si-group__note">
            {selectedFrame
              ? <>Catalog position propagated from epoch {predicted.fromEpoch.toFixed(1)} to
                  the frame epoch {predicted.toEpoch.toFixed(2)} by proper motion.</>
              : <>Approximate position at the DR1 survey midpoint ({mosaicGuideTimeUtc?.slice(0, 10)}).
                  The mosaic combines many exposure dates.</>}
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

      {predictionTime && !predicted ? (
        <p>Prediction unavailable for this observation time.</p>
      ) : (
        <button type="button" className="si-mark-button" onClick={handleMark}>
          {mosaicGuideTimeUtc ? "Mark approximate mosaic position" : predicted ? "Mark predicted position" : "Mark position"}
        </button>
      )}
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
