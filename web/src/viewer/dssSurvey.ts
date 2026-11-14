// Mirrors of the same CDS/P/DSS2/color HiPS listed by CDS.
const dssMirrors = [
  "https://skies.esac.esa.int/DSSColor",
  "https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/DSSColor",
  "https://casda.csiro.au/hips/DSS2/color",
];

export async function findDssSurvey(signal: AbortSignal): Promise<string | null> {
  for (const url of dssMirrors) {
    const attempt = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
    try {
      const [properties, overview] = await Promise.all([
        fetch(`${url}/properties`, { signal: attempt }),
        fetch(`${url}/Norder3/Allsky.jpg`, { signal: attempt }),
      ]);
      const [metadata, image] = await Promise.all([properties.text(), overview.blob()]);
      if (
        properties.ok &&
        /^creator_did\s*=\s*ivo:\/\/CDS\/P\/DSS2\/color\s*$/im.test(metadata) &&
        overview.ok && image.type === "image/jpeg" && image.size > 0
      ) {
        return url;
      }
    } catch {
      if (signal.aborted) return null;
    }
  }
  return null;
}
