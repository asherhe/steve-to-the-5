import type { components } from "../inspector/catalog.generated";
import type { SkyPosition } from "./comparison";

export type NeossatResult = components["schemas"]["NeossatResponse"];
export type NeossatImage = components["schemas"]["NeossatImage"];
const imageBase = "https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/data/pub/NEOSSAT/";

export function samePosition(a: SkyPosition | null, b: SkyPosition | null): boolean {
  return !!a && !!b && a.ra === b.ra && a.dec === b.dec;
}

function validPosition(value: unknown): value is SkyPosition {
  const p = value as SkyPosition | null;
  return !!p && Number.isFinite(p.ra) && p.ra >= 0 && p.ra < 360 && Number.isFinite(p.dec) && Math.abs(p.dec) <= 90;
}

export async function loadNeossat(position: SkyPosition, signal?: AbortSignal, request: typeof fetch = fetch): Promise<NeossatResult> {
  if (!validPosition(position)) throw new Error("Select a valid sky position first.");
  const params = new URLSearchParams({ ra: String(position.ra), dec: String(position.dec) });
  const response = await request(`/api/catalogs/neossat?${params}`, { signal, cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("NEOSSat images are unavailable. Try Refresh again.");
  let result: NeossatResult;
  try { result = await response.json(); }
  catch { throw new Error("The NEOSSat archive returned an unreadable response. Try Refresh again."); }
  if (!result || !validPosition(result.position) || !samePosition(result.position, position)
      || result.source !== "CADC NEOSSat" || typeof result.truncated !== "boolean"
      || !Number.isFinite(Date.parse(result.retrievedAtUtc)) || !Array.isArray(result.images) || result.images.length > 12
      || result.images.some(image => !image || typeof image.observationId !== "string" || !image.observationId
        || typeof image.product !== "string" || !image.product || !Number.isFinite(Date.parse(image.observedAtUtc))
        || typeof image.imageUrl !== "string" || !image.imageUrl.startsWith(imageBase)
        || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(image.imageUrl.slice(imageBase.length)))
      || new Set(result.images.map(image => image.observationId)).size !== result.images.length) {
    throw new Error("The NEOSSat archive returned an invalid response. Try Refresh again.");
  }
  return result;
}
