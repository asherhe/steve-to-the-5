import { brightness, colour, distance, distanceText, motion, motionText, shortId } from "../describe";
import { fmtNumber } from "../format";
import type { GaiaDetail, NearbySource } from "../types";
import { InspectorInfoTip } from "./InspectorInfoTip";

/** A verified name for the source. Only ever set from a catalog cross-identification by
 *  source ID; never inferred from position. */
export interface SourceTitle {
  name: string;
  component?: string;
}

interface Props {
  source: NearbySource;
  detail: GaiaDetail | null;
  title?: SourceTitle;
}

/** First view of a source: what it looks like and how it moves, in plain words.
 *  Every line is derived from the Gaia catalog row, not from SPHEREx imagery. */
export function SummaryCard({ source, detail, title }: Props) {
  const release = detail ? detail.provenance.dataRelease : "Gaia DR3";
  const bright = brightness(source.gMag);
  const tint = colour(detail?.bpMag, detail?.rpMag);
  const far = distance(source.parallaxMas, detail?.parallaxErrorMas);
  const move = motion(source.pmRaCosDecMasYr, source.pmDecMasYr, detail?.pmRaCosDecErrorMasYr, detail?.pmDecErrorMasYr);
  const directed = move && move.kind !== "insignificant" && move.kind !== "slow" ? move : null;

  return (
    <div className="si-card">
      <header className="si-card__header">
        <h3 className="si-card__title">{title ? title.name : `${release} source`}</h3>
        <p className="si-card__subtitle">
          {title?.component && <span>{title.component} · </span>}
          {title && <span>{release} · </span>}
          <span className="si-card__id" title={`Source ID ${source.sourceId}`}>{shortId(source.sourceId)}</span>
        </p>
      </header>

      <p className="si-card__identity">
        {title
          ? "Verified catalog cross-identification. Image detection is not established."
          : "Nearby Gaia source. Association with the requested target is unverified."}
      </p>

      {(bright || tint) && (
        <p className="si-card__look">
          {bright && (
            <span>
              {bright.word} · G {fmtNumber(bright.gMag, 2)}
              <InspectorInfoTip term="G magnitude">
                Brightness in Gaia's broad optical band. Smaller numbers are brighter; the unaided eye reaches about 6.
              </InspectorInfoTip>
            </span>
          )}
          {tint && (
            <span className={`si-chip si-chip--${tint.word.toLowerCase()}`}>
              {tint.word} · BP−RP {fmtNumber(tint.bpRp, 2)}
              <InspectorInfoTip term="BP−RP colour">
                Gaia's optical colour: blue minus red brightness. Dust can redden it; it is not a temperature.
              </InspectorInfoTip>
            </span>
          )}
        </p>
      )}

      <dl className="si-card__facts">
        <div className="si-card__fact">
          <dt>Distance</dt>
          <dd>
            {distanceText(far)}
            <InspectorInfoTip term="Distance from parallax">
              Computed from Gaia's parallax, the tiny yearly shift caused by Earth's orbit. It is stated only when the parallax is at least five times its uncertainty.
            </InspectorInfoTip>
          </dd>
        </div>
        {move && (
          <div className="si-card__fact">
            <dt>Motion</dt>
            <dd>
              {directed && (
                <svg className="si-arrow" viewBox="-12 -12 24 24" width="18" height="18" role="img"
                  aria-label={`Arrow pointing ${directed.compass}, north up and east left`}>
                  {/* Sky convention: east is to the left, so the angle runs counter-clockwise. */}
                  <g transform={`rotate(${-directed.positionAngleDeg})`}>
                    <path d="M0 9V-8M-5 -3 0 -9 5 -3" fill="none" stroke="currentColor" strokeWidth="2.2"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                </svg>
              )}
              {motionText(move)}
              {move.kind === "fast" && <span className="si-chip si-chip--fast">Fast mover</span>}
              <InspectorInfoTip term="Proper motion">
                How fast the source drifts across the sky, measured by Gaia. One SPHEREx pixel is 6.2 arcseconds.
              </InspectorInfoTip>
              {directed && (
                <span className="si-card__sub">
                  about {directed.pixelsPerDecade < 10 ? directed.pixelsPerDecade.toFixed(1) : Math.round(directed.pixelsPerDecade)} SPHEREx
                  {" "}pixels in 10 years
                </span>
              )}
            </dd>
          </div>
        )}
        <div className="si-card__fact">
          <dt>Match</dt>
          <dd>{fmtNumber(source.separationArcsec, 2)}″ from the selected point</dd>
        </div>
      </dl>

      <p className="si-card__footnote">
        Derived from {release} measurements (epoch {source.refEpoch.toFixed(1)}), not from SPHEREx images.
      </p>
    </div>
  );
}
