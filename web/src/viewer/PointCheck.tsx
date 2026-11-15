import { useEffect, useRef, useState } from "react";
import type { CatalogReview } from "../inspector/api";
import { CatalogChecks } from "../findings/ReviewReport";
import { expectedPoints, gaiaNeighbours, nearestRow, summarize, type GaiaNeighbour } from "./catalogCheckSummary";
import type { SkyPosition } from "./comparison";

type CatalogCheck = CatalogReview["checks"][number];

/** A point marked on the map (double-click), with the dated frame it was marked on, if any. */
export interface MarkedPoint {
  position: SkyPosition;
  /** Present only when the point lies on a shown, loaded dated frame. */
  frame: { observedAtUtc: string; label: string } | null;
  /** Marked on the SPHEREx all-sky mosaic (not DSS or WISE imagery). */
  onSpherexMosaic: boolean;
}

/** A survey that can count toward the brightness rule, and whether its saved frames are loaded. */
export interface SurveyEvidence {
  label: string;
  loaded: boolean;
  /** Loads this survey's dated frames at the point. */
  onLoad?: () => void;
  /** Why it cannot count yet (e.g. NEOSSat previews are not measurable). */
  note?: string;
}

export type CheckPoint = (
  request: { ra: number; dec: number; radiusArcsec: number; observedAtUtc?: string | null },
  signal?: AbortSignal,
) => Promise<CatalogReview>;

const radii = [10, 30, 120, 300] as const;
const statusText: Record<CatalogCheck["status"], string> = {
  candidates: "Listed",
  partial: "Listed (partial)",
  no_candidates: "Nothing listed",
  unavailable: "Not checked: unavailable",
  skipped: "Not checked",
};

/** Checks one marked point against the catalog chain as soon as it is marked; no sign-in. */
export function PointCheck({ point, check, onClear, onReview, predictionTimeUtc = null, shownSourceId = null, onShowSource, surveys = [], submitHint, onRadiusChange }: {
  point: MarkedPoint;
  check: CheckPoint;
  onClear: () => void;
  /** Time Gaia positions are moved to for display (the frame time, or the mosaic guide time). */
  predictionTimeUtc?: string | null;
  /** Gaia source currently drawn on the map. */
  shownSourceId?: string | null;
  /** Draws a Gaia source on the map, as the source inspector's mark does; null hides it. */
  onShowSource?: (source: GaiaNeighbour | null) => void;
  /** Opens the signed-in submission for this point; offered only for points on a dated frame. */
  onReview?: () => void;
  /** Surveys counted by the brightness rule. */
  surveys?: SurveyEvidence[];
  /** Shown instead of the submit button when the point cannot be submitted yet. */
  submitHint?: { text: string; action?: { label: string; run: () => void } };
  /** Reports the chosen search radius, so a submission scores the same cone. */
  onRadiusChange?: (radiusArcsec: number) => void;
}) {
  const [radius, setRadius] = useState<number>(30);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ kind: "loading"; started: number } | { kind: "done"; review: CatalogReview } | { kind: "error"; message: string }>({ kind: "loading", started: Date.now() });
  const [, tick] = useState(0);
  const checkRef = useRef(check);
  checkRef.current = check;
  const { ra, dec } = point.position;
  const observedAtUtc = point.frame?.observedAtUtc ?? null;

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading", started: Date.now() });
    checkRef.current({ ra, dec, radiusArcsec: radius, observedAtUtc }, controller.signal)
      .then(review => { if (!controller.signal.aborted) setState({ kind: "done", review }); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error && error.message ? error.message : "Could not reach the catalog service." });
      });
    return () => controller.abort();
  }, [ra, dec, observedAtUtc, radius, attempt]);

  // Live checks can take tens of seconds; show that time is passing.
  useEffect(() => {
    if (state.kind !== "loading") return;
    const timer = window.setInterval(() => tick(n => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state.kind]);

  const summary = state.kind === "done" ? summarize(state.review) : null;
  return (
    <section className="point-check" aria-label="Catalog check for the marked point">
      <p className="point-check__where">
        <span>RA {ra.toFixed(5)}°, Dec {dec.toFixed(5)}°</span>
        <span>{point.frame
          ? <>On {point.frame.label}, observed <time dateTime={point.frame.observedAtUtc}>{point.frame.observedAtUtc}</time></>
          : "On the reference map (undated, so known asteroids are not checked)"}</span>
      </p>
      <div className="point-check__controls">
        <label>Search radius
          <select value={radius} onChange={event => { setRadius(Number(event.target.value)); onRadiusChange?.(Number(event.target.value)); }}>
            {radii.map(r => <option key={r} value={r}>{r}″</option>)}
          </select>
        </label>
        <button type="button" onClick={onClear}>Clear mark</button>
      </div>

      {state.kind === "loading" && (
        <p className="point-check__status" role="status" aria-busy="true">
          Checking Gaia DR3, SIMBAD, CatWISE2020, UltracoolSheet, SkyBoT and VizieR… {Math.round((Date.now() - state.started) / 1000)} s
        </p>
      )}
      {state.kind === "error" && (
        <div className="point-check__verdict point-check__verdict--incomplete" role="alert">
          <p className="point-check__title">The check could not run</p>
          <p>{state.message}</p>
          <button type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button>
        </div>
      )}
      {state.kind === "done" && summary && (
        <>
          <div className={`point-check__verdict point-check__verdict--${summary.tone}`} role="status">
            <p className="point-check__title">{summary.title}</p>
            <p>{summary.detail}</p>
            {state.review.checks.some(c => c.status === "unavailable") && (
              <button type="button" onClick={() => setAttempt(n => n + 1)}>Check again</button>
            )}
          </div>
          <ul className="point-check__steps">
            {state.review.checks.map(c => {
              const nearest = nearestRow(c, point.position);
              return (
                <li key={c.catalog} data-status={c.status}>
                  <strong>{c.catalog}</strong>
                  <span className="point-check__chip">{statusText[c.status]}{c.rows?.length ? ` · ${c.rows.length}` : ""}</span>
                  {nearest && <span className="point-check__nearest">nearest {nearest.name} at {nearest.arcsec.toFixed(1)}″</span>}
                </li>
              );
            })}
          </ul>
          <GaiaList neighbours={gaiaNeighbours(state.review, point.position, predictionTimeUtc)} predictionTimeUtc={predictionTimeUtc}
            frameTime={!!point.frame && predictionTimeUtc === point.frame.observedAtUtc} shownSourceId={shownSourceId} onShowSource={onShowSource} />
          <details className="point-check__details">
            <summary>Records, sources and limitations</summary>
            <div className="review-report"><CatalogChecks checks={state.review.checks} /></div>
            <ul>{state.review.limitations.map(text => <li key={text}>{text}</li>)}</ul>
          </details>
          <p className="point-check__footnote">
            Catalog positions are as published, not moved to the image date. Checked {state.review.checks.find(c => c.retrievedAtUtc)?.retrievedAtUtc ?? "just now"}.
          </p>
        </>
      )}
      {state.kind === "done" && <Points review={state.review} surveys={surveys} />}
      {onReview ? (
        <button type="button" className="primary" onClick={onReview}>Submit to leaderboard</button>
      ) : submitHint && (
        <div className="point-check__submit-hint">
          <p>{submitHint.text}</p>
          {submitHint.action && <button type="button" onClick={submitHint.action.run}>{submitHint.action.label}</button>}
        </div>
      )}
    </section>
  );
}

/** Nearby Gaia sources with a control to draw each on the map, nearest first. */
function GaiaList({ neighbours, predictionTimeUtc, frameTime, shownSourceId, onShowSource }: {
  neighbours: GaiaNeighbour[];
  predictionTimeUtc: string | null;
  frameTime: boolean;
  shownSourceId: string | null;
  onShowSource?: (source: GaiaNeighbour | null) => void;
}) {
  if (!neighbours.length) return null;
  const shown = neighbours.slice(0, 5);
  return (
    <section className="point-check__gaia" aria-label="Gaia sources near the marked point">
      <p className="point-check__subhead">
        Gaia DR3 near this point ·{" "}
        {predictionTimeUtc
          ? `positions predicted for ${predictionTimeUtc.slice(0, 10)}${frameTime ? " (frame time)" : " (approximate mosaic date)"}`
          : "catalog positions, epoch 2016.0"}
      </p>
      <ul>
        {shown.map(source => {
          const active = source.sourceId === shownSourceId;
          // A predicted map (dated frame or SPHEREx mosaic) needs proper motion to place a source.
          const placeable = !predictionTimeUtc || source.predicted !== null;
          return (
            <li key={source.sourceId}>
              <span className="point-check__gaia-name">Gaia DR3 {source.sourceId}</span>
              <span className="point-check__gaia-meta">
                {source.separationArcsec.toFixed(1)}″ from the mark{source.gMag !== null && ` · G ${source.gMag.toFixed(1)}`}
                {!placeable && " · no proper motion, cannot be moved to this date"}
              </span>
              {onShowSource && (
                <button type="button" aria-pressed={active} disabled={!placeable}
                  onClick={() => onShowSource(active ? null : source)}>
                  {active ? "Hide" : "Show on map"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {neighbours.length > shown.length && <p className="point-check__footnote">{neighbours.length - shown.length} more in the records below.</p>}
    </section>
  );
}

/** Expected leaderboard points and, for an uncatalogued point, which surveys can be measured. */
function Points({ review, surveys }: { review: CatalogReview; surveys: SurveyEvidence[] }) {
  const expected = expectedPoints(review);
  return (
    <section className="point-check__points" aria-label="Leaderboard points">
      <p className="point-check__subhead">Leaderboard points</p>
      <p className="point-check__points-value">{expected.label}</p>
      <p className="point-check__footnote">{expected.detail}</p>
      {expected.needsBrightness && surveys.length > 0 && (
        <ul className="point-check__surveys">
          {surveys.map(survey => (
            <li key={survey.label} data-loaded={survey.loaded || undefined}>
              <span>{survey.label}</span>
              {survey.loaded ? <span className="point-check__chip">saved frames loaded</span>
                : survey.onLoad ? <button type="button" onClick={survey.onLoad}>Load {survey.label} frames here</button>
                : <span className="point-check__chip">{survey.note ?? "not loaded"}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
