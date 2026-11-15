import type { WiseBand } from "./archive";
import { wiseMap, wiseTimeLapseBands } from "./wiseSurvey";

/** Dock shown in WISE view, in place of the SPHEREx wavelength ruler. */
export function WiseDock({ band, onSelectBand }: {
  band: WiseBand;
  /** Band used for the dated time-lapse frames; the map composite does not change. */
  onSelectBand: (band: WiseBand) => void;
}) {
  return (
    <section className="spectral-ruler wise-dock" aria-labelledby="wise-dock-heading">
      <div className="ruler-head">
        <h2 id="wise-dock-heading">WISE VIEW · ALLWISE COLOUR COMPOSITE</h2>
        <span className="ruler-hint">Reference map from 2010–2011 exposures · dated frames are in the time-lapse panel</span>
      </div>
      <div className="wise-dock-body">
        <ul className="wise-channels" aria-label="Map colour channels">
          {wiseMap.channels.map(({ band: name, um, color, channel }) => (
            <li key={name}>
              <span className="band-swatch" style={{ background: color }} aria-hidden="true" />
              {name} {um} µm<span className="wise-channel"> · {channel}</span>
            </li>
          ))}
        </ul>
        <div className="wise-band-picker" role="group" aria-label="Time-lapse band">
          <span>Time-lapse band</span>
          {wiseTimeLapseBands.map(({ band: value, name, um }) => (
            <button key={value} type="button" aria-pressed={band === value} onClick={() => onSelectBand(value)}>
              {name} {um} µm
            </button>
          ))}
        </div>
      </div>
      <p className="ruler-legend">
        False colour shows which band is brighter. It does not measure temperature or composition.
      </p>
    </section>
  );
}
