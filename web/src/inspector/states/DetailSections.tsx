import { useState, type ReactNode } from "react";

import { sourceAsText } from "../describe";
import { fmtDecDms, fmtDeg, fmtRaHms, fmtWithUnit } from "../format";
import type { GaiaDetail, NearbySource, ObjectIdentity, PredictedPosition } from "../types";
import { Hint } from "./Hint";

interface Props {
  source: NearbySource;
  detail: GaiaDetail | null;
  predicted: PredictedPosition | null;
  /** Verified cross-identification by source ID, if any. */
  identity?: ObjectIdentity | null;
}

const NOT_MEASURED = "not measured";
const shown = (text: string) => (text === "—" ? NOT_MEASURED : text);

/** Every raw catalog value, collapsed by default below the summary card. */
export function DetailSections({ source, detail, predicted, identity }: Props) {
  const d = detail;
  const [copied, setCopied] = useState("");

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${label} copied.`);
    } catch {
      setCopied("Copying failed. Select the text instead.");
    }
  }

  return (
    <div className="si-sections">
      <Section title="Position">
        <p className="si-group__note">
          Where Gaia measured the source at epoch {source.refEpoch.toFixed(1)} (ICRS).
          <Hint term="the reference epoch">
            The date the catalog position refers to. A moving star is somewhere else today.
          </Hint>
        </p>
        <dl className="si-fields">
          <Field label="RA" value={`${fmtRaHms(source.ra)}  (${fmtDeg(source.ra)}°)`} />
          <Field label="Dec" value={`${fmtDecDms(source.dec)}  (${fmtDeg(source.dec)}°)`} />
          {d && <Field label="RA error" value={shown(fmtWithUnit(d.raErrorMas, "mas", 3))} />}
          {d && <Field label="Dec error" value={shown(fmtWithUnit(d.decErrorMas, "mas", 3))} />}
          <Field label="Reference epoch" value={source.refEpoch.toFixed(1)} />
        </dl>
      </Section>

      <Section title="Motion">
        <p className="si-group__note">
          Raw Gaia values. 1000 mas is one arcsecond.
          <Hint term="parallax">
            The star's apparent yearly wobble caused by Earth's orbit. Larger parallax means a nearer star.
          </Hint>
        </p>
        <dl className="si-fields">
          <Field label="PM (RA·cosδ)" value={shown(fmtWithUnit(source.pmRaCosDecMasYr, "mas/yr", 3, d?.pmRaCosDecErrorMasYr))} />
          <Field label="PM (Dec)" value={shown(fmtWithUnit(source.pmDecMasYr, "mas/yr", 3, d?.pmDecErrorMasYr))} />
          <Field label="Parallax" value={shown(fmtWithUnit(source.parallaxMas, "mas", 3, d?.parallaxErrorMas))} />
          {d && <Field label="Radial velocity" value={shown(fmtWithUnit(d.radialVelocityKmS, "km/s", 2, d.radialVelocityErrorKmS))} />}
        </dl>
      </Section>

      <Section title="Photometry">
        <dl className="si-fields">
          <Field label="G" value={shown(fmtWithUnit(source.gMag, "mag", 3))} />
          {d && <Field label="BP" value={shown(fmtWithUnit(d.bpMag, "mag", 3))} />}
          {d && <Field label="RP" value={shown(fmtWithUnit(d.rpMag, "mag", 3))} />}
        </dl>
      </Section>

      {predicted && (
        <Section title="Predicted coordinates">
          <dl className="si-fields">
            <Field label="RA" value={`${fmtRaHms(predicted.ra)}  (${fmtDeg(predicted.ra)}°)`} />
            <Field label="Dec" value={`${fmtDecDms(predicted.dec)}  (${fmtDeg(predicted.dec)}°)`} />
            <Field label="From epoch" value={predicted.fromEpoch.toFixed(1)} />
            <Field label="To epoch" value={predicted.toEpoch.toFixed(2)} />
          </dl>
        </Section>
      )}

      {identity && (
        <Section title="Names">
          <p className="si-group__note">
            Matched to this Gaia source by its exact source ID, not by position.
          </p>
          <dl className="si-fields">
            {/* The card title already shows the name; repeat a designation only when it differs. */}
            {identity.canonicalDesignation !== (identity.commonName || identity.displayName) && (
              <Field label="Designation" value={identity.canonicalDesignation} />
            )}
            <Field label="Component" value={identity.component} />
            {identity.aliases.length > 0 && <Field label="Also known as" value={identity.aliases.join(" · ")} />}
            {identity.relatedDesignations.length > 0 && (
              <Field label="Distinct related objects" value={identity.relatedDesignations.join(" · ")} />
            )}
          </dl>
          {identity.provenance.map((item) => (
            <p key={item.url} className="si-group__note">
              <a className="si-detail__source-link" href={item.url} target="_blank" rel="noreferrer">{item.source}</a>
              {" "}· reviewed {item.retrievedAtUtc.slice(0, 10)}
            </p>
          ))}
        </Section>
      )}

      <Section title="Identifiers & links">
        <dl className="si-fields">
          <div className="si-field">
            <dt className="si-field__label">Source ID</dt>
            <dd className="si-field__value">
              <span className="si-detail__id">{source.sourceId}</span>
              <button type="button" className="si-copy" onClick={() => void copy(source.sourceId, "Source ID")}>
                Copy ID
              </button>
            </dd>
          </div>
          <Field label="Catalog" value={d ? d.provenance.dataRelease : "Gaia DR3"} />
        </dl>
        {d?.provenance.sourceDetailUrl && (
          <a className="si-detail__source-link" href={d.provenance.sourceDetailUrl} target="_blank" rel="noreferrer">
            View in {d.provenance.dataRelease} archive
          </a>
        )}
      </Section>

      <div className="si-sections__actions">
        <button type="button" className="si-copy" onClick={() => void copy(sourceAsText(source, detail, predicted), "All values")}>
          Copy all as text
        </button>
        <span role="status" className="si-sections__status">{copied}</span>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="si-section">
      <summary className="si-section__summary">{title}</summary>
      <div className="si-section__body">{children}</div>
    </details>
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
