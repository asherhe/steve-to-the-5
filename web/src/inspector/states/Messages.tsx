import type { ApiErrorBody } from "../types";

export function LoadingView() {
  return (
    <div className="si-state si-state--loading" role="status" aria-busy="true">
      Searching the catalog…
    </div>
  );
}

export function IdleView() {
  return (
    <div className="si-state si-state--idle">
      Select a point on the sky to inspect the catalog.
    </div>
  );
}

export function UnmatchedView({ mosaic = false }: { mosaic?: boolean }) {
  return (
    <div className="si-state si-state--unmatched">
      <p className="si-state__title">No catalog source here</p>
      <p className="si-state__detail">
        {mosaic
          ? "None of the nearby Gaia catalog sources projects within the search radius at the mosaic guide date."
          : "No Gaia DR3 source falls within the search radius. This is a valid empty result, not a service error."}
      </p>
    </div>
  );
}

const UNAVAILABLE_TITLES: Record<string, string> = {
  // The archive itself is down: nothing to do with the position that was selected.
  upstream_unavailable: "The Gaia archive is not responding",
  // The request never reached the catalog service (an HTML page came back).
  catalog_route_unavailable: "Catalog service is not reachable",
  // The service is running on synthetic fixtures, which are not shown beside real imagery.
  live_catalog_required: "Catalog is in test-data mode",
};

/** A service problem, kept distinct from a genuine empty result (UnmatchedView). */
export function UnavailableView({ error, onRetry }: { error: ApiErrorBody; onRetry?: () => void }) {
  const outage = error.code === "upstream_unavailable";
  return (
    <div className="si-state si-state--unavailable" role="alert">
      <p className="si-state__title">{UNAVAILABLE_TITLES[error.code] ?? "Catalog unavailable"}</p>
      {outage && (
        <p className="si-state__detail">
          This is a problem reaching Gaia, not with the star you selected. Any point on the sky
          would show the same message right now.
        </p>
      )}
      <p className="si-state__detail">{error.message}</p>
      <p className="si-state__code">({error.code})</p>
      {onRetry && (
        <button type="button" className="si-retry" onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}
