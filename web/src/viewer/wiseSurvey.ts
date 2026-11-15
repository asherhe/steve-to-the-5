import type { WiseBand } from "./archive";

/** Which survey the map and the comparison panel show. */
export type SkyView = "spherex" | "wise";

/**
 * AllWISE colour composite (HiPS `CDS/P/allWISE/color`, built by CDS from the Atlas
 * Images). It combines exposures from 2010–2011, so it is a reference layer and
 * carries no dates.
 */
export const wiseMap = {
  /** Mirrors of the same survey, tried in order. */
  urls: [
    "https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1",
    "https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1",
  ],
  name: "AllWISE colour composite",
  link: "https://wise2.ipac.caltech.edu/docs/release/allwise/",
  /** Channel assignment of the composite. Colours label bands only. */
  channels: [
    { band: "W4", um: 22, color: "#ff6b5e", channel: "red" },
    { band: "W2", um: 4.6, color: "#6fdc8c", channel: "green" },
    { band: "W1", um: 3.4, color: "#6ea8ff", channel: "blue" },
  ],
} as const;

/** The first mirror that serves this survey's metadata, or null when none does. */
export async function findWiseSurvey(signal: AbortSignal): Promise<string | null> {
  for (const url of wiseMap.urls) {
    try {
      const properties = await fetch(`${url}/properties`, { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
      if (properties.ok && /^creator_did\s*=\s*ivo:\/\/CDS\/P\/allWISE\/color\s*$/im.test(await properties.text())) return url;
    } catch {
      if (signal.aborted) return null;
    }
  }
  return null;
}

/** Bands with dated single exposures across every mission phase (2010–2024). */
export const wiseTimeLapseBands: readonly { band: WiseBand; name: string; um: number }[] = [
  { band: 1, name: "W1", um: 3.4 },
  { band: 2, name: "W2", um: 4.6 },
];

export function wiseBandName(wavelengthUm: number): string {
  return wavelengthUm < 4 ? "W1" : "W2";
}
