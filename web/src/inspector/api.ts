// Typed client for the catalog service. Same-origin /api by default; the base path can be
// overridden at integration. Distinguishes an empty result from a service error.

import type { ApiErrorBody, GaiaDetail, NearbyResponse } from "./types";

export class CatalogApiError extends Error {
  code: string;
  constructor(body: ApiErrorBody) {
    super(body.message);
    this.code = body.code;
    this.name = "CatalogApiError";
  }
}

export interface CatalogClientOptions {
  baseUrl?: string; // default "/api"
  fetchImpl?: typeof fetch;
}

async function readCatalogResponse<T>(response: Response): Promise<T> {
  const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (mimeType === "text/html" || mimeType === "application/xhtml+xml") {
    throw new CatalogApiError({
      code: "catalog_route_unavailable",
      message: "The catalog URL returned a web page. Check that /api/catalogs and /api/resolve are routed to the Gaia service.",
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CatalogApiError({
      code: "upstream_unavailable",
      message: response.ok
        ? "The catalog service returned unreadable data."
        : `Could not reach the catalog service (HTTP ${response.status}).`,
    });
  }
  if (!response.ok) {
    if (body && typeof body === "object" && "code" in body && "message" in body &&
        typeof body.code === "string" && typeof body.message === "string") {
      throw new CatalogApiError({ code: body.code, message: body.message });
    }
    throw new CatalogApiError({
      code: "upstream_unavailable",
      message: `Catalog request failed (HTTP ${response.status}).`,
    });
  }
  return body as T;
}

export function createCatalogClient(options: CatalogClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "/api";
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async nearby(ra: number, dec: number, radiusArcsec: number): Promise<NearbyResponse> {
      const url = `${baseUrl}/catalogs/nearby?ra=${ra}&dec=${dec}&radiusArcsec=${radiusArcsec}`;
      return readCatalogResponse<NearbyResponse>(await doFetch(url));
    },

    async detail(sourceId: string): Promise<GaiaDetail> {
      const url = `${baseUrl}/catalogs/gaia/${encodeURIComponent(sourceId)}`;
      return readCatalogResponse<GaiaDetail>(await doFetch(url));
    },

    async resolve(name: string, signal?: AbortSignal): Promise<{ name: string; ra: number; dec: number }> {
      const url = `${baseUrl}/resolve?name=${encodeURIComponent(name)}`;
      return readCatalogResponse<{ name: string; ra: number; dec: number }>(await doFetch(url, { signal }));
    },
  };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;
