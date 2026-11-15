import { DatedSkyOverlay, type DatedLayer } from "./DatedSkyOverlay";
import { cutoutWcs } from "./cutoutWcs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AladinView } from "aladin-lite";
import type { Field, SkyPosition } from "./comparison";
import { formatAngularSize, formatDec, formatRa, normalizeRa } from "./coordinates";
import {
  dssAcknowledgement, dssSurveyUrls, findSpherexSurvey, loadSpherexOverview, spherexBandChannel,
  spherexMosaicDoi, spherexSliceFrequencyHz, spherexSliceWavelength,
  type SpherexCube,
} from "./spherexSurvey";

type AladinModule = typeof import("aladin-lite").default;
type Imagery = "spherex" | "dss";
type LayerStatus = "loading" | "ready" | "unavailable";

const globeFovDeg = 180;
const referenceLayerId = "reference-sky";
const spherexDetailLayerId = "spherex-detail";
const imageryLabels: Record<Imagery, string> = { spherex: "SPHEREx", dss: "DSS" };

function placeReferenceLayer(sky: AladinView, layerId: string) {
  const stack = sky.getStackLayers();
  const earlier = stack.slice(0, stack.indexOf(layerId)).reverse();
  for (const id of earlier) {
    if (layerId === spherexDetailLayerId && id === referenceLayerId) break;
    if (sky.getOverlayImageLayer(id)) sky.view.swapLayers(id, layerId);
  }
}

function makeCubeCoverageOpaque(host: HTMLElement) {
  const gl = host.querySelector<HTMLCanvasElement>(".aladin-imageCanvas")?.getContext("webgl2");
  if (!gl) return;
  const shaderSource = gl.shaderSource.bind(gl);
  // Aladin 3.8's PNG cube shader treats its coverage channel as blend opacity.
  // Use binary coverage on this viewer's canvas, retaining the RGB values.
  gl.shaderSource = (shader, source) => {
    if (source.includes("vec4 color = uvw2c_ra(uv);")) {
      source = source.replace("out_frag_color.a = opacity * out_frag_color.a;",
        "if (out_frag_color.a <= 0.0) discard; out_frag_color.a = opacity;");
    }
    shaderSource(shader, source);
  };
}

export function SkyMap({
  initialCenter,
  focus,
  onCompare,
  onInspect,
  onAdvancedSearch,
  catalogMark,
  notice,
  dated, onInspectDated, slice, onStateChange, dock,
}: {
  initialCenter: SkyPosition;
  focus: Field | null;
  onCompare: (field: Field) => void;
  onInspect: (position: SkyPosition, onSpherexMosaic: boolean) => void;
  onAdvancedSearch: () => void;
  catalogMark: (SkyPosition & { predicted: boolean }) | null;
  notice: string;
  dated?: DatedLayer | null;
  onInspectDated?: (position: SkyPosition) => void;
  /** Cube slice shown as the SPHEREx reference layer. */
  slice: number;
  /** Reports the SPHEREx layer: `ready` only while it is the visible imagery and its wavelength can change. */
  onStateChange?: (state: LayerStatus) => void;
  /** Rendered below the map tools, across the bottom of the map. */
  dock?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const aladin = useRef<AladinModule | null>(null);
  const view = useRef<AladinView | null>(null);
  const spherexDetail = useRef<ReturnType<AladinModule["HiPS"]> | null>(null);
  const spherexOverview = useRef<ReturnType<AladinModule["HiPS"]> | null>(null);
  const layerToken = useRef(0);
  const markPosition = useRef<((position: SkyPosition | null) => void) | null>(null);
  const previousGlobeFov = useRef(globeFovDeg);
  const menu = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  const [viewStatus, setViewStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [cube, setCube] = useState<SpherexCube | "unavailable" | null>(null);
  const [imagery, setImagery] = useState<Imagery>("spherex");
  const sliceRef = useRef(slice);
  sliceRef.current = slice;
  const [layerStatus, setLayerStatus] = useState<LayerStatus>("loading");
  const [mapShown, setMapShown] = useState(false);
  const [allSky, setAllSky] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [readout, setReadout] = useState<{ ra: number; dec: number; width: number; height: number } | null>(null);

  function syncReadout() {
    const sky = view.current;
    if (!sky) return;
    const [ra, dec] = sky.getRaDec();
    const [width, height] = sky.getFoV();
    if ([ra, dec, width, height].every(Number.isFinite)) setReadout({ ra: normalizeRa(ra), dec, width, height });
  }

  // Create the Aladin view once; image layers are applied separately so switching keeps the position.
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let cancelled = false;
    setViewStatus("loading");

    async function initialize(element: HTMLElement) {
      try {
        const { default: Aladin } = await import("aladin-lite");
        await Aladin.init;
        if (cancelled) return;
        const sky = Aladin.aladin(element, {
          cooFrame: "ICRSd",
          // Start with an empty list so the reference layer is registered only once.
          survey: [],
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
        sky.contextMenu = null;
        makeCubeCoverageOpaque(element);
        sky.gotoRaDec(initialCenter.ra, initialCenter.dec);
        const catalog = Aladin.catalog({ name: "Marked Gaia position", color: "#7edaff", sourceSize: 14, shape: "circle" });
        sky.addCatalog(catalog);
        markPosition.current = (position) => {
          catalog.clear();
          if (position) catalog.addSources([Aladin.source(position.ra, position.dec)]);
        };
        sky.on("positionChanged", syncReadout);
        sky.on("zoomChanged", syncReadout);
        sky.on("resizeChanged", syncReadout);
        aladin.current = Aladin;
        view.current = sky;
        syncReadout();
        setViewStatus("ready");
      } catch (error) {
        if (cancelled) return;
        console.error("Could not initialize Aladin Lite", error);
        setViewStatus("failed");
      }
    }

    void initialize(host);
    return () => {
      cancelled = true;
      view.current = null;
      aladin.current = null;
      spherexDetail.current = null;
      spherexOverview.current = null;
      ++layerToken.current;
      markPosition.current = null;
      setViewStatus("loading");
    };
  }, [initialCenter]);

  // Check that the SPHEREx cube is reachable and read its wavelength list.
  useEffect(() => {
    const controller = new AbortController();
    setCube(null);
    void findSpherexSurvey(controller.signal).then((result) => {
      if (!controller.signal.aborted) setCube(result ?? "unavailable");
    });
    return () => controller.abort();
  }, [attempt]);

  // Apply the selected imagery as the base layer.
  useEffect(() => {
    const sky = view.current;
    const Aladin = aladin.current;
    if (viewStatus !== "ready" || !sky || !Aladin) return;
    const token = ++layerToken.current;
    const current = () => token === layerToken.current;
    const failed = (error: unknown) => {
      if (!current()) return;
      console.error(`Could not load ${imageryLabels[imagery]} imagery`, error);
      setLayerStatus("unavailable");
    };
    setLayerStatus("loading");

    if (imagery === "dss") {
      spherexDetail.current = null;
      spherexOverview.current = null;
      sky.removeImageLayer(spherexDetailLayerId);
      const tryMirror = (index: number) => sky.setOverlayImageLayer(Aladin.HiPS(dssSurveyUrls[index], {
        name: "DSS2 colour (optical reference)",
        successCallback: () => {
          if (!current()) return;
          placeReferenceLayer(sky, referenceLayerId);
          setLayerStatus("ready");
          setMapShown(true);
        },
        errorCallback: (error) => {
          if (current() && index + 1 < dssSurveyUrls.length) tryMirror(index + 1);
          else failed(error);
        },
      }), referenceLayerId);
      tryMirror(0);
      return;
    }
    if (cube === null) return;
    if (cube === "unavailable") {
      spherexDetail.current = null;
      sky.removeImageLayer(spherexDetailLayerId);
      setLayerStatus("unavailable");
      return;
    }

    const selectSlice = (layer: ReturnType<AladinModule["HiPS"]>) => {
      layer.setFrequency({ value: spherexSliceFrequencyHz(cube, sliceRef.current), unit: "Hz" });
    };
    const detail = Aladin.HiPS(cube.url, {
      name: "SPHEREx DR1 all-sky mosaic",
      successCallback: (added) => {
        if (!current()) return;
        selectSlice(added);
        spherexDetail.current = added;
        setLayerStatus("ready");
        setMapShown(true);
        placeReferenceLayer(sky, spherexDetailLayerId);
      },
      errorCallback: failed,
    });
    void detail.query.then(() => {
      if (!current()) return;
      // Aladin skips every layer below an opaque all-sky layer. Keep compositing
      // below the detail layer so missing PNG tiles can reveal the underlay.
      detail.skyFraction = Math.min(detail.skyFraction, 0.999);
      sky.setOverlayImageLayer(detail, spherexDetailLayerId);
    }).catch(failed);
  }, [imagery, cube, viewStatus, attempt]);

  useEffect(() => {
    const sky = view.current;
    const Aladin = aladin.current;
    if (!sky || !Aladin || viewStatus !== "ready" || imagery !== "spherex" || !cube || cube === "unavailable") return;
    const controller = new AbortController();
    const signal = controller.signal;
    spherexOverview.current?.setOpacity(0);
    spherexDetail.current?.setFrequency({ value: spherexSliceFrequencyHz(cube, slice), unit: "Hz" });
    const overviewFailed = (error: unknown) => {
      if (!signal.aborted) console.error("Could not load the SPHEREx overview", error);
    };
    void loadSpherexOverview(cube, slice, signal).then(async (tiles) => {
      const overview = Aladin.HiPS(tiles, {
        id: "spherex-overview",
        name: "SPHEREx DR1 all-sky overview",
        successCallback: (added) => {
          if (signal.aborted) return;
          placeReferenceLayer(sky, referenceLayerId);
          spherexOverview.current = added;
          setLayerStatus("ready");
          setMapShown(true);
        },
        errorCallback: overviewFailed,
      });
      await overview.query;
      if (!signal.aborted) sky.setOverlayImageLayer(overview, referenceLayerId);
    }).catch(overviewFailed);
    return () => controller.abort();
  }, [imagery, slice, viewStatus, cube]);

  useEffect(() => {
    if (!focus || viewStatus !== "ready" || !view.current) return;
    view.current.setProjection("SIN");
    view.current.gotoRaDec(focus.ra, focus.dec);
    const box = container.current?.getBoundingClientRect();
    view.current.setFoV(focus.fovArcmin / 60 * Math.max(1.4, box ? box.width / box.height * 1.4 : 1.4));
    setAllSky(false);
    syncReadout();
  }, [focus, viewStatus]);

  useEffect(() => {
    if (viewStatus !== "ready" || !view.current) return;
    const sky = view.current;
    sky.on("click", ({ ra, dec, isDragging }) => {
      if (!isDragging && Number.isFinite(ra) && Number.isFinite(dec)) {
        const point=dated && cutoutWcs(dated.comparison.grid)?.toImage({ra,dec});
        if(point && point.x>=-0.5 && point.y>=-0.5 && point.x<dated!.comparison.grid.width-0.5 && point.y<dated!.comparison.grid.height-0.5 && dated!.assets[dated!.frame.id]?.state==="ready")onInspectDated?.({ra,dec});
        else onInspect({ra,dec}, imagery === "spherex");
      }
    });
    return () => sky.on("click", () => {});
  }, [onInspect, onInspectDated, dated, imagery, viewStatus]);

  useEffect(() => {
    markPosition.current?.(catalogMark?.predicted === (imagery === "spherex") ? catalogMark : null);
  }, [catalogMark, imagery, viewStatus]);

  useEffect(() => {
    if (!menuOpen) return;
    function dismiss(event: PointerEvent) {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !menuButton.current?.contains(target)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menuOpen]);

  const datedReady = !!dated && dated.assets[dated.frame.id]?.state === "ready";
  const mapUsable = viewStatus === "ready" && (datedReady || (mapShown && layerStatus !== "unavailable"));
  const unavailable = viewStatus === "failed" || layerStatus === "unavailable";
  const wavelength = cube && cube !== "unavailable" ? spherexSliceWavelength(cube, slice) : null;
  const { band, channel } = spherexBandChannel(slice);
  const spherexState: LayerStatus = imagery === "spherex" && viewStatus !== "failed" ? layerStatus : "unavailable";

  useEffect(() => {
    onStateChange?.(spherexState);
  }, [onStateChange, spherexState]);

  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus();
  }

  function toggleProjection() {
    const sky = view.current;
    if (!sky) return;
    if (!allSky) previousGlobeFov.current = sky.getFoV()[0];
    sky.setProjection(allSky ? "SIN" : "AIT");
    sky.setFoV(allSky ? previousGlobeFov.current : 360);
    setAllSky(!allSky);
    syncReadout();
  }

  function compareViewport() {
    const sky = view.current;
    if (!sky) return;
    const [ra, dec] = sky.getRaDec();
    const [width] = sky.getFoV();
    onCompare({ ra: normalizeRa(ra), dec, fovArcmin: width * 60 });
  }

  function zoom(factor: number) {
    const sky = view.current;
    if (!sky) return;
    sky.setFoV(Math.min(allSky ? 360 : globeFovDeg, sky.getFoV()[0] * factor));
    syncReadout();
  }

  const statusText =
    viewStatus === "failed" ? "The sky map could not start. Search using coordinates or a preset." :
    layerStatus === "unavailable" ? `${imageryLabels[imagery]} imagery unavailable. Try again, switch imagery, or search using coordinates.` :
    layerStatus === "loading" || viewStatus === "loading" ? `Loading ${imageryLabels[imagery]} imagery…` : "";

  return (
    <section className="sky-section" aria-label="Reference sky map">
      <div className="sky-map">
        <div ref={container} className="aladin-host" data-hidden={!datedReady && (!mapShown || unavailable) || undefined} />
        {dated && view.current && aladin.current && <DatedSkyOverlay key={`${dated.comparison.id}-${dated.attempt}`} sky={view.current} aladin={aladin.current} dated={dated} redraw={readout} />}
        {statusText && !datedReady && <p className="map-status" role="status">{statusText}</p>}
      </div>
      <div className="sky-dock">
      <div className="sky-tools">
        {notice && <p className="sky-notice" role="status">{notice}</p>}
        {datedReady && statusText && <small className="reference-status">Reference sky: {statusText}</small>}
        <p className="sky-readout">
          {readout && mapUsable ? (
            <>
              <span title={`RA ${readout.ra.toFixed(5)}° (ICRS)`}>RA {formatRa(readout.ra)}</span>
              <span title={`Dec ${readout.dec.toFixed(5)}° (ICRS)`}>Dec {formatDec(readout.dec)}</span>
              <span title="Field of view, width × height">FoV {formatAngularSize(readout.width)} × {formatAngularSize(readout.height)}</span>
            </>
          ) : <span>Map center unavailable</span>}
        </p>
        <div className="imagery-row">
          <div className="segmented" role="group" aria-label="Map imagery">
            {(["spherex", "dss"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={imagery === option} disabled={viewStatus !== "ready"}
                onClick={() => setImagery(option)}>{imageryLabels[option]}</button>
            ))}
          </div>
        </div>
        <div className="controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(0.5)} disabled={!mapUsable}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(2)} disabled={!mapUsable}>−</button>
          <button type="button" onClick={compareViewport} disabled={!mapUsable}>
            Compare this field
          </button>
          {unavailable && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry imagery</button>}
          <button ref={menuButton} type="button" className="menu-button" aria-label="More map options"
            aria-expanded={menuOpen} aria-controls="map-menu" onClick={() => setMenuOpen(!menuOpen)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </div>
        <div id="map-menu" ref={menu} className="map-menu" hidden={!menuOpen} onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
          }
        }}>
          <button type="button" disabled={!mapUsable} onClick={() => { toggleProjection(); closeMenu(); }}>
            {allSky ? "Globe view" : "All-sky view"}
          </button>
          <button type="button" disabled={!mapUsable} onClick={() => {
            const center = view.current?.getRaDec();
            if (center) onInspect({ ra: normalizeRa(center[0]), dec: center[1] }, imagery === "spherex");
            setMenuOpen(false);
          }}>
            Inspect map center
          </button>
          <button type="button" onClick={() => { setMenuOpen(false); onAdvancedSearch(); }}>Advanced search</button>
        </div>
        {mapUsable && layerStatus === "ready" && (imagery === "spherex" ? (
          <small>
            <a href={spherexMosaicDoi}>SPHEREx DR1 all-sky mosaic</a>
            {wavelength !== null && <> · {wavelength.toFixed(3)} µm</>} · band {band}, channel {channel}
            {" "}· combined observations, not dated · NASA/SPHEREx · Caltech/IPAC IRSA
          </small>
        ) : (
          <small>
            <a href={dssAcknowledgement}>DSS2 colour</a> · optical reference survey, not SPHEREx · STScI · HiPS by CDS
          </small>
        ))}
      </div>
      {dock}
      </div>
    </section>
  );
}
