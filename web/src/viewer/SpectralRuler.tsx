import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import {
  bandForSlice, nearestSlice, spherexBands, spherexRangeUm, spherexSliceWavelengthsUm, stepSlice,
} from "./spherexSurvey";

/** Colours identify wavelength bands only. They are never applied to images. */
export const bandColors = ["#7b6cf0", "#a85bd6", "#d2508f", "#f07b5a", "#f5a742", "#f2d45c"] as const;

const ticks = [1, 2, 3, 4, 5];
const lastSlice = spherexSliceWavelengthsUm.length - 1;
const channelsPerBand = 17;

/** Position on a log-wavelength axis spanning the cube's coverage, as a percentage. */
export function rulerPercent(um: number): number {
  const [min, max] = spherexRangeUm;
  return Math.min(100, Math.max(0, 100 * Math.log(um / min) / Math.log(max / min)));
}

function wavelengthAt(percent: number): number {
  const [min, max] = spherexRangeUm;
  return min * Math.exp(percent / 100 * Math.log(max / min));
}

function markerStyle(um: number): CSSProperties {
  return { left: `${rulerPercent(um)}%` };
}

function describe(slice: number): string {
  const band = bandForSlice(slice);
  const channel = slice - (band - 1) * channelsPerBand + 1;
  return `${spherexSliceWavelengthsUm[slice].toFixed(3)} µm, band ${band} channel ${channel}`;
}

export function SpectralRuler({ mapSlice, onSelectSlice, frameWavelengthUm, frameLabel, disabled = false }: {
  mapSlice: number;
  /** Any non-blank cube slice; the map layer follows it. */
  onSelectSlice: (slice: number) => void;
  /** Wavelength of the comparison frame on screen, if any. */
  frameWavelengthUm: number | null;
  frameLabel: string | null;
  disabled?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  // While dragging, the marker follows the pointer; the map changes on release.
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? mapSlice;
  const shownBand = bandForSlice(shown);
  const shownUm = spherexSliceWavelengthsUm[shown];
  const [min, max] = spherexRangeUm;

  function sliceAt(clientX: number): number {
    const bounds = track.current!.getBoundingClientRect();
    return nearestSlice(wavelengthAt((clientX - bounds.left) / bounds.width * 100));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft(sliceAt(event.clientX));
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (draft !== null) setDraft(sliceAt(event.clientX));
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (draft === null) return;
    const slice = sliceAt(event.clientX);
    setDraft(null);
    if (slice !== mapSlice) onSelectSlice(slice);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const steps: Record<string, number> = {
      ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1,
      PageUp: channelsPerBand, PageDown: -channelsPerBand,
      Home: -lastSlice, End: lastSlice,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const slice = stepSlice(mapSlice, steps[event.key]);
    if (slice !== mapSlice) onSelectSlice(slice);
  }

  return (
    <section className="spectral-ruler" aria-labelledby="ruler-heading">
      <div className="ruler-head">
        <h2 id="ruler-heading">SPECTRAL COVERAGE · {min.toFixed(2)}–{max.toFixed(2)} µm · LOG</h2>
        <span className="ruler-hint">Click or drag along the bar to set the map wavelength · colour marks wavelength only</span>
      </div>
      <div className="ruler-track">
        <div ref={track} className="ruler-slider" role="slider" tabIndex={disabled ? -1 : 0}
          aria-label="Map layer wavelength" aria-disabled={disabled || undefined}
          aria-valuemin={0} aria-valuemax={lastSlice} aria-valuenow={shown} aria-valuetext={describe(shown)}
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
          onPointerCancel={() => setDraft(null)} onKeyDown={keyDown}>
          {spherexBands.map(({ band, fromUm, toUm }) => (
            <span key={band} className="ruler-band" data-current={band === shownBand || undefined}
              style={{ width: `${rulerPercent(toUm) - rulerPercent(fromUm)}%`, "--band": bandColors[band - 1] } as CSSProperties}>
              <span>B{band}</span>
              <span className="ruler-bar" />
            </span>
          ))}
          <span className="ruler-thumb" style={markerStyle(shownUm)} />
        </div>
        {frameWavelengthUm !== null && (
          <>
            <span className="ruler-mark ruler-mark-frame" style={markerStyle(frameWavelengthUm)} aria-hidden="true" />
            <span className={`ruler-flag${rulerPercent(frameWavelengthUm) > 70 ? " ruler-flag-flip" : ""}`}
              style={markerStyle(frameWavelengthUm)} aria-hidden="true">{frameLabel}</span>
          </>
        )}
      </div>
      <div className="ruler-ticks" aria-hidden="true">
        {ticks.map((um) => <span key={um} style={markerStyle(um)}>{um}{um === 5 ? " µm" : ""}</span>)}
      </div>
      <p className="ruler-legend">
        <span className="ruler-key-map" aria-hidden="true">┆</span> Map layer {shownUm.toFixed(3)} µm (band {shownBand})
        {frameWavelengthUm !== null && <>
          {"  "}<span className="ruler-key-frame" aria-hidden="true">│</span> Dated frame {frameWavelengthUm.toFixed(4)} µm
        </>}
      </p>
    </section>
  );
}
