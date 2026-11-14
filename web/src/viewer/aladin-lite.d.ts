declare module "aladin-lite" {
  export interface AladinView {
    getRaDec(): [ra: number, dec: number];
    getFoV(): [width: number, height: number];
    gotoRaDec(ra: number, dec: number): void;
    setFoV(degrees: number): void;
    setProjection(projection: "SIN" | "AIT"): void;
  }

  const Aladin: {
    init: Promise<unknown>;
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
        showSimbadPointerControl: boolean;
      },
    ): AladinView;
  };
  export default Aladin;
}
