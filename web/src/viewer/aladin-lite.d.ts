declare module "aladin-lite" {
  export interface AladinView {
    getRaDec(): [ra: number, dec: number];
    getFoV(): [width: number, height: number];
    gotoRaDec(ra: number, dec: number): void;
    setFoV(degrees: number): void;
    setProjection(projection: "SIN" | "AIT"): void;
    on(event: "click", callback: (position: { ra: number; dec: number; isDragging: boolean }) => void): void;
    addCatalog(catalog: AladinCatalog): void;
  }

  interface AladinCatalog {
    clear(): void;
    addSources(sources: unknown[]): void;
  }

  const Aladin: {
    init: Promise<unknown>;
    catalog(options: { name: string; color: string; sourceSize: number; shape: "circle" }): AladinCatalog;
    source(ra: number, dec: number): unknown;
    aladin(
      element: HTMLElement,
      options: {
        cooFrame: "ICRSd";
        survey: string;
        projection: "SIN";
        fov: number;
        showProjectionControl: boolean;
        showLayersControl: boolean;
        showZoomControl: boolean;
        showFullscreenControl: boolean;
        showSettingsControl: boolean;
        showCooLocation: boolean;
        showFov: boolean;
        showSimbadPointerControl: boolean;
      },
    ): AladinView;
  };
  export default Aladin;
}
