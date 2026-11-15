import "./CheckChain.css";
import { useEffect, useState } from "react";

import { CatalogApiError, type CatalogClient } from "./api";
import type { ApiErrorBody, ChainStep, CheckChainRequest, CheckChainResponse } from "./types";

export interface CheckChainProps {
  /** The confirmed point. Null renders nothing. A new object starts a new check. */
  request: CheckChainRequest | null;
  client: Pick<CatalogClient, "checkChain">;
  /** Refuse to present synthetic fixture results next to real imagery. */
  requireLiveCatalog?: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: ApiErrorBody }
  | { kind: "done"; result: CheckChainResponse };

const statusLabels: Record<ChainStep["status"], string> = {
  match: "Listed",
  no_match: "Not listed",
  unavailable: "Not checked",
  not_configured: "Not set up",
  skipped: "Skipped",
};

const verdictTitles: Record<CheckChainResponse["verdict"], string> = {
  catalogued: "Already catalogued",
  uncatalogued_candidate: "Uncatalogued candidate",
  incomplete: "Check incomplete",
};

/** Runs the multi-catalog check chain for one confirmed sky point and lists each step's
 *  outcome in chain order. A step that could not run is shown as such, never as empty. */
export function CheckChain({ request, client, requireLiveCatalog = false }: CheckChainProps) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!request) {
      setState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    client
      .checkChain(request, controller.signal)
      .then((result) => {
        if (requireLiveCatalog && result.mode !== "live") {
          setState({
            kind: "error",
            error: {
              code: "live_catalog_required",
              message:
                "The catalog service is using synthetic test data. Start it with CATALOGS_LIVE=1 to check real points.",
            },
          });
        } else setState({ kind: "done", result });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          error:
            error instanceof CatalogApiError
              ? { code: error.code, message: error.message }
              : { code: "upstream_unavailable", message: "Could not reach the catalog service." },
        });
      });
    return () => controller.abort();
  }, [request, client, requireLiveCatalog]);

  if (state.kind === "idle") return null;
  if (state.kind === "loading")
    return (
      <div className="source-inspector check-chain" aria-busy="true">
        <p className="si-state__title" role="status">
          Checking catalogs…
        </p>
        <p className="si-state__detail">Gaia DR3, SIMBAD, CatWISE2020, UltracoolSheet, SkyBoT and VizieR.</p>
      </div>
    );
  if (state.kind === "error")
    return (
      <div className="source-inspector check-chain">
        <div className="si-state si-state--unavailable" role="alert">
          <p className="si-state__title">The check could not run</p>
          <p className="si-state__detail">{state.error.message}</p>
          <p className="si-state__code">{state.error.code}</p>
        </div>
      </div>
    );

  const { result } = state;
  return (
    <div className="source-inspector check-chain">
      <div className={`cc-verdict cc-verdict--${result.verdict}`} role="status">
        <p className="cc-verdict__title">{verdictTitles[result.verdict]}</p>
        <p className="cc-verdict__detail">{result.verdictMessage}</p>
      </div>
      {result.mode === "fixture" && (
        <p className="cc-fixture">Synthetic fixture data: these are not real catalog results.</p>
      )}
      <ol className="cc-steps">
        {result.steps.map((step) => (
          <li key={step.id} className={`cc-step cc-step--${step.status}`}>
            <div className="cc-step__head">
              <span className="cc-step__label">
                {step.referenceUrl ? (
                  <a href={step.referenceUrl} target="_blank" rel="noreferrer">
                    {step.label}
                  </a>
                ) : (
                  step.label
                )}
              </span>
              <span className="cc-chip">{statusLabels[step.status]}</span>
            </div>
            <p className="cc-step__message">{step.message}</p>
            {step.matches.length > 0 && (
              <ul className="cc-matches">
                {step.matches.map((match) => (
                  <li key={`${match.name}-${match.ra}`}>
                    <span className="cc-match__name">
                      {match.url ? (
                        <a href={match.url} target="_blank" rel="noreferrer">
                          {match.name}
                        </a>
                      ) : (
                        match.name
                      )}
                    </span>
                    <span className="cc-match__meta">
                      {match.separationArcsec.toFixed(1)}″
                      {match.positionPredicted && " · predicted position"}
                      {match.detail && ` · ${match.detail}`}
                    </span>
                  </li>
                ))}
                {step.matchCount > step.matches.length && (
                  <li className="cc-match__more">
                    +{step.matchCount - step.matches.length} more
                  </li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <p className="cc-footnote">
        Radius {result.radiusArcsec}″ around RA {result.ra.toFixed(5)}°, Dec {result.dec.toFixed(5)}°
        {result.epochUtc &&
          ` · positions moved to ${result.epochUtc.slice(0, 10)}${result.epochKind === "approximate" ? " (approximate mosaic date)" : ""}`}
        {" · checked "}
        <time dateTime={result.checkedAtUtc}>{result.checkedAtUtc}</time>
      </p>
    </div>
  );
}
