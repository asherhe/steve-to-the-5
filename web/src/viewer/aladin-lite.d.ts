declare module "aladin-lite" {
  export interface AladinImageSurvey {
    query: Promise<AladinImageSurvey>;
    skyFraction: number;
    setOpacity(opacity: number): void;
    setFrequency(frequency: { value: number; unit: "Hz" }): void;
  }

  export interface AladinImage {
    setOpacity(opacity: number): void;
  }
  export interface AladinView {
    world2pix(ra: number, dec: number): [number, number] | undefined;
    setOverlayImageLayer(image: AladinImage | AladinImageSurvey, id: string): void;
    getOverlayImageLayer(id: string): AladinImage | AladinImageSurvey | undefined;
    getStackLayers(): string[];
    view: { swapLayers(first: string, second: string): void; requestRedraw(): void };
    removeImageLayer(id: string): void;
    /** Aladin's built-in right-click menu; set to null to disable it. */
    contextMenu: unknown;
    getRaDec(): [ra: number, dec: number];
    getFoV(): [width: number, height: number];
    gotoRaDec(ra: number, dec: number): void;
    setFoV(degrees: number): void;
    setProjection(projection: "SIN" | "AIT"): void;
    setBaseImageLayer(layer: AladinImageSurvey): void;
    on(event: "click", callback: (position: { ra: number; dec: number; isDragging: boolean }) => void): void;
    on(event: "positionChanged", callback: (position: { ra: number; dec: number; dragging: boolean }) => void): void;
    /** Fires, throttled, with the new field of view in degrees. */
    on(event: "zoomChanged", callback: (fovDegrees: number) => void): void;
    on(event: "resizeChanged", callback: (width: number, height: number) => void): void;
    on(event: "projectionChanged", callback: (projection: string) => void): void;
    addCatalog(catalog: AladinCatalog): void;
    addOverlay(overlay: AladinOverlay): void;
    /** Replaces the base image layer; the view's centre, zoom and projection are kept. */
    setBaseImageLayer(survey: AladinImageSurvey): void;
  }

  interface AladinOverlay {
    removeAll(): void;
    add(shape: unknown): void;
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
    HiPS(urlOrId: string | { properties: File; moc: File; 0: Record<number, { png: File }> }, options: {
      id?: string;
      name: string;
      successCallback: (survey: AladinImageSurvey) => void;
      errorCallback: (error: unknown) => void;
    }): AladinImageSurvey;
    catalog(options: { name: string; color: string; sourceSize: number; shape: "circle" | "cross"; displayLabel?: boolean; labelColumn?: string; labelColor?: string; labelFont?: string }): AladinCatalog;
    source(ra: number, dec: number, data?: Record<string, string>): unknown;
    graphicOverlay(options: { name: string; color: string; lineWidth: number }): AladinOverlay;
    polygon(corners: [number, number][]): unknown;
    aladin(
      element: HTMLElement,
      options: {
        cooFrame: "ICRSd";
        survey?: string | AladinImageSurvey | [];
        projection: "SIN";
        fov: number;
        showProjectionControl: boolean;
        showLayersControl: boolean;
        showZoomControl: boolean;
        showFullscreenControl: boolean;
        showSettingsControl: boolean;
        showCooLocation: boolean;
        showFrame: boolean;
        showFov: boolean;
        showSimbadPointerControl: boolean;
        showStatusBar: boolean;
      },
    ): AladinView;
  };
  export default Aladin;
}
