import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AladinImageSurvey, AladinView } from "aladin-lite";
import type { Field, SkyPosition } from "./comparison";
import { findSpherexSurvey, spherexMosaicDoi, spherexSliceWavelengthsUm } from "./spherexSurvey";

const globeFovDeg = 180;

export function SkyMap({
  initialCenter,
  focus,
  onCompare,
  onInspect,
  catalogMark,
  notice,
  slice,
  onStateChange,
  dock,
}: {
  initialCenter: SkyPosition;
  focus: Field | null;
  onCompare: (field: Field) => void;
  onInspect: (position: SkyPosition) => void;
  catalogMark: SkyPosition | null;
  notice: string;
  /** Cube slice shown as the reference layer. */
  slice: number;
  onStateChange?: (state: "loading" | "ready" | "unavailable") => void;
  /** Rendered below the map tools, across the bottom of the map. */
  dock?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<AladinView | null>(null);
  const layer = useRef<AladinImageSurvey | null>(null);
  const currentSlice = useRef(slice);
  currentSlice.current = slice;
  const markPosition = useRef<((position: SkyPosition | null) => void) | null>(null);
  const previousGlobeFov = useRef(globeFovDeg);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [surveyAttempt, setSurveyAttempt] = useState(0);
  const [allSky, setAllSky] = useState(false);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const controller = new AbortController();
    setState("loading");

    async function initialize(element: HTMLElement) {
      try {
        const [{ default: Aladin }, survey] = await Promise.all([
          import("aladin-lite"), findSpherexSurvey(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (!survey) {
          setState("unavailable");
          return;
        }
        await Aladin.init;
        if (controller.signal.aborted) return;
        view.current = Aladin.aladin(element, {
          cooFrame: "ICRSd",
          survey: Aladin.HiPS(survey, {
            name: "SPHEREx DR1 all-sky mosaic",
            successCallback: (survey) => {
              if (controller.signal.aborted) return;
              layer.current = survey;
              survey.setSliceNumber(currentSlice.current);
              setState("ready");
            },
            errorCallback: (error) => {
              if (controller.signal.aborted) return;
              console.error("Could not load the SPHEREx mosaic", error);
              setState("unavailable");
            },
          }),
          projection: "SIN",
          fov: globeFovDeg,
          showProjectionControl: false,
          showLayersControl: false,
          showZoomControl: false,
          showFullscreenControl: false,
          showSettingsControl: false,
          showCooLocation: false,
          // The frame is fixed to ICRSd; its selector would sit under the leaderboard button.
          showFrame: false,
          showFov: false,
          showSimbadPointerControl: false,
        });
        view.current.gotoRaDec(initialCenter.ra, initialCenter.dec);
        const catalog = Aladin.catalog({ name: "Marked Gaia position", color: "#7edaff", sourceSize: 14, shape: "circle" });
        view.current.addCatalog(catalog);
        markPosition.current = (position) => {
          catalog.clear();
          if (position) catalog.addSources([Aladin.source(position.ra, position.dec)]);
        };
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Could not initialize Aladin Lite", error);
        setState("unavailable");
      }
    }

    void initialize(host);
    return () => {
      controller.abort();
      view.current = null;
      layer.current = null;
      markPosition.current = null;
    };
  }, [initialCenter, surveyAttempt]);

  useEffect(() => {
    if (!focus || state !== "ready" || !view.current) return;
    view.current.setProjection("SIN");
    view.current.gotoRaDec(focus.ra, focus.dec);
    view.current.setFoV(focus.fovArcmin / 60);
    setAllSky(false);
  }, [focus, state]);

  useEffect(() => {
    if (state !== "ready" || !view.current) return;
    const sky = view.current;
    sky.on("click", ({ ra, dec, isDragging }) => {
      if (!isDragging && Number.isFinite(ra) && Number.isFinite(dec)) onInspect({ ra, dec });
    });
    return () => sky.on("click", () => {});
  }, [onInspect, state]);

  useEffect(() => {
    if (state === "ready") layer.current?.setSliceNumber(slice);
  }, [slice, state]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  useEffect(() => {
    markPosition.current?.(catalogMark);
  }, [catalogMark, state]);

  function toggleProjection() {
    const sky = view.current;
    if (!sky) return;
    if (!allSky) previousGlobeFov.current = sky.getFoV()[0];
    sky.setProjection(allSky ? "SIN" : "AIT");
    sky.setFoV(allSky ? previousGlobeFov.current : 360);
    setAllSky(!allSky);
  }

  function compareViewport() {
    const sky = view.current;
    if (!sky) return;
    const [ra, dec] = sky.getRaDec();
    const [width] = sky.getFoV();
    onCompare({ ra: ((ra % 360) + 360) % 360, dec, fovArcmin: width * 60 });
  }

  function zoom(factor: number) {
    const sky = view.current;
    if (sky) sky.setFoV(Math.min(allSky ? 360 : globeFovDeg, sky.getFoV()[0] * factor));
  }

  return (
    <section className="sky-section" aria-label="Reference sky map">
      <div className="sky-map">
        <div ref={container} className="aladin-host" />
        {state !== "ready" && (
          <p className="map-status" role="status">
            {state === "loading" ? "Loading SPHEREx imagery…" : "SPHEREx imagery unavailable. Search using coordinates or a preset."}
          </p>
        )}
      </div>
      <div className="sky-dock">
      <div className="sky-tools">
        {notice && <p className="sky-notice" role="status">{notice}</p>}
        <div className="controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(0.5)} disabled={state !== "ready"}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(2)} disabled={state !== "ready"}>−</button>
          <button type="button" onClick={toggleProjection} disabled={state !== "ready"}>
            {allSky ? "Globe view" : "All sky"}
          </button>
          <button type="button" onClick={compareViewport} disabled={state !== "ready"}>
            Compare this field
          </button>
          <button type="button" disabled={state !== "ready"} onClick={() => {
            const center = view.current?.getRaDec();
            if (center) onInspect({ ra: center[0], dec: center[1] });
          }}>
            Inspect map center
          </button>
        </div>
        {state === "unavailable" && (
          <button type="button" onClick={() => setSurveyAttempt((attempt) => attempt + 1)}>Retry imagery</button>
        )}
        {state === "ready" && (
          <small><a href={spherexMosaicDoi}>SPHEREx DR1 all-sky mosaic</a> · {spherexSliceWavelengthsUm[slice].toFixed(3)} µm · NASA/SPHEREx · Caltech/IPAC IRSA</small>
        )}
      </div>
      {dock}
      </div>
    </section>
  );
}
