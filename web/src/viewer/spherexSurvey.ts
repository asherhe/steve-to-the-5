const surveyUrl = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
export const spherexMosaicDoi = "https://doi.org/10.26131/IRSA679";
export const spherexMosaicSlice = 1;

/**
 * Centre wavelength (µm) of each slice of the DR1 all-sky cube, from `data_cube_crval3_arr` in
 * the cube's HiPS `properties` (hips_release_date 2026-11-01). Slice index = 17 × (band − 1) +
 * (channel − 1). Slices 50 and 51 are the blank dichroic channels.
 */
export const spherexSliceWavelengthsUm = [
  0.753, 0.771, 0.790, 0.809, 0.828, 0.848, 0.868, 0.889, 0.910, 0.932, 0.955, 0.978, 1.001, 1.025, 1.050, 1.075, 1.102,
  1.113, 1.139, 1.167, 1.195, 1.224, 1.254, 1.284, 1.315, 1.346, 1.378, 1.412, 1.446, 1.481, 1.517, 1.554, 1.592, 1.631,
  1.656, 1.695, 1.735, 1.775, 1.818, 1.861, 1.905, 1.949, 1.995, 2.041, 2.089, 2.139, 2.189, 2.240, 2.292, 2.345, 2.399,
  2.445, 2.506, 2.575, 2.646, 2.719, 2.794, 2.871, 2.951, 3.033, 3.118, 3.204, 3.293, 3.383, 3.476, 3.570, 3.667, 3.768,
  3.833, 3.867, 3.901, 3.935, 3.970, 4.005, 4.040, 4.076, 4.112, 4.148, 4.184, 4.220, 4.257, 4.294, 4.331, 4.368, 4.405,
  4.435, 4.467, 4.500, 4.533, 4.566, 4.600, 4.635, 4.669, 4.704, 4.739, 4.773, 4.808, 4.843, 4.879, 4.915, 4.951, 4.988,
] as const;

const channelsPerBand = 17;
/** Cube coverage from the `em_min` / `em_max` properties. */
export const spherexRangeUm = [0.743, 5.009] as const;

export interface SpherexBand {
  band: number;
  /** Ruler edges, drawn halfway between neighbouring bands' outermost channel centres. */
  fromUm: number;
  toUm: number;
  /** Slice shown when this band is picked as the map layer (channel 2, as for the default). */
  mapSlice: number;
}

export const spherexBands: readonly SpherexBand[] = Array.from({ length: 6 }, (_, i) => {
  const first = i * channelsPerBand;
  const last = first + channelsPerBand - 1;
  const fromUm = i === 0 ? spherexRangeUm[0] : (spherexSliceWavelengthsUm[first - 1] + spherexSliceWavelengthsUm[first]) / 2;
  const toUm = i === 5 ? spherexRangeUm[1] : (spherexSliceWavelengthsUm[last] + spherexSliceWavelengthsUm[last + 1]) / 2;
  return { band: i + 1, fromUm, toUm, mapSlice: first + 1 };
});

/** Blank dichroic channels (band 3 channel 17, band 4 channel 1), per the cube's `obs_description`. */
export const blankSlices: ReadonlySet<number> = new Set([50, 51]);

/** Nearest non-blank slice to a wavelength, compared on a log scale. */
export function nearestSlice(um: number): number {
  let best = 0;
  spherexSliceWavelengthsUm.forEach((value, slice) => {
    if (blankSlices.has(slice)) return;
    if (Math.abs(Math.log(value / um)) < Math.abs(Math.log(spherexSliceWavelengthsUm[best] / um))) best = slice;
  });
  return best;
}

/** The next non-blank slice in a direction, staying in range. */
export function stepSlice(slice: number, step: number): number {
  let next = Math.min(spherexSliceWavelengthsUm.length - 1, Math.max(0, slice + step));
  while (blankSlices.has(next)) next += Math.sign(step) || 1;
  return Math.min(spherexSliceWavelengthsUm.length - 1, Math.max(0, next));
}

export function bandForSlice(slice: number): number {
  return Math.floor(slice / channelsPerBand) + 1;
}

export function bandForWavelength(um: number): number | null {
  return spherexBands.find(({ fromUm, toUm }) => um >= fromUm && um < toUm)?.band ?? null;
}

export async function findSpherexSurvey(signal: AbortSignal): Promise<string | null> {
  const attempt = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  try {
    const [properties, overview] = await Promise.all([
      fetch(`${surveyUrl}/properties`, { signal: attempt }),
      fetch(`${surveyUrl}/Norder3/Allsky_${spherexMosaicSlice}.png`, { signal: attempt }),
    ]);
    const [metadata, image] = await Promise.all([properties.text(), overview.blob()]);
    if (
      properties.ok &&
      /^creator_did\s*=\s*ivo:\/\/IPAC\/P\/SPHEREx\/DR1\/cube\s*$/im.test(metadata) &&
      overview.ok && image.type === "image/png" && image.size > 0
    ) {
      return surveyUrl;
    }
  } catch {
    return null;
  }
  return null;
}
