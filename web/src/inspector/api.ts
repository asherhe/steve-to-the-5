// Typed client for the catalog service. Same-origin /api by default; the base path can be
// overridden at integration. Distinguishes an empty result from a service error.

import type { ApiErrorBody, GaiaDetail, NearbyResponse, ResolveResult } from "./types";
import type { components } from "./catalog.generated";

export type CatalogReview = components["schemas"]["CatalogReview"];

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
    /** `retry` marks a manual retry, which lets the service probe an archive in cooldown. */
    async nearby(ra: number, dec: number, radiusArcsec: number, options: { retry?: boolean } = {}): Promise<NearbyResponse & { catalogMode?: "live" | "fixture" }> {
      const url = `${baseUrl}/catalogs/nearby?ra=${ra}&dec=${dec}&radiusArcsec=${radiusArcsec}${options.retry ? "&retry=true" : ""}`;
      const response = await doFetch(url);
      const result = await readCatalogResponse<NearbyResponse>(response);
      const mode = response.headers.get("X-SPHEREx-Catalog-Mode");
      return { ...result, catalogMode: mode === "live" || mode === "fixture" ? mode : undefined };
    },

    async detail(sourceId: string, options: { retry?: boolean } = {}): Promise<GaiaDetail> {
      const url = `${baseUrl}/catalogs/gaia/${encodeURIComponent(sourceId)}${options.retry ? "?retry=true" : ""}`;
      return readCatalogResponse<GaiaDetail>(await doFetch(url));
    },

    /** Six-catalog cone check around one point. `observedAtUtc` is the dated frame's time;
     *  omit it for an undated point (SkyBoT is then skipped). No sign-in is needed. */
    async review(
      request: { ra: number; dec: number; radiusArcsec: number; observedAtUtc?: string | null },
      signal?: AbortSignal,
    ): Promise<CatalogReview> {
      const params = new URLSearchParams({ ra: String(request.ra), dec: String(request.dec), radiusArcsec: String(request.radiusArcsec) });
      if (request.observedAtUtc) params.set("observedAtUtc", request.observedAtUtc);
      return readCatalogResponse<CatalogReview>(await doFetch(`${baseUrl}/catalogs/review?${params}`, { signal }));
    },

    async resolve(name: string, signal?: AbortSignal): Promise<ResolveResult> {
      const url = `${baseUrl}/resolve?name=${encodeURIComponent(name)}`;
      return readCatalogResponse<ResolveResult>(await doFetch(url, { signal }));
    },
  };
}

export type CatalogClient = ReturnType<typeof createCatalogClient>;
