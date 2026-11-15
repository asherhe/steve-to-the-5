import { predictAtObservation } from "../propagate";
import type { GaiaDetail, MarkAction, NearbySource, SelectedFrameMeta } from "../types";
import { DetailSections } from "./DetailSections";
import { InspectorInfoTip } from "./InspectorInfoTip";
import { SummaryCard } from "./SummaryCard";

interface Props {
  source: NearbySource;
  detail: GaiaDetail | null;
  selectedFrame?: SelectedFrameMeta | null;
  mosaicGuideTimeUtc?: string;
  onMark: (mark: MarkAction) => void;
}

/** A plain-language summary card, the mark action, then every raw value in collapsed sections. */
export function SourceDetailView({ source, detail, selectedFrame, mosaicGuideTimeUtc, onMark }: Props) {
  const d = detail;
  const identity = detail?.identity ?? source.identity;

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
      displayName: identity?.commonName || identity?.displayName,
      refEpoch: source.refEpoch,
    });
  }

  return (
    <div className="si-detail">
      <SummaryCard source={source} detail={d}
        title={identity ? { name: identity.commonName || identity.displayName || identity.canonicalDesignation, component: identity.component } : undefined} />

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
            {selectedFrame
              ? <>Catalog position propagated from epoch {predicted.fromEpoch.toFixed(1)} to
                  the frame epoch {predicted.toEpoch.toFixed(2)} by proper motion.</>
              : <>Approximate position at the DR1 survey midpoint ({mosaicGuideTimeUtc?.slice(0, 10)}).
                  The mosaic combines many exposure dates.</>}
          </p>
        </section>
      )}

      {predictionTime && !predicted ? (
        <p>{selectedFrame ? "Frame-time prediction unavailable" : "Prediction unavailable"}: complete proper motion, reference epoch and a valid observation time are required.</p>
      ) : (
        <button type="button" className="si-mark-button" onClick={handleMark}>
          {mosaicGuideTimeUtc ? "Mark approximate mosaic position" : predicted ? "Mark predicted position" : "Mark position"}
        </button>
      )}

      <DetailSections source={source} detail={d} predicted={predicted} identity={identity ?? null} />
    </div>
  );
}
