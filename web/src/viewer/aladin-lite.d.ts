declare module "aladin-lite" {
  interface AladinImageSurvey {
    setFrequency(frequency: { value: number; unit: "Hz" }): void;
  }

  export interface AladinImage {
    setOpacity(opacity: number): void;
  }
  export interface AladinView {
    world2pix(ra: number, dec: number): [number, number] | undefined;
    setOverlayImageLayer(image: AladinImage, id: string): void;
    removeImageLayer(id: string): void;
    getRaDec(): [ra: number, dec: number];
    getFoV(): [width: number, height: number];
    gotoRaDec(ra: number, dec: number): void;
    setFoV(degrees: number): void;
    setProjection(projection: "SIN" | "AIT"): void;
    setBaseImageLayer(layer: AladinImageSurvey): void;
    on(event: "click", callback: (position: { ra: number; dec: number; isDragging: boolean }) => void): void;
    on(event: "positionChanged", callback: (position: { ra: number; dec: number; dragging: boolean }) => void): void;
    on(event: "zoomChanged", callback: (fovDegrees: number) => void): void;
    on(event: "resizeChanged", callback: (width: number, height: number) => void): void;
    on(event: "projectionChanged", callback: (projection: string) => void): void;
    addCatalog(catalog: AladinCatalog): void;
  }

  interface AladinCatalog {
    clear(): void;
    addSources(sources: unknown[]): void;
  }

  const Aladin: {
    init: Promise<unknown>;
    image(url: string, options: {
      name: string; imgFormat: "png"; opacity: number; wcs: Record<string, unknown>;
      successCallback: (ra: number, dec: number, fov: number, image: AladinImage) => void;
      errorCallback?: (error: unknown) => void;
    }): AladinImage;
    HiPS(urlOrId: string, options: {
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
        survey?: string | AladinImageSurvey;
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
