/**
 * When each reference map's images were taken, so switching maps can say how far the view
 * moved in time. All three maps share one ICRS grid: background stars line up across them,
 * but a star with large proper motion (Barnard's Star moves 10.4″ a year) really sits
 * somewhere else in an older survey. These dates explain that shift; they are not used to
 * move any image.
 */

export type MapSurvey = "spherex" | "dss" | "wise";

export interface SurveyEpoch {
  label: string;
  /** Representative date as a decimal year, used for the "about N years" difference. */
  year: number;
  /** Span of the contributing observations, shown to the user. */
  span: string;
  /** True when the date of the visible patch depends on where you look. */
  variesAcrossSky: boolean;
}

export const surveyEpochs: Record<MapSurvey, SurveyEpoch> = {
  // HiPS properties t_min/t_max: MJD 60789.75–61174.49 (2025-04-24 to 2026-05-14).
  // Representative date: the DR1 midpoint also used for mosaic predictions.
  spherex: { label: "SPHEREx DR1", year: 2025.85, span: "2025–2026", variesAcrossSky: true },
  // AllWISE combines exposures from 2010 Jan 7 to 2011 Feb 1 (AllWISE Explanatory
  // Supplement). The HiPS properties carry a placeholder range, so they are not used.
  wise: { label: "AllWISE", year: 2010.55, span: "2010–2011", variesAcrossSky: true },
  // HiPS properties t_min/t_max: MJD 42413–51179 (1975-01-01 to 1999-01-01). DSS2 joins
  // plates from several surveys, so one patch of sky can be decades from another.
  dss: { label: "DSS2", year: 1987.0, span: "1975–1998", variesAcrossSky: true },
};

/** A sentence describing the jump in time between two maps, or null when nothing changed. */
export function timeShiftNotice(from: MapSurvey, to: MapSurvey): string | null {
  if (from === to) return null;
  const before = surveyEpochs[from];
  const after = surveyEpochs[to];
  const years = Math.round(Math.abs(after.year - before.year));
  const direction = after.year < before.year ? "Back" : "Forward";
  const amount = years < 1 ? "less than a year" : `about ${years} year${years === 1 ? "" : "s"}`;
  return `${direction} ${amount} in time: ${after.label} images were taken ${after.span}` +
    `${after.variesAcrossSky ? " (the exact date varies across the sky)" : ""}, ` +
    `compared with ${before.span} for ${before.label}. Fast-moving stars appear in a different spot.`;
}
