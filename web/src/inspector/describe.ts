// Plain-language descriptions derived from Gaia DR3 catalog measurements.
//
// Everything here is DERIVED from the catalog row (reference epoch 2016.0). None of it is an
// observation from SPHEREx imagery, and none of it classifies the object: colour is an
// optical colour index, not a temperature or a type. Thresholds are editorial and live in
// this one file so they can be tuned together.

import { fmtDecDms, fmtDeg, fmtRaHms, fmtWithUnit } from "./format";
import type { GaiaDetail, NearbySource, PredictedPosition } from "./types";

type Maybe = number | null | undefined;

function finite(value: Maybe): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ---- Brightness ---------------------------------------------------------------------------

export type BrightnessWord = "Very bright" | "Bright" | "Moderate" | "Faint" | "Very faint";

/** G magnitude limits: 6 naked eye, 10 binoculars, 14 small telescope; Gaia reaches ~20.7. */
export function brightness(gMag: Maybe): { word: BrightnessWord; gMag: number } | null {
  if (!finite(gMag)) return null;
  const word: BrightnessWord =
    gMag < 6 ? "Very bright" : gMag < 10 ? "Bright" : gMag < 14 ? "Moderate" : gMag < 18 ? "Faint" : "Very faint";
  return { word, gMag };
}

// ---- Colour -------------------------------------------------------------------------------

export type ColourWord = "Blue-white" | "Yellow-white" | "Orange" | "Red";

/** Optical colour from the BP − RP index. Dust reddening also raises it. */
export function colour(bpMag: Maybe, rpMag: Maybe): { word: ColourWord; bpRp: number } | null {
  if (!finite(bpMag) || !finite(rpMag)) return null;
  const bpRp = bpMag - rpMag;
  const word: ColourWord = bpRp < 0.5 ? "Blue-white" : bpRp < 1.0 ? "Yellow-white" : bpRp < 1.6 ? "Orange" : "Red";
  return { word, bpRp };
}

// ---- Distance -----------------------------------------------------------------------------

export const LIGHT_YEARS_PER_PARSEC = 3.2616;
/** Below parallax / error = 5 (20 % error) the inverse parallax is a biased estimate. */
export const MIN_PARALLAX_SNR = 5;
/** Without an uncertainty, only state a distance for clearly nearby sources. */
export const MIN_PARALLAX_WITHOUT_ERROR_MAS = 2;

export type Distance =
  | { kind: "measured" | "approximate"; parsecs: number; lightYears: number }
  | { kind: "uncertain" };

export function distance(parallaxMas: Maybe, parallaxErrorMas?: Maybe): Distance {
  if (!finite(parallaxMas) || parallaxMas <= 0) return { kind: "uncertain" };
  const parsecs = 1000 / parallaxMas;
  const value = { parsecs, lightYears: parsecs * LIGHT_YEARS_PER_PARSEC };
  if (finite(parallaxErrorMas) && parallaxErrorMas > 0) {
    return parallaxMas / parallaxErrorMas >= MIN_PARALLAX_SNR ? { kind: "measured", ...value } : { kind: "uncertain" };
  }
  return parallaxMas >= MIN_PARALLAX_WITHOUT_ERROR_MAS ? { kind: "approximate", ...value } : { kind: "uncertain" };
}

/** Three significant figures, without exponent notation. */
export function sig3(value: number): string {
  if (!Number.isFinite(value) || value === 0) return String(value);
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(value))));
  return digits > 0 ? value.toFixed(digits) : String(Math.round(Number(value.toPrecision(3))));
}

export function distanceText(d: Distance): string {
  if (d.kind === "uncertain") return "Distance too uncertain to state";
  const text = `${sig3(d.lightYears)} light-years (${sig3(d.parsecs)} pc)`;
  return d.kind === "measured" ? text : `About ${text}, uncertainty not available`;
}

// ---- Motion -------------------------------------------------------------------------------

export const SPHEREX_PIXEL_ARCSEC = 6.2;
export const MOVING_ARCSEC_PER_YEAR = 0.05;
export const FAST_ARCSEC_PER_YEAR = 0.5;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Compass = (typeof COMPASS)[number];

export type Motion =
  | { kind: "insignificant" }
  | {
      kind: "slow" | "moving" | "fast";
      arcsecPerYear: number;
      /** Position angle in degrees, measured from north through east. */
      positionAngleDeg: number;
      compass: Compass;
      /** Shift over ten years in SPHEREx pixels (6.2 arcsec). */
      pixelsPerDecade: number;
    };

export function motion(
  pmRaCosDecMasYr: Maybe,
  pmDecMasYr: Maybe,
  pmRaCosDecErrorMasYr?: Maybe,
  pmDecErrorMasYr?: Maybe
): Motion | null {
  if (!finite(pmRaCosDecMasYr) || !finite(pmDecMasYr)) return null;
  const totalMas = Math.hypot(pmRaCosDecMasYr, pmDecMasYr);
  if (finite(pmRaCosDecErrorMasYr) && finite(pmDecErrorMasYr)) {
    const errorMas = totalMas === 0
      ? Math.hypot(pmRaCosDecErrorMasYr, pmDecErrorMasYr)
      : Math.hypot(pmRaCosDecMasYr * pmRaCosDecErrorMasYr, pmDecMasYr * pmDecErrorMasYr) / totalMas;
    if (totalMas < 3 * errorMas) return { kind: "insignificant" };
  }
  if (totalMas === 0) return { kind: "insignificant" };
  const arcsecPerYear = totalMas / 1000;
  const positionAngleDeg = ((Math.atan2(pmRaCosDecMasYr, pmDecMasYr) * 180) / Math.PI + 360) % 360;
  return {
    kind: arcsecPerYear >= FAST_ARCSEC_PER_YEAR ? "fast" : arcsecPerYear >= MOVING_ARCSEC_PER_YEAR ? "moving" : "slow",
    arcsecPerYear,
    positionAngleDeg,
    compass: COMPASS[Math.round(positionAngleDeg / 45) % 8],
    pixelsPerDecade: (arcsecPerYear * 10) / SPHEREX_PIXEL_ARCSEC,
  };
}

export function motionText(m: Motion): string {
  if (m.kind === "insignificant") return "No significant motion measured";
  const rate = `${sig3(m.arcsecPerYear)}″ per year`;
  return m.kind === "slow" ? `Slow: ${rate}` : `${rate}, heading ${m.compass}`;
}

// ---- Identifiers and export ---------------------------------------------------------------

/** Last seven digits, enough to tell candidates apart at a glance. */
export function shortId(sourceId: string): string {
  return sourceId.length > 8 ? `…${sourceId.slice(-7)}` : sourceId;
}

const present = (text: string) => (text === "—" ? "not measured" : text);

/** Every catalog value for one source as plain text, for the clipboard. */
export function sourceAsText(
  source: NearbySource,
  detail: GaiaDetail | null,
  predicted: PredictedPosition | null
): string {
  const lines = [
    `${detail?.provenance.dataRelease ?? "Gaia DR3"} source ${source.sourceId}`,
    `RA: ${fmtRaHms(source.ra)} (${fmtDeg(source.ra)} deg)${detail ? `, error ${present(fmtWithUnit(detail.raErrorMas, "mas", 3))}` : ""}`,
    `Dec: ${fmtDecDms(source.dec)} (${fmtDeg(source.dec)} deg)${detail ? `, error ${present(fmtWithUnit(detail.decErrorMas, "mas", 3))}` : ""}`,
    `Reference epoch: ${source.refEpoch.toFixed(1)}`,
    `Proper motion RA*cos(Dec): ${present(fmtWithUnit(source.pmRaCosDecMasYr, "mas/yr", 3, detail?.pmRaCosDecErrorMasYr))}`,
    `Proper motion Dec: ${present(fmtWithUnit(source.pmDecMasYr, "mas/yr", 3, detail?.pmDecErrorMasYr))}`,
    `Parallax: ${present(fmtWithUnit(source.parallaxMas, "mas", 3, detail?.parallaxErrorMas))}`,
  ];
  if (detail) {
    lines.push(`Radial velocity: ${present(fmtWithUnit(detail.radialVelocityKmS, "km/s", 2, detail.radialVelocityErrorKmS))}`);
  }
  lines.push(`G: ${present(fmtWithUnit(source.gMag, "mag", 3))}`);
  if (detail) {
    lines.push(`BP: ${present(fmtWithUnit(detail.bpMag, "mag", 3))}`, `RP: ${present(fmtWithUnit(detail.rpMag, "mag", 3))}`);
  }
  lines.push(`Separation from selected point: ${source.separationArcsec.toFixed(2)} arcsec`);
  if (predicted) {
    lines.push(
      `Predicted position (not an observation), epoch ${predicted.fromEpoch.toFixed(1)} to ${predicted.toEpoch.toFixed(2)}: ` +
        `RA ${fmtDeg(predicted.ra)} deg, Dec ${fmtDeg(predicted.dec)} deg`
    );
  }
  if (detail?.provenance.sourceDetailUrl) lines.push(`Archive: ${detail.provenance.sourceDetailUrl}`);
  return lines.join("\n");
}
