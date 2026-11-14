import { useEffect, useRef, useState } from "react";

import { CatalogApiError, type CatalogClient } from "./api";
import { AmbiguousView } from "./states/AmbiguousView";
import { IdleView, LoadingView, UnavailableView, UnmatchedView } from "./states/Messages";
import { SourceDetailView } from "./states/SourceDetailView";
import type {
  InspectorState,
  MarkAction,
  NearbySource,
  SelectedFrameMeta,
  SkyPosition,
} from "./types";

export interface SourceInspectorProps {
  /** Sky position to inspect (ICRS decimal degrees). Null hides the inspector in idle. */
  skyPosition: SkyPosition | null;
  /** Catalog client used to fetch nearby sources and detail. */
  client: CatalogClient;
  /** Optional metadata of the active comparison frame, used for predicted positions. */
  selectedFrame?: SelectedFrameMeta | null;
  /** Search radius in arcseconds. */
  radiusArcsec?: number;
  /** Emitted when the user marks a position. A findings pin and a selected image position
   *  use the same sky coordinates. */
  onMark: (mark: MarkAction) => void;
  /** Test/harness override: render this exact state instead of fetching. */
  initialState?: InspectorState;
}

/** The source inspector, exported for use in a standalone harness and, at integration, in
 *  the app-shell map panel. It takes a sky position and optional selected-frame metadata and
 *  emits a mark action. It does not own or edit shared map windowing. */
export function SourceInspector({
  skyPosition,
  client,
  selectedFrame,
  radiusArcsec = 30,
  onMark,
  initialState,
}: SourceInspectorProps) {
  const [state, setState] = useState<InspectorState>(initialState ?? { kind: "idle" });
  // Which source is chosen in the ambiguous list.
  const [chosen, setChosen] = useState<NearbySource | null>(null);
  const requestId = useRef(0);

  // When driven by an explicit state (tests/harness), do not fetch.
  const controlled = initialState !== undefined;

  useEffect(() => {
    if (controlled) return;
    if (!skyPosition) {
      setState({ kind: "idle" });
      setChosen(null);
      return;
    }
    const id = ++requestId.current;
    setState({ kind: "loading" });
    setChosen(null);

    client
      .nearby(skyPosition.ra, skyPosition.dec, radiusArcsec)
      .then((resp) => {
        if (id !== requestId.current) return; // stale
        const sources = resp.sources;
        if (sources.length === 0) {
          setState({ kind: "unmatched", sources: [] });
        } else if (sources.length === 1) {
          loadDetail(sources[0], id);
        } else {
          setState({ kind: "ambiguous", sources });
        }
      })
      .catch((err) => {
        if (id !== requestId.current) return;
        setState({
          kind: "unavailable",
          error:
            err instanceof CatalogApiError
              ? { code: err.code, message: err.message }
              : { code: "upstream_unavailable", message: String(err) },
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skyPosition?.ra, skyPosition?.dec, radiusArcsec, controlled]);

  function loadDetail(source: NearbySource, id: number) {
    setState({ kind: "matched", source, detail: null });
    client
      .detail(source.sourceId)
      .then((detail) => {
        if (id !== requestId.current) return;
        setState({ kind: "matched", source, detail });
      })
      .catch(() => {
        // Detail is enrichment; keep the nearby row if detail fails.
        if (id !== requestId.current) return;
        setState({ kind: "matched", source, detail: null });
      });
  }

  function chooseFromAmbiguous(source: NearbySource) {
    setChosen(source);
    if (!controlled) loadDetail(source, requestId.current);
  }

  return (
    <section className="source-inspector" aria-label="Source inspector">
      {renderBody()}
    </section>
  );

  function renderBody() {
    switch (state.kind) {
      case "idle":
        return <IdleView />;
      case "loading":
        return <LoadingView />;
      case "unavailable":
        return <UnavailableView error={state.error} />;
      case "unmatched":
        return <UnmatchedView />;
      case "ambiguous":
        return (
          <>
            <AmbiguousView
              sources={state.sources}
              onSelect={chooseFromAmbiguous}
              selectedId={chosen?.sourceId ?? null}
            />
            {chosen && (
              <SourceDetailView
                source={chosen}
                detail={null}
                selectedFrame={selectedFrame}
                onMark={onMark}
              />
            )}
          </>
        );
      case "matched":
        return (
          <SourceDetailView
            source={state.source}
            detail={state.detail}
            selectedFrame={selectedFrame}
            onMark={onMark}
          />
        );
    }
  }
}
