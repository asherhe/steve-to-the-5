import type { components } from "./archive.generated";
import type { Comparison, ComparisonResult, Field, ViewerDataSource } from "./comparison";

type ArchiveResponse = components["schemas"]["ComparisonResponse"];
type ArchiveManifest = components["schemas"]["Comparison"];

export class ArchiveRequestError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function toComparison(manifest: ArchiveManifest): Comparison {
  return {
    ...manifest,
    stretch: { min: manifest.stretch.lower, max: manifest.stretch.upper, unit: manifest.stretch.unit },
    frames: [...manifest.frames].sort((left, right) =>
      Date.parse(left.observedAtUtc) - Date.parse(right.observedAtUtc)),
  };
}

async function request(path: string, signal?: AbortSignal): Promise<ArchiveResponse> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as components["schemas"]["ErrorBody"] | null;
    throw new ArchiveRequestError(error?.code ?? "TRANSPORT_ERROR", error?.message ?? `HTTP ${response.status}`);
  }
  return response.json();
}

function toResult(body: ArchiveResponse): ComparisonResult {
  if (body.status === "ready" || body.status === "single_epoch") {
    if (!body.comparison || body.comparison.frames.length < (body.status === "ready" ? 2 : 1)) {
      throw new ArchiveRequestError("INVALID_RESPONSE", "The archive returned incomplete image evidence.");
    }
    return { status: body.status, comparison: toComparison(body.comparison), diagnostics: body.diagnostics };
  }
  return { status: body.status, comparison: null, diagnostics: body.diagnostics };
}

export const archiveDataSource: Pick<ViewerDataSource, "search" | "loadSaved"> = {
  async search(field: Field, signal?: AbortSignal) {
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
