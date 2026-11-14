import type { components } from "./archive.generated";
import type { Comparison, ComparisonResult, Field, ViewerDataSource } from "./comparison";

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

export function createArchiveDataSource(fetchImpl: typeof fetch = fetch): Pick<ViewerDataSource, "search" | "loadSaved"> {
  async function request(path: string, signal?: AbortSignal): Promise<ArchiveResponse> {
    const response = await fetchImpl(path, { signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ArchiveRequestError(typeof body?.code === "string" ? body.code : "TRANSPORT_ERROR",
        typeof body?.message === "string" ? body.message : `HTTP ${response.status}`);
    }
    if (!body || typeof body !== "object" || !["ready", "single_epoch", "no_coverage", "no_comparable_pair", "upstream_unavailable"].includes(body.status)) {
      throw new ArchiveRequestError("INVALID_RESPONSE", "The archive returned unreadable comparison data.");
    }
    return body;
  }
  return {
    async search(field: Field, signal?: AbortSignal) {
      if (!Number.isFinite(field.ra) || field.ra < 0 || field.ra >= 360 ||
          !Number.isFinite(field.dec) || Math.abs(field.dec) > 90 ||
          !Number.isFinite(field.fovArcmin) || field.fovArcmin < archiveFieldLimits.min || field.fovArcmin > archiveFieldLimits.max) {
        throw new ArchiveRequestError("INVALID_REQUEST", "Enter a valid sky position and a field width of 1–30 arcmin.");
      }
      const query = new URLSearchParams({
        ra: String(field.ra), dec: String(field.dec), fovArcmin: String(field.fovArcmin),
      });
      return toResult(await request(`/api/comparisons?${query}`, signal));
    },
    async loadSaved(id, signal) {
      try {
        const result = toResult(await request(`/api/comparisons/${encodeURIComponent(id)}`, signal));
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
