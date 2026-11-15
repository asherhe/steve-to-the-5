import type { components } from "./archive.generated";
import type { BuildProgress, Comparison, ComparisonResult, Field, ViewerDataSource } from "./comparison";

type ArchiveResponse = components["schemas"]["ComparisonResponse"];
type ArchiveManifest = components["schemas"]["Comparison"];

export class ArchiveRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const archiveFieldLimits = { min: 1, max: 30 } as const;
/** The time-lapse service downloads every exposure at full resolution, so it takes smaller fields. */
export const wiseFieldLimits = { min: 1, max: 12 } as const;
export type WiseBand = 1 | 2;

interface ComparisonRoute {
  /** Same-origin path of a service that speaks the archive's comparison contract. */
  basePath: string;
  limits: { min: number; max: number };
  /** Extra search parameters, such as the WISE band. */
  params?: Record<string, string>;
  /** Path that reports a running build's progress by ID, when the service has one. */
  progressPath?: string;
  progressIntervalMs?: number;
}
const spherexRoute: ComparisonRoute = { basePath: "/api/comparisons", limits: archiveFieldLimits };

function toComparison(manifest: ArchiveManifest): Comparison {
  return {
    ...manifest,
    stretch: { min: manifest.stretch.lower, max: manifest.stretch.upper, unit: manifest.stretch.unit },
    frames: [...manifest.frames].sort((left, right) =>
      Date.parse(left.observedAtUtc) - Date.parse(right.observedAtUtc)),
  };
}

function toResult(body: ArchiveResponse): ComparisonResult {
  if (body.status === "ready" || body.status === "single_epoch") {
    if (!body.comparison || !Array.isArray(body.comparison.frames) || body.comparison.frames.length < (body.status === "ready" ? 2 : 1)) {
      throw new ArchiveRequestError("INVALID_RESPONSE", "The archive returned incomplete image evidence.");
    }
    const manifest = body.comparison;
    if (!manifest.id || !manifest.grid || !Number.isInteger(manifest.grid.width) || manifest.grid.width <= 0 ||
        !Number.isInteger(manifest.grid.height) || manifest.grid.height <= 0 ||
        !manifest.stretch || !Number.isFinite(manifest.stretch.lower) || !Number.isFinite(manifest.stretch.upper) ||
        manifest.stretch.upper <= manifest.stretch.lower ||
        !Array.isArray(manifest.wavelengthRangeUm) || manifest.wavelengthRangeUm.length !== 2 ||
        !manifest.wavelengthRangeUm.every(Number.isFinite) ||
        manifest.frames.some(frame => !frame.id || !frame.imageUrl || !Number.isFinite(Date.parse(frame.observedAtUtc))) ||
        new Set(manifest.frames.map(frame => frame.id)).size !== manifest.frames.length) {
      throw new ArchiveRequestError("INVALID_RESPONSE", "The archive returned incomplete image evidence.");
    }
    return { status: body.status, comparison: toComparison(manifest), diagnostics: body.diagnostics };
  }
  return { status: body.status, comparison: null, diagnostics: body.diagnostics };
}

export function createArchiveDataSource(
  fetchImpl: typeof fetch = fetch, route: ComparisonRoute = spherexRoute,
): Pick<ViewerDataSource, "search" | "loadSaved"> {
  const { basePath, limits, params, progressPath, progressIntervalMs = 1000 } = route;
  async function request(path: string, signal?: AbortSignal): Promise<ArchiveResponse> {
    const response = await fetchImpl(path, { signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      // A bare 404 (no {code, message} body) means the route itself is missing, which happens
      // when the backend was started before the route was added.
      if (response.status === 404 && typeof body?.code !== "string") {
        throw new ArchiveRequestError("ROUTE_NOT_FOUND",
          "The archive service does not have this route. Restart it (npm run dev) so it picks up the latest code.");
      }
      throw new ArchiveRequestError(typeof body?.code === "string" ? body.code : "TRANSPORT_ERROR",
        typeof body?.message === "string" ? body.message : `HTTP ${response.status}`);
    }
    if (!body || typeof body !== "object" || !["ready", "single_epoch", "no_coverage", "no_comparable_pair", "upstream_unavailable"].includes(body.status)) {
      throw new ArchiveRequestError("INVALID_RESPONSE", "The archive returned unreadable comparison data.");
    }
    return body;
  }
  return {
    async search(field: Field, signal?: AbortSignal, onProgress?: (progress: BuildProgress) => void) {
      if (!Number.isFinite(field.ra) || field.ra < 0 || field.ra >= 360 ||
          !Number.isFinite(field.dec) || Math.abs(field.dec) > 90 ||
          !Number.isFinite(field.fovArcmin) || field.fovArcmin < limits.min || field.fovArcmin > limits.max) {
        throw new ArchiveRequestError("INVALID_REQUEST", `Enter a valid sky position and a field width of ${limits.min}–${limits.max} arcmin.`);
      }
      const query = new URLSearchParams({
        ra: String(field.ra), dec: String(field.dec), fovArcmin: String(field.fovArcmin), ...params,
      });
      if (!progressPath || !onProgress) return toResult(await request(`${basePath}?${query}`, signal));
      // The build is one long request, so its progress is read from a second route.
      const id = crypto.randomUUID();
      query.set("progressId", id);
      const timer = setInterval(async () => {
        try {
          const response = await fetchImpl(`${progressPath}/${id}`, { signal });
          const state = response.ok ? await response.json() : null;
          if (state && typeof state.stage === "string" && Number.isFinite(state.fraction) &&
              Number.isFinite(state.done) && Number.isFinite(state.total)) onProgress(state);
        } catch {
          // Progress is optional; the build request reports any real failure.
        }
      }, progressIntervalMs);
      // Aborting the request alone would leave the service building (and busy) for minutes.
      const stop = () => { void fetchImpl(`${progressPath}/${id}`, { method: "DELETE" }).catch(() => {}); };
      signal?.addEventListener("abort", stop, { once: true });
      try {
        return toResult(await request(`${basePath}?${query}`, signal));
      } finally {
        clearInterval(timer);
        signal?.removeEventListener("abort", stop);
      }
    },
    async loadSaved(id, signal) {
      try {
        const result = toResult(await request(`${basePath}/${encodeURIComponent(id)}`, signal));
        if (result.comparison?.id !== id) {
          throw new ArchiveRequestError("INVALID_RESPONSE", "The archive returned different saved evidence.");
        }
        return { ...result.comparison, diagnostics: result.diagnostics };
      } catch (error) {
        if (error instanceof ArchiveRequestError && error.code === "NOT_FOUND") return null;
        throw error;
      }
    },
  };
}

export const archiveDataSource = createArchiveDataSource();

/**
 * Dated WISE/NEOWISE frames from the time-lapse service. It returns the archive's
 * comparison shape from its own route and evidence store, so IDs are not shared.
 */
export function createWiseDataSource(band: WiseBand, fetchImpl: typeof fetch = fetch, progressIntervalMs?: number) {
  return createArchiveDataSource(fetchImpl, {
    basePath: "/api/wise/comparisons", limits: wiseFieldLimits, params: { band: String(band) },
    progressPath: "/api/wise/comparisons/progress", progressIntervalMs,
  });
}
