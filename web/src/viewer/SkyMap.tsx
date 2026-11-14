import { useEffect, useRef, useState } from "react";
import type { AladinView } from "aladin-lite";
import type { Field, SkyPosition } from "./comparison";

const globeFovDeg = 180;

export function SkyMap({
  initialCenter,
  focus,
  onCompare,
}: {
  initialCenter: SkyPosition;
  focus: Field | null;
  onCompare: (field: Field) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<AladinView | null>(null);
  const previousGlobeFov = useRef(globeFovDeg);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [allSky, setAllSky] = useState(false);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let disposed = false;

    async function initialize(element: HTMLElement) {
      try {
        const { default: Aladin } = await import("aladin-lite");
        await Aladin.init;
        if (disposed) return;
        view.current = Aladin.aladin(element, {
          cooFrame: "ICRSd",
          survey: "CDS/P/DSS2/color",
          projection: "SIN",
          fov: globeFovDeg,
          showProjectionControl: false,
          showLayersControl: false,
          showZoomControl: true,
          showSimbadPointerControl: false,
        });
        view.current.gotoRaDec(initialCenter.ra, initialCenter.dec);
        setState("ready");
      } catch (error) {
        if (disposed) return;
        console.error("Could not initialize Aladin Lite", error);
        setState("unavailable");
      }
    }

    void initialize(host);
    return () => {
      disposed = true;
      view.current = null;
    };
  }, [initialCenter]);

  useEffect(() => {
    if (!focus || state !== "ready" || !view.current) return;
    view.current.setProjection("SIN");
    view.current.gotoRaDec(focus.ra, focus.dec);
    view.current.setFoV(focus.fovArcmin / 60);
    setAllSky(false);
  }, [focus, state]);

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

  return (
    <section className="sky-section" aria-label="Reference sky map">
      <div className="sky-heading">
        <div>
          <h2>Sky map</h2>
          <p>DSS2 reference imagery · STScI/NASA and CDS</p>
        </div>
        <div className="controls">
          <button type="button" onClick={toggleProjection} disabled={state !== "ready"}>
            {allSky ? "Globe view" : "All sky"}
          </button>
          <button type="button" onClick={compareViewport} disabled={state !== "ready"}>
            Compare this field
          </button>
        </div>
      </div>
      <div className="sky-map">
        <div ref={container} className="aladin-host" />
        {state !== "ready" && (
          <p className="map-status" role="status">
            {state === "loading" ? "Loading sky map…" : "Sky map unavailable. Search below using coordinates or a preset."}
          </p>
        )}
      </div>
    </section>
  );
}
