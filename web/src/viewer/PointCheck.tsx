import { useEffect, useState } from "react";
import type { CatalogReview } from "../inspector/api";
import { CatalogChecks } from "../findings/ReviewReport";
import { expectedPoints, catalogSources, nearestRow, summarize, type CatalogSource } from "./catalogCheckSummary";
import type { SkyPosition } from "./comparison";
import { pointReviewCache, type CheckPoint } from "./pointReviewCache";

export type { CheckPoint } from "./pointReviewCache";

type CatalogCheck = CatalogReview["checks"][number];

/** A point marked on the map (double-click), with the dated frame it was marked on, if any. */
export interface MarkedPoint {
  position: SkyPosition;
  /** Present only when the point lies on a shown, loaded dated frame. */
  frame: { observedAtUtc: string; label: string } | null;
  /** Marked on the SPHEREx all-sky mosaic (not DSS or WISE imagery). */
  onSpherexMosaic: boolean;
}

type CheckState = { kind: "loading"; started: number } | { kind: "done"; review: CatalogReview } | { kind: "error"; message: string };

const radii = [10, 30, 120, 300] as const;
const statusText: Record<CatalogCheck["status"], string> = {
  candidates: "Listed",
  partial: "Listed (partial)",
  no_candidates: "Nothing listed",
  unavailable: "Not checked: unavailable",
  skipped: "Not checked",
};

/** Checks one marked point against the catalog chain as soon as it is marked; no sign-in. */
export function PointCheck({ point, check, onClear, onReview, predictionTimeUtc = null, shownSourceId = null, onShowSource, onRadiusChange }: {
  point: MarkedPoint;
  check: CheckPoint;
  onClear: () => void;
  /** Time Gaia positions are moved to for display (the frame time, or the mosaic guide time). */
  predictionTimeUtc?: string | null;
  /** Catalog source currently drawn on the map. */
  shownSourceId?: string | null;
  /** Draws a catalog source on the map; null hides it. */
  onShowSource?: (source: CatalogSource | null) => void;
  /** Opens signed-in submission for any marked point, including the reference map. */
  onReview?: () => void;
  /** Reports the chosen search radius, so a submission scores the same cone. */
  onRadiusChange?: (radiusArcsec: number) => void;
}) {
  const [radius, setRadius] = useState<number>(30);
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{ key: string; check: CheckPoint; state: CheckState }>();
  const [, tick] = useState(0);
  const { ra, dec } = point.position;
  const observedAtUtc = point.frame?.observedAtUtc ?? null;
  const cache = pointReviewCache(check);
  const key = JSON.stringify([ra, dec, radius, observedAtUtc, attempt]);
  const cached = cache.lookup({ ra, dec, radiusArcsec: radius, observedAtUtc });
  const state: CheckState = response?.key === key && response.check === check ? response.state
    : cached.exact ? { kind: "done", review: cached.exact } : { kind: "loading", started: Date.now() };

  useEffect(() => {
    const request = { ra, dec, radiusArcsec: radius, observedAtUtc };
    const setState = (state: CheckState) => setResponse({ key, check, state });
    const { exact } = cache.lookup(request);
    if (exact) {
      setState({ kind: "done", review: exact });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading", started: Date.now() });
    check(request, controller.signal)
      .then(review => {
        if (controller.signal.aborted) return;
        cache.remember(request, review);
        setState({ kind: "done", review });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error && error.message ? error.message : "Could not reach the catalog service." });
      });
    return () => controller.abort();
  }, [cache, check, key, ra, dec, observedAtUtc, radius]);

  // Live checks can take tens of seconds; show that time is passing.
  useEffect(() => {
    if (state.kind !== "loading") return;
    const timer = window.setInterval(() => tick(n => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state.kind]);

  const summary = state.kind === "done" ? summarize(state.review) : null;
  const recentSources = state.kind !== "done" && cached.nearby
    ? catalogSources(cached.nearby, point.position, predictionTimeUtc).filter(source => source.separationArcsec <= radius)
    : [];
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
      {recentSources.length > 0 && (
        <>
          <p className="point-check__footnote">Catalog sources from a previous nearby check.</p>
          <SourceLists sources={recentSources} shownSourceId={shownSourceId} onShowSource={onShowSource} />
        </>
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
          <SourceLists sources={catalogSources(state.review, point.position, predictionTimeUtc)} shownSourceId={shownSourceId} onShowSource={onShowSource} />
          <details className="point-check__details">
            <summary>Records, sources and limitations</summary>
            <div className="review-report"><CatalogChecks checks={state.review.checks} /></div>
            <ul>{state.review.limitations.map(text => <li key={text}>{text}</li>)}</ul>
          </details>
          <p className="point-check__footnote">
            Positions are published catalog positions unless explicitly labeled as Gaia predictions. Checked {state.review.checks.find(c => c.retrievedAtUtc)?.retrievedAtUtc ?? "just now"}.
          </p>
        </>
      )}
      {state.kind === "done" && <Points review={state.review} />}
      {onReview && <button type="button" className="primary" onClick={onReview}>Submit to leaderboard</button>}
    </section>
  );
}

/** Every returned source with usable coordinates can be shown, with its catalog epoch intact. */
function SourceLists({ sources, shownSourceId, onShowSource }: {
  sources: CatalogSource[];
  shownSourceId: string | null;
  onShowSource?: (source: CatalogSource | null) => void;
}) {
  if (!sources.length) return null;
  const catalogs = [...new Set(sources.map(source => source.catalog))];
  return <section className="point-check__gaia" aria-label="Catalog sources near the marked point">
    <p className="point-check__subhead">Show catalog sources on the map</p>
    <p className="point-check__footnote">Gaia positions can be predicted for the displayed date. Other catalogs retain their published coordinates; these markers are not verified detections.</p>
    {catalogs.map(catalog => <details key={catalog} open>
      <summary>{catalog} sources ({sources.filter(source => source.catalog === catalog).length})</summary>
      <ul>{sources.filter(source => source.catalog === catalog).map(source => {
        const active = source.key === shownSourceId;
        return <li key={source.key}>
          <span className="point-check__gaia-name">{source.catalog} {source.name}</span>
          <span className="point-check__gaia-meta">{source.separationArcsec.toFixed(1)}″ from the mark · {source.label.slice(source.label.lastIndexOf('(') + 1, -1)}
            {!source.placeable && ' · no proper motion, cannot be moved to this date'}</span>
          {onShowSource && <button type="button" aria-pressed={active} disabled={!source.placeable}
            onClick={() => onShowSource(active ? null : source)}>{active ? 'Hide' : 'Show on map'}</button>}
        </li>;
      })}</ul>
    </details>)}
  </section>;
}

function Points({ review }: { review: CatalogReview }) {
  const expected = expectedPoints(review);
  return <section className="point-check__points" aria-label="Leaderboard points">
    <p className="point-check__subhead">Leaderboard points</p>
    <p className="point-check__points-value">{expected.label}</p>
    <p className="point-check__footnote">{expected.detail}</p>
  </section>;
}
