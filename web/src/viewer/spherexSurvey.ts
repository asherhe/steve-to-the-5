export const spherexSurveyUrl = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
const surveyUrl = spherexSurveyUrl;
export const spherexTileBase = surveyUrl;
/** True for requests that fetch tiles of the all-sky cube. */
export function isSpherexTileUrl(url: string): boolean {
  return url.startsWith(surveyUrl);
}
export const spherexMosaicDoi = "https://doi.org/10.26131/IRSA679";
export const spherexMosaicSlice = 1;
// IRSA DR1 combines Surveys 1 and 2. The release midpoint is a guide for
// proper motion on the mosaic. Individual pixels have no common exposure date.
export const spherexMosaicGuideTimeUtc = new Date((
  Date.parse("2025-05-01T00:00:00Z") + Date.parse("2026-05-16T00:00:00Z")
) / 2).toISOString();
/** Known label for the default slice, used only if the cube metadata omits its wavelength list. */
const defaultSliceWavelengthUm = 0.771;
const channelsPerBand = 17;
// Per the cube's obs_description: frames 50 and 51 (band 3 channel 17, band 4 channel 1,
// the dichroic channels) are blank. Their tiles are absent from the HiPS.
export const blankSpherexSlices: ReadonlySet<number> = new Set([50, 51]);

/**
 * CDS's DSS2 colour HiPS (ivo://CDS/P/DSS2/color): an optical reference survey, not SPHEREx.
 * Explicit mirrors from its HiPS registry record, tried in order; IRSA also hosts the SPHEREx cube.
 */
export const dssSurveyUrls = [
  "https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color",
  "https://skies.esac.esa.int/DSSColor",
] as const;
export const dssAcknowledgement = "https://archive.stsci.edu/dss/acknowledging.html";

export interface SpherexCube {
  url: string;
  depth: number;
  /** Spectral range of the cube (em_min, em_max) in metres. */
  emMinM: number;
  emMaxM: number;
  overview: Blob;
  /** Centre wavelength of each cube slice in µm, indexed by slice number (0-based). */
  wavelengthsUm: readonly number[];
}

const speedOfLight = 299_792_458;

/**
 * Frequency that makes Aladin Lite 3.8 display a given cube slice.
 *
 * Do not use `setSliceNumber`: it converts the slice to a wavelength linearly but the
 * renderer maps frequency back to a slice linearly in frequency, increasing with
 * frequency (slice = floor((f − f_min) / (f_max − f_min) × depth)). That inverts the
 * order for this wavelength-ascending cube (setSliceNumber(1) shows tile 95). This returns
 * the centre of the frequency bin the renderer reads as `slice`; the tile requested for
 * each slice was checked in Chrome.
 */
export function spherexSliceFrequencyHz(cube: SpherexCube, slice: number) {
  const minHz = speedOfLight / cube.emMaxM;
  const maxHz = speedOfLight / cube.emMinM;
  return minHz + ((slice + 0.5) / cube.depth) * (maxHz - minHz);
}

/** Band (1–6) and channel (1–17) of a cube slice: slice = 17 × (band − 1) + (channel − 1). */
export function spherexBandChannel(slice: number) {
  return { band: Math.floor(slice / channelsPerBand) + 1, channel: (slice % channelsPerBand) + 1 };
}

export function spherexSliceWavelength(cube: SpherexCube, slice: number): number | null {
  return cube.wavelengthsUm[slice] ?? (slice === spherexMosaicSlice ? defaultSliceWavelengthUm : null);
}

function property(properties: string, key: string) {
  return properties.match(new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, "m"))?.[1];
}

function parseCube(url: string, properties: string, overview: Blob): SpherexCube | null {
  const depth = Number(property(properties, "hips_cube_depth"));
  const emMinM = Number(property(properties, "em_min"));
  const emMaxM = Number(property(properties, "em_max"));
  if (!Number.isInteger(depth) || depth <= spherexMosaicSlice || !(emMinM > 0 && emMaxM > emMinM)) return null;
  return { url, depth, emMinM, emMaxM, overview, wavelengthsUm: parseWavelengths(properties, depth) };
}

function overviewUrl(url: string, slice: number) {
  return `${url}/Norder3/Allsky_${slice}.png`;
}

export async function loadSpherexOverview(cube: SpherexCube, slice: number, signal: AbortSignal) {
  let blob = cube.overview;
  if (slice !== spherexMosaicSlice) {
    const response = await fetch(overviewUrl(cube.url, slice), { signal });
    if (!response.ok) throw new Error(`SPHEREx overview returned HTTP ${response.status}`);
    blob = await response.blob();
  }
  signal.throwIfAborted();
  const atlas = await createImageBitmap(blob);
  try {
    // The order-3 Allsky PNG packs 768 nested HEALPix cells in rows of 27.
    // Repack each group of 64 children into its order-zero parent.
    const columns = 27;
    const childSize = 64;
    const parentSize = 512;
    if (atlas.width !== columns * childSize || atlas.height !== 29 * childSize) {
      throw new Error("Unexpected SPHEREx Allsky image dimensions");
    }
    const parents = await Promise.all(Array.from({ length: 12 }, (_, parent) => {
      const canvas = new OffscreenCanvas(parentSize, parentSize);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create a SPHEREx overview tile");
      for (let child = 0; child < 64; child++) {
        const index = parent * 64 + child;
        // HiPS image columns use the odd Morton bits and rows use the even bits.
        const column = ((child >> 1) & 1) | ((child >> 2) & 2) | ((child >> 3) & 4);
        const row = (child & 1) | ((child >> 1) & 2) | ((child >> 2) & 4);
        context.drawImage(atlas, (index % columns) * childSize, Math.floor(index / columns) * childSize,
          childSize, childSize, column * childSize, row * childSize, childSize, childSize);
      }
      return canvas.convertToBlob().then((tile) => ({ png: new File([tile], `Npix${parent}.png`, { type: tile.type }) }));
    }));
    signal.throwIfAborted();
    return {
      properties: new File([[
        `creator_did = ivo://IPAC/P/SPHEREx/DR1/cube#overview-${slice}`,
        "hips_frame = equatorial",
        "hips_order = 0",
        "hips_tile_width = 512",
        "hips_tile_format = png",
        "dataproduct_type = image",
        "",
      ].join("\n")], "properties"),
      moc: new File([], "Moc.fits"),
      0: Object.fromEntries(parents.map((tile, index) => [index, tile])),
    };
  } finally {
    atlas.close();
  }
}

function parseWavelengths(properties: string, depth: number): number[] {
  const unit = properties.match(/^data_cube_bunit3\s*=\s*(\S+)\s*$/m)?.[1];
  const values = properties.match(/^data_cube_crval3_arr\s*=\s*(.+)$/m)?.[1].trim().split(/\s+/).map(Number);
  if (!values || unit !== "um" || values.length !== depth || !values.every((value) => Number.isFinite(value) && value > 0)) {
    return [];
  }
  return values;
}

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

/**
 * Slices with no tiles on the server: the blank dichroic channels (band 3 channel 17, band 4
 * channel 1), per the cube's `obs_description`, and slice 0, whose tiles answer 404. Showing
 * one leaves the map empty.
 */
export const blankSlices: ReadonlySet<number> = new Set([0, 50, 51]);

/** Nearest non-blank slice to a wavelength, compared on a log scale. */
export function nearestSlice(um: number): number {
  let best = 0;
  spherexSliceWavelengthsUm.forEach((value, slice) => {
    if (blankSpherexSlices.has(slice)) return;
    if (Math.abs(Math.log(value / um)) < Math.abs(Math.log(spherexSliceWavelengthsUm[best] / um))) best = slice;
  });
  return best;
}

/** Wavelength (µm) the map layer and spectral ruler start at. */
export const defaultMapWavelengthUm = 4.6;
/** Cube slice the map layer starts at: the one nearest `defaultMapWavelengthUm` (slice 90, 4.600 µm). */
export const defaultMapSlice = nearestSlice(defaultMapWavelengthUm);

/** The next non-blank slice in a direction, staying in range. */
export function stepSlice(slice: number, step: number): number {
  let next = Math.min(spherexSliceWavelengthsUm.length - 1, Math.max(0, slice + step));
  while (blankSpherexSlices.has(next)) next += Math.sign(step) || 1;
  return Math.min(spherexSliceWavelengthsUm.length - 1, Math.max(0, next));
}

/** Every slice that has tiles, shortest wavelength first. */
export const scannableSlices: readonly number[] = spherexSliceWavelengthsUm
  .map((_, slice) => slice).filter((slice) => !blankSlices.has(slice));

/** How many wavelengths a scan preloads and cycles through. */
export const scanSampleCount = 10;

/**
 * Longest wavelength a scan uses: the end of band 5 (4.405 µm). The map drew white for
 * band 6 (4.435-4.988 µm) even with every tile cached, so a scan leaves it out. The ruler
 * can still set those wavelengths by hand.
 */
export const scanMaxSlice = 84;

/** The wavelengths a scan uses: evenly spaced from the shortest up to `scanMaxSlice`, ends included. */
const scanRange = scannableSlices.filter((slice) => slice <= scanMaxSlice);
export const scanSamples: readonly number[] = Array.from({ length: scanSampleCount }, (_, i) =>
  scanRange[Math.round(i * (scanRange.length - 1) / (scanSampleCount - 1))]);

/** Scan speeds offered, as multiples of the base pace. */
export const scanSpeeds = [0.5, 1, 2, 4, 8] as const;
/** Time each wavelength stays up at 1×. */
export const scanBaseStepMs = 250;

/** The scannable slices in scan order, starting just after `from` and ending with `from`. */
export function scanOrder(from: number): number[] {
  const after = scannableSlices.filter((slice) => slice > from);
  const before = scannableSlices.filter((slice) => slice <= from);
  return [...after, ...before];
}

/** The next slice in scan order that is in `ready`, or null when no other slice is. */
export function nextReadySlice(from: number, ready: ReadonlySet<number>): number | null {
  for (const slice of scanOrder(from)) {
    if (slice !== from && ready.has(slice)) return slice;
  }
  return null;
}

/** The slice a scan shows after this one: the next non-blank slice, wrapping to the first. */
export function nextScanSlice(slice: number): number {
  return slice >= spherexSliceWavelengthsUm.length - 1 ? stepSlice(0, 1) : stepSlice(slice, 1);
}

export function bandForSlice(slice: number): number {
  return Math.floor(slice / channelsPerBand) + 1;
}

export function bandForWavelength(um: number): number | null {
  return spherexBands.find(({ fromUm, toUm }) => um >= fromUm && um < toUm)?.band ?? null;
}

export async function findSpherexSurvey(signal: AbortSignal): Promise<SpherexCube | null> {
  const attempt = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  try {
    const [properties, overview] = await Promise.all([
      fetch(`${surveyUrl}/properties`, { signal: attempt }),
      fetch(overviewUrl(surveyUrl, spherexMosaicSlice), { signal: attempt }),
    ]);
    const [metadata, image] = await Promise.all([properties.text(), overview.blob()]);
    if (
      properties.ok &&
      /^creator_did\s*=\s*ivo:\/\/IPAC\/P\/SPHEREx\/DR1\/cube\s*$/im.test(metadata) &&
      overview.ok && image.type === "image/png" && image.size > 0
    ) {
      return parseCube(surveyUrl, metadata, image);
    }
  } catch {
    return null;
  }
  return null;
}
