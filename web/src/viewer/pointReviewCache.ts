import type { CatalogReview } from "../inspector/api.ts";
import { angularSeparationArcsec } from "../inspector/propagate.ts";

export type PointReviewRequest = Pick<CatalogReview, "ra" | "dec" | "radiusArcsec" | "observedAtUtc">;
export type CheckPoint = (request: PointReviewRequest, signal?: AbortSignal) => Promise<CatalogReview>;

const maxEntries = 32;
const ttlMs = 5 * 60_000;

export function createPointReviewCache() {
  const entries = new Map<string, { request: PointReviewRequest; review: CatalogReview; expires: number }>();

  return {
    remember(request: PointReviewRequest, review: CatalogReview) {
      if (review.mode !== "live") return;
      const key = JSON.stringify([request.ra, request.dec, request.radiusArcsec, request.observedAtUtc ?? null]);
      entries.delete(key);
      entries.set(key, { request, review, expires: Date.now() + ttlMs });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
    },

    lookup(request: PointReviewRequest): { exact?: CatalogReview; nearby?: CatalogReview } {
      const now = Date.now();
      let nearby: CatalogReview | undefined;
      let nearest = Math.min(15, request.radiusArcsec / 2);
      for (const entry of entries.values()) {
        const previous = entry.request;
        if (entry.expires <= now || previous.radiusArcsec !== request.radiusArcsec ||
            (previous.observedAtUtc ?? null) !== (request.observedAtUtc ?? null)) continue;

        const exact = previous.ra === request.ra && previous.dec === request.dec;
        const checks = entry.review.checks;
        if (exact && checks.every(check => check.status !== "unavailable" &&
            (check.status !== "skipped" || (check.catalog === "SkyBoT" && !request.observedAtUtc)))) {
          return { exact: entry.review };
        }
        const distance = angularSeparationArcsec(previous, request);
        if (distance <= nearest && checks.some(check => check.rows?.length)) {
          nearby = entry.review;
          nearest = distance;
        }
      }
      return { nearby };
    },
  };
}

const caches = new WeakMap<CheckPoint, ReturnType<typeof createPointReviewCache>>();

export function pointReviewCache(check: CheckPoint) {
  let cache = caches.get(check);
  if (!cache) {
    cache = createPointReviewCache();
    caches.set(check, cache);
  }
  return cache;
}
