import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { AladinImageSurvey, AladinView } from "aladin-lite";
import type { Field, SkyPosition } from "./comparison";
import { findSpherexSurvey, isSpherexTileUrl, spherexMosaicDoi, spherexSliceWavelengthsUm, spherexTileBase } from "./spherexSurvey";
import { watchTiles, type TileWatch } from "./tileWatch";
import { findWiseSurvey, wiseMap, type SkyView } from "./wiseSurvey";
import type { FieldLimits } from "./FieldSearch";
import { compareReachDeg, fieldWidthFromView } from "./compareField";

const globeFovDeg = 180;

export function SkyMap({
  initialCenter,
  focus,
  onCompare,
  onInspect,
  catalogMark,
  notice,
  slice,
  survey = "spherex",
  compareLimits,
  tiles,
  pinnedField = null,
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
  /** Survey shown as the map layer. Switching keeps the centre, zoom and projection. */
  survey?: SkyView;
  /** Field widths the current comparison service accepts, in arcmin. */
  compareLimits: FieldLimits;
  /** Set to a watcher of the map's tile requests, which a wavelength scan uses to load ahead. */
  tiles?: MutableRefObject<TileWatch | null>;
  /** Field being fetched. It is drawn at its sky position and stays there as the map moves. */
  pinnedField?: Field | null;
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
  const outline = useRef<((field: Field | null) => void) | null>(null);
  const previousGlobeFov = useRef(globeFovDeg);
  const appliedFocus = useRef<Field | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [surveyAttempt, setSurveyAttempt] = useState(0);
  const [allSky, setAllSky] = useState(false);
  // Width of the map view in degrees, kept current so the compare control can react to zoom.
  const [viewWidthDeg, setViewWidthDeg] = useState<number | null>(null);

  // Shows the chosen survey. The Aladin view is created once and kept: later changes
  // only swap its base layer, so the centre, zoom and projection are untouched.
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const controller = new AbortController();
    setState("loading");

    async function show(element: HTMLElement) {
      try {
        const [{ default: Aladin }, url] = await Promise.all([
          import("aladin-lite"),
          (survey === "spherex" ? findSpherexSurvey : findWiseSurvey)(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (!url) {
          setState("unavailable");
          return;
        }
        await Aladin.init;
        if (controller.signal.aborted) return;
        layer.current = null;
        const hips = Aladin.HiPS(url, {
          name: survey === "spherex" ? "SPHEREx DR1 all-sky mosaic" : wiseMap.name,
          successCallback: (loaded) => {
            if (controller.signal.aborted) return;
            if (survey === "spherex") {
              layer.current = loaded;
              loaded.setSliceNumber(currentSlice.current);
            }
            setState("ready");
          },
          errorCallback: (error) => {
            if (controller.signal.aborted) return;
            console.error(`Could not load the ${survey === "spherex" ? "SPHEREx mosaic" : "WISE map"}`, error);
            setState("unavailable");
          },
        });
        if (view.current) {
          view.current.setBaseImageLayer(hips);
          return;
        }
        view.current = Aladin.aladin(element, {
          cooFrame: "ICRSd",
          survey: hips,
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
          // Its only remaining message here would be "Opening menu..." on touch-hold.
          showStatusBar: false,
        });
        // Aladin opens its stock menu on right-click and touch-hold even with showContextMenu
        // off; every map path checks this property first, so clearing it removes the menu.
        view.current.contextMenu = null;
        view.current.gotoRaDec(initialCenter.ra, initialCenter.dec);
        const catalog = Aladin.catalog({ name: "Marked Gaia position", color: "#7edaff", sourceSize: 14, shape: "circle" });
        view.current.addCatalog(catalog);
        const sky = view.current;
        const box = Aladin.graphicOverlay({ name: "Requested field", color: "#ffb547", lineWidth: 2 });
        view.current.addOverlay(box);
        outline.current = (field) => {
          box.removeAll();
          // Aladin redraws overlays only on its own schedule; without this a cleared outline lingers.
          sky.view.requestRedraw();
          if (!field) return;
          // A square on the tangent plane, as the comparison grid is.
          const half = field.fovArcmin / 120;
          const dra = half / Math.max(Math.cos(field.dec * Math.PI / 180), 1e-6);
          const at = (sx: number, sy: number): [number, number] =>
            [(field.ra + sx * dra + 360) % 360, Math.max(-90, Math.min(90, field.dec + sy * half))];
          box.add(Aladin.polygon([at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)]));
        };
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

    void show(host);
    return () => controller.abort();
  }, [initialCenter, survey, surveyAttempt]);

  useEffect(() => () => {
    view.current = null;
    layer.current = null;
    markPosition.current = null;
    outline.current = null;
  }, []);

  useEffect(() => {
    outline.current?.(pinnedField);
  }, [pinnedField, state]);

  // Aladin gives no "tiles loaded" signal, but it fetches them; watching those requests lets a
  // wavelength scan load ahead and move on only when the next wavelength can draw at once.
  useEffect(() => {
    if (!tiles) return;
    const watch = watchTiles(isSpherexTileUrl, spherexTileBase);
    tiles.current = watch;
    return () => {
      watch.stop();
      tiles.current = null;
    };
  }, [tiles]);

  useEffect(() => {
    // Only a new focus moves the map. Reloading imagery, as on a survey switch, does not.
    if (!focus || state !== "ready" || !view.current || appliedFocus.current === focus) return;
    appliedFocus.current = focus;
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
    if (state !== "ready" || !view.current) return;
    const sky = view.current;
    setViewWidthDeg(sky.getFoV()[0]);
    sky.on("zoomChanged", () => setViewWidthDeg(sky.getFoV()[0]));
    return () => sky.on("zoomChanged", () => {});
  }, [state]);

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
    setViewWidthDeg(sky.getFoV()[0]);
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
    if (!sky) return;
    sky.setFoV(Math.min(allSky ? 360 : globeFovDeg, sky.getFoV()[0] * factor));
    setViewWidthDeg(sky.getFoV()[0]);
  }

  const surveyName = survey === "spherex" ? "SPHEREx" : "WISE";
  // The field a compare would use from this zoom, or null when the view is too wide.
  const compareWidth = state === "ready" && viewWidthDeg !== null ? fieldWidthFromView(viewWidthDeg, compareLimits) : null;
  // From a wide view only the central part is compared; a box on the map marks it.
  const boxPercent = compareWidth !== null && viewWidthDeg !== null && compareWidth < viewWidthDeg * 60 - 1e-9
    ? 100 * (compareWidth / 60) / viewWidthDeg : null;
  const widthLabel = compareWidth === null ? "" : `${Number(compareWidth.toFixed(1))} arcmin`;

  return (
    <section className="sky-section" aria-label="Reference sky map">
      <div className="sky-map">
        <div ref={container} className="aladin-host" />
        {boxPercent !== null && (
          <div className="compare-field" style={{ width: `${boxPercent}%` }} aria-hidden="true">
            <span>{widthLabel} field</span>
          </div>
        )}
        {state !== "ready" && (
          <p className="map-status" role="status">
            {state === "loading" ? `Loading ${surveyName} imagery…` : `${surveyName} imagery unavailable. Search using coordinates or a preset.`}
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
          <button type="button" className="compare-button" onClick={compareViewport} disabled={state !== "ready"}
            data-ready={compareWidth !== null || undefined} aria-describedby="compare-hint">
            Compare this field
          </button>
          <span id="compare-hint" className="visually-hidden">
            {compareWidth !== null
              ? `Ready: compares ${boxPercent !== null ? "the central " : ""}${widthLabel} at the map centre.`
              : `Zoom in until the map is under ${compareReachDeg}° wide to compare.`}
          </span>
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
        {state === "ready" && (survey === "spherex" ? (
          <small><a href={spherexMosaicDoi}>SPHEREx DR1 all-sky mosaic</a> · {spherexSliceWavelengthsUm[slice].toFixed(3)} µm · NASA/SPHEREx · Caltech/IPAC IRSA</small>
        ) : (
          <small><a href={wiseMap.link}>{wiseMap.name}</a> · reference map, false colour · NASA/JPL-Caltech/UCLA · CDS HiPS</small>
        ))}
      </div>
      {dock}
      </div>
    </section>
  );
}
