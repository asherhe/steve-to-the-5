import { useEffect, useRef, useState } from "react";

import { CatalogApiError, type CatalogClient } from "./api";
import { AmbiguousView } from "./states/AmbiguousView";
import { IdleView, LoadingView, UnavailableView, UnmatchedView } from "./states/Messages";
import { SourceDetailView } from "./states/SourceDetailView";
import { angularSeparationArcsec, predictAtObservation } from "./propagate";
import type {
  GaiaDetail,
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
  /** Representative time for the undated SPHEREx mosaic. */
  mosaicGuideTimeUtc?: string;
  /** Known high-proper-motion source near the selected mosaic position. */
  mosaicGuideSourceId?: string;
  /** Require measured catalog data when the inspector is used alongside real imagery. */
  requireLiveCatalog?: boolean;
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
  mosaicGuideTimeUtc,
  mosaicGuideSourceId,
  requireLiveCatalog = false,
  radiusArcsec = 30,
  onMark,
  initialState,
}: SourceInspectorProps) {
  const [state, setState] = useState<InspectorState>(initialState ?? { kind: "idle" });
  // Which source is chosen in the ambiguous list.
  const [chosen, setChosen] = useState<NearbySource | null>(null);
  const requestId = useRef(0);
  const guideDetail = useRef<GaiaDetail | null>(null);

  // When driven by an explicit state (tests/harness), do not fetch.
  const controlled = initialState !== undefined;

  useEffect(() => {
    if (controlled) return;
    const id = ++requestId.current;
    guideDetail.current = null;
    if (!skyPosition) {
      setState({ kind: "idle" });
      setChosen(null);
      return;
    }
    setState({ kind: "loading" });
    setChosen(null);

    // Barnard's Star moves about 103 arcsec from Gaia's epoch to the DR1 midpoint.
    // Fetch a wider catalog cone for the mosaic, then apply the original click radius.
    const catalogRadius = mosaicGuideTimeUtc ? Math.min(radiusArcsec + 120, 300) : radiusArcsec;
    const guideRequest = mosaicGuideSourceId
      ? client.detail(mosaicGuideSourceId).catch(() => null)
      : Promise.resolve(null);
    Promise.all([client.nearby(skyPosition.ra, skyPosition.dec, catalogRadius), guideRequest])
      .then(([resp, guide]) => {
        if (id !== requestId.current) return; // stale
        if (requireLiveCatalog && resp.catalogMode !== "live") {
          setState({
            kind: "unavailable",
            error: {
              code: "live_catalog_required",
              message: resp.catalogMode === "fixture"
                ? "The catalog service is using synthetic test data. Start Gaia with CATALOGS_LIVE=1 to inspect real imagery."
                : "The catalog service did not report its data mode. Restart the Gaia service from this checkout.",
            },
          });
          return;
        }
        guideDetail.current = guide;
        // The reference-epoch cone can hit its row limit before reaching a fast mover.
        const candidates = guide
          ? [...resp.sources.filter(source => source.sourceId !== guide.sourceId), { ...guide, separationArcsec: 0 }]
          : resp.sources;
        const sources = mosaicGuideTimeUtc
          ? candidates.flatMap(source => {
              const prediction = predictAtObservation(source, mosaicGuideTimeUtc);
              if (!prediction) return [];
              const separationArcsec = angularSeparationArcsec(skyPosition, prediction);
              return separationArcsec <= radiusArcsec ? [{ ...source, separationArcsec }] : [];
            }).sort((a, b) => a.separationArcsec - b.separationArcsec)
          : candidates;
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
  }, [skyPosition?.ra, skyPosition?.dec, radiusArcsec, controlled, requireLiveCatalog, mosaicGuideTimeUtc, mosaicGuideSourceId]);

  function loadDetail(source: NearbySource, id: number) {
    if (guideDetail.current?.sourceId === source.sourceId) {
      setState({ kind: "matched", source, detail: guideDetail.current });
      return;
    }
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
        return <UnmatchedView mosaic={!!mosaicGuideTimeUtc} />;
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
                mosaicGuideTimeUtc={mosaicGuideTimeUtc}
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
            mosaicGuideTimeUtc={mosaicGuideTimeUtc}
            onMark={onMark}
          />
        );
    }
  }
}
