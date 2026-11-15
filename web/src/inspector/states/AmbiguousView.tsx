import { fmtNumber } from "../format";
import type { NearbySource } from "../types";

interface Props {
  sources: NearbySource[];
  onSelect: (source: NearbySource) => void;
  selectedId?: string | null;
}

/** Several comparably close sources: the user must disambiguate before inspecting one. */
export function AmbiguousView({ sources, onSelect, selectedId }: Props) {
  return (
    <div className="si-state si-state--ambiguous">
      <p className="si-state__title">Multiple nearby sources</p>
      <p className="si-state__detail">
        {sources.length} Gaia DR3 sources are close to this point. Pick one to inspect.
      </p>
      <ul className="si-candidate-list">
        {sources.map((s) => (
          <li key={s.sourceId}>
            <button
              type="button"
              className={
                "si-candidate" + (s.sourceId === selectedId ? " si-candidate--active" : "")
              }
              onClick={() => onSelect(s)}
            >
              {s.identity && <strong>{s.identity.commonName || s.identity.displayName}</strong>}
              <span className="si-candidate__id">{s.sourceId}</span>
              <span className="si-candidate__sep">{fmtNumber(s.separationArcsec, 2)}″</span>
              <span className="si-candidate__mag">
                G {s.gMag === null ? "—" : fmtNumber(s.gMag, 2)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
