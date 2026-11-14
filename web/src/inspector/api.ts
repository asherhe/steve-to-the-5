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

async function parseError(resp: Response): Promise<never> {
  let body: ApiErrorBody;
  try {
    body = (await resp.json()) as ApiErrorBody;
  } catch {
    body = { code: "upstream_unavailable", message: `Request failed (${resp.status}).` };
  }
  throw new CatalogApiError(body);
}

export function createCatalogClient(options: CatalogClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "/api";
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async nearby(ra: number, dec: number, radiusArcsec: number): Promise<NearbyResponse> {
      const url = `${baseUrl}/catalogs/nearby?ra=${ra}&dec=${dec}&radiusArcsec=${radiusArcsec}`;
      const resp = await doFetch(url);
      if (!resp.ok) return parseError(resp);
      return (await resp.json()) as NearbyResponse;
    },

    async detail(sourceId: string): Promise<GaiaDetail> {
      const url = `${baseUrl}/catalogs/gaia/${encodeURIComponent(sourceId)}`;
      const resp = await doFetch(url);
      if (!resp.ok) return parseError(resp);
      return (await resp.json()) as GaiaDetail;
    },

    async resolve(name: string, signal?: AbortSignal): Promise<{ name: string; ra: number; dec: number }> {
      const url = `${baseUrl}/resolve?name=${encodeURIComponent(name)}`;
      const resp = await doFetch(url, { signal });
      if (!resp.ok) return parseError(resp);
      return (await resp.json()) as { name: string; ra: number; dec: number };
    },
  };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;
