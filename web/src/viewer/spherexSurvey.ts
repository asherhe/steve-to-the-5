export const spherexSurveyUrl = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
const surveyUrl = spherexSurveyUrl;
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
