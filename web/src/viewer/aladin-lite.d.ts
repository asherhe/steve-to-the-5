declare module "aladin-lite" {
  interface AladinImageSurvey {
    setSliceNumber(slice: number): void;
  }

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
    HiPS(url: string, options: {
      name: string;
      successCallback: (survey: AladinImageSurvey) => void;
      errorCallback: (error: unknown) => void;
    }): AladinImageSurvey;
    catalog(options: { name: string; color: string; sourceSize: number; shape: "circle" }): AladinCatalog;
    source(ra: number, dec: number): unknown;
    aladin(
      element: HTMLElement,
      options: {
        cooFrame: "ICRSd";
        survey: string | AladinImageSurvey;
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
