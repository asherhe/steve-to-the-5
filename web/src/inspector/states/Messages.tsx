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

export function UnmatchedView() {
  return (
    <div className="si-state si-state--unmatched">
      <p className="si-state__title">No catalog source here</p>
      <p className="si-state__detail">
        No Gaia DR3 source falls within the search radius. This is a valid empty result, not a
        service error.
      </p>
    </div>
  );
}

export function UnavailableView({ error }: { error: ApiErrorBody }) {
  return (
    <div className="si-state si-state--unavailable" role="alert">
      <p className="si-state__title">Catalog unavailable</p>
      <p className="si-state__detail">{error.message}</p>
      <p className="si-state__code">({error.code})</p>
    </div>
  );
}
