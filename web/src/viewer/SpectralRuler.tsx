import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { TileWatch } from "./tileWatch";
import {
  bandForSlice, nearestSlice, nextReadySlice, scanBaseStepMs, scanSamples, scanSpeeds, spherexBands, spherexRangeUm,
  spherexSliceWavelengthsUm, stepSlice,
} from "./spherexSurvey";

/** Colours identify wavelength bands only. They are never applied to images. */
export const bandColors = ["#7b6cf0", "#a85bd6", "#d2508f", "#f07b5a", "#f5a742", "#f2d45c"] as const;

const ticks = [1, 2, 3, 4, 5];
/** Scan speed at first, as a multiple of the base pace. */
const defaultScanSpeed = 2;
/** Polls, this far apart, with no tiles loading before moving on; lets the map draw what just arrived. */
const scanPollMs = 16;
const scanSettlePolls = 3;
/** Longest a wavelength is waited for, so one stuck tile cannot freeze the scan. */
const scanMaxWaitMs = 4000;
/** How long the map must be still before every wavelength is preloaded for the new view. */
const preloadIdleMs = 1500;
/** Wavelengths fetched at once while preloading; the archive's tile server is the limit, not this. */
const preloadWorkers = 2;
/** Wait before trying again after some wavelengths failed to load. */
const preloadRetryMs = 10_000;
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

export function SpectralRuler({ mapSlice, onSelectSlice, tiles, frameWavelengthUm, frameLabel, disabled = false }: {
  mapSlice: number;
  /** Any non-blank cube slice; the map layer follows it. */
  onSelectSlice: (slice: number) => void;
  /** The map's tile watcher; a scan loads wavelengths ahead through it. */
  tiles?: RefObject<TileWatch | null>;
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
  const [scanning, setScanning] = useState(false);
  // Read by a running scan, so changing the speed does not restart it.
  const [speed, setSpeed] = useState<number>(defaultScanSpeed);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const current = useRef(mapSlice);
  current.current = mapSlice;

  // Preload: once the map has been still for a moment, fetch a few evenly spaced wavelengths'
  // tiles for the current view into the browser cache. The tile server serves roughly one
  // wavelength a second, so this takes about ten seconds of background time, and starts over
  // if the map is panned or zoomed (tiles already fetched stay cached).
  const [ready, setReady] = useState<ReadonlySet<number>>(() => new Set());
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // The view the ready set was loaded for; a scan uses it only while the map still shows that view.
  const readyView = useRef("");

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    // Timers, not animation frames: a background tab pauses frames, and this should just wait there.
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    (async () => {
      while (!cancelled) {
        const watch = tiles?.current;
        if (!watch || document.hidden) { await sleep(500); continue; }
        // Wait for a view that has stopped changing and has nothing left loading.
        let view = watch.viewSignature();
        for (let calm = 0; !cancelled && calm < preloadIdleMs;) {
          await sleep(250);
          const now = watch.viewSignature();
          calm = now !== "" && now === view && watch.loading() === 0 ? calm + 250 : 0;
          view = now;
        }
        if (cancelled) return;
        const done = new Set<number>();
        readyView.current = view;
        setReady(new Set());
        const queue = [...scanSamples];
        let next = 0;
        let failed = false;
        const worker = async () => {
          while (!cancelled && !document.hidden && watch.viewSignature() === view) {
            const slice = queue[next++];
            if (slice === undefined) return;
            if (await watch.prefetch(slice)) {
              done.add(slice);
              setReady(new Set(done));
            } else {
              failed = true;
            }
          }
        };
        await Promise.all(Array.from({ length: preloadWorkers }, worker));
        if (failed) await sleep(preloadRetryMs);
        // Fully loaded: nothing more to do until the view changes.
        while (!cancelled && !failed && done.size >= scanSamples.length && watch.viewSignature() === view) await sleep(500);
      }
    })();
    return () => { cancelled = true; };
  }, [disabled, tiles]);

  // A scan steps the map layer through the preloaded wavelengths, short to long, then starts
  // again. There is no fixed delay: every wavelength it shows is already in the browser cache,
  // so each draws at once. It only moves while the map still shows the view that was preloaded.
  useEffect(() => {
    if (!scanning || disabled) return;
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    (async () => {
      let shownAt = 0;
      while (!cancelled) {
        const watch = tiles?.current;
        const usable = watch && watch.viewSignature() === readyView.current;
        const next = usable ? nextReadySlice(current.current, readyRef.current) : null;
        if (next === null) {
          await sleep(200);
          continue;
        }
        const pause = scanBaseStepMs / speedRef.current - (performance.now() - shownAt);
        if (pause > 0) await sleep(pause);
        if (cancelled) return;
        onSelectSlice(next);
        shownAt = performance.now();
        // Let the map draw the new wavelength before choosing the next.
        let calm = 0;
        for (const start = performance.now(); calm < scanSettlePolls && !cancelled && performance.now() - start < scanMaxWaitMs;) {
          await sleep(scanPollMs);
          calm = watch?.loading() ? 0 : calm + 1;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [scanning, disabled, onSelectSlice, tiles]);

  useEffect(() => {
    if (disabled) setScanning(false);
  }, [disabled]);

  function sliceAt(clientX: number): number {
    const bounds = track.current!.getBoundingClientRect();
    return nearestSlice(wavelengthAt((clientX - bounds.left) / bounds.width * 100));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    setScanning(false);
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
    setScanning(false);
    const slice = stepSlice(mapSlice, steps[event.key]);
    if (slice !== mapSlice) onSelectSlice(slice);
  }

  return (
    <section className="spectral-ruler" aria-labelledby="ruler-heading">
      <div className="ruler-head">
        <h2 id="ruler-heading">SPECTRAL COVERAGE · {min.toFixed(2)}–{max.toFixed(2)} µm · LOG</h2>
        <span className="ruler-hint">Click or drag along the bar to set the map wavelength · colour marks wavelength only</span>
        <span className="ruler-preload" role="status">
          {ready.size >= scanSamples.length ? `${scanSamples.length} wavelengths ready`
            : `Preloading wavelengths ${ready.size}/${scanSamples.length}`}
        </span>
        <label className="ruler-speed">
          Speed
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            {scanSpeeds.map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
        </label>
        <button type="button" className="ruler-scan" aria-pressed={scanning} disabled={disabled}
          onClick={() => setScanning(!scanning)}>{scanning ? "Stop scan" : "Scan wavelengths"}</button>
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
        <span className="ruler-key-map" aria-hidden="true">┆</span> Map layer {shownUm.toFixed(3)} µm (band {shownBand}){scanning && " · scanning the all-sky mosaic, not dated frames"}
        {frameWavelengthUm !== null && <>
          {"  "}<span className="ruler-key-frame" aria-hidden="true">│</span> Frame on screen {frameWavelengthUm.toFixed(4)} µm
        </>}
      </p>
    </section>
  );
}
