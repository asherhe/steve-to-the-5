import { brightness } from "../describe";
import { fmtNumber } from "../format";
import type { NearbySource } from "../types";

interface Props {
  sources: NearbySource[];
  onSelect: (source: NearbySource) => void;
  selectedId?: string | null;
}

/** Several comparably close sources: the user must disambiguate before inspecting one. */
export function AmbiguousView({ sources, onSelect, selectedId }: Props) {
  const nearestFirst = [...sources].sort((a, b) => a.separationArcsec - b.separationArcsec);
  const measured = sources.filter((s) => s.gMag !== null);
  const brightest = measured.length > 1
    ? measured.reduce((best, s) => (s.gMag! < best.gMag! ? s : best)).sourceId
    : null;

  return (
    <div className="si-state si-state--ambiguous">
      <p className="si-state__title">Multiple nearby sources</p>
      <p className="si-state__detail">
        {sources.length} Gaia DR3 sources are close to this point, nearest first. Pick one to inspect.
      </p>
      <ul className="si-candidate-list">
        {nearestFirst.map((s) => {
          const bright = brightness(s.gMag);
          return (
            <li key={s.sourceId}>
              <button
                type="button"
                className={"si-candidate" + (s.sourceId === selectedId ? " si-candidate--active" : "")}
                aria-pressed={s.sourceId === selectedId}
                onClick={() => onSelect(s)}
              >
                <span className="si-candidate__main">
                  <span className="si-candidate__title">{s.identity ? s.identity.commonName || s.identity.displayName : "Gaia DR3 source"}</span>
                  <span className="si-candidate__id">{s.sourceId}</span>
                </span>
                <span className="si-candidate__side">
                  <span className="si-candidate__sep">{fmtNumber(s.separationArcsec, 2)}″ away</span>
                  <span className="si-candidate__mag">
                    {bright ? `${bright.word} · G ${fmtNumber(bright.gMag, 2)}` : "Brightness not measured"}
                    {s.sourceId === brightest && <span className="si-chip si-chip--brightest">Brightest</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
