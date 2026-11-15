import { fmtDecDms, fmtDeg, fmtRaHms, fmtWithUnit } from "../format";
import { isoToDecimalYear, propagate } from "../propagate";
import type { GaiaDetail, MarkAction, NearbySource, SelectedFrameMeta } from "../types";

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

  const identity = detail?.identity ?? source.identity;
  const frameEpoch = selectedFrame ? isoToDecimalYear(selectedFrame.observedAtUtc) : NaN;
  const predicted = selectedFrame && Number.isFinite(frameEpoch) && Number.isFinite(source.refEpoch) && Number.isFinite(source.pmRaCosDecMasYr) && Number.isFinite(source.pmDecMasYr) && source.pmRaCosDecMasYr !== null && source.pmDecMasYr !== null
    ? propagate(
        source.ra,
        source.dec,
        source.refEpoch,
        frameEpoch,
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
      displayName: identity?.commonName || identity?.displayName,
      refEpoch: source.refEpoch,
    });
  }

  return (
    <div className="si-detail">
      <header className="si-detail__header">
        <span className="si-detail__catalog">
          {d ? d.provenance.dataRelease : "Gaia DR3"}
        </span>
        {identity && <strong>{identity.commonName || identity.displayName || identity.canonicalDesignation}</strong>}
        <span className="si-detail__id">{source.sourceId}</span>
      </header>

      <p>{identity ? "Verified catalog cross-identification. Image detection is not established." : "Nearby Gaia source. Association with the requested target is unverified."}</p>
      {identity && <details><summary>Name provenance</summary><p>{identity.canonicalDesignation} · {identity.component}</p>{identity.provenance.map(item => <p key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.source}</a> · {item.retrievedAtUtc.slice(0, 10)}</p>)}</details>}
      {selectedFrame && !predicted && <p>Frame-time prediction unavailable: complete proper motion and epoch are required.</p>}
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
