const surveyUrl = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
export const spherexMosaicDoi = "https://doi.org/10.26131/IRSA679";
export const spherexMosaicSlice = 1;

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
