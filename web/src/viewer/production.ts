import { createArchiveDataSource } from "./archive.ts";
export { createWiseDataSource } from "./archive.ts";
import { CatalogApiError, createCatalogClient } from "../inspector/api.ts";
import { localTarget, nameIssue, partialNameIssue, validIdentity } from "./targetNames.ts";
import type { ViewerDataSource } from "./comparison";

/** Compose the owners' clients behind the same three viewer operations. */
export function createViewerDataSource(fetchImpl: typeof fetch = fetch): ViewerDataSource {
  const archive = createArchiveDataSource(fetchImpl);
  const catalog = createCatalogClient({ fetchImpl });
  return {
    ...archive,
    async resolveName(name, signal) {
      signal?.throwIfAborted();
      const issue = nameIssue(name) ?? partialNameIssue(name);
      if (issue) throw new CatalogApiError(issue);
      const bundled = localTarget(name);
      if (bundled) return structuredClone(bundled);
      try {
        const position = await catalog.resolve(name, signal);
        if (!position || typeof position.name !== "string" || !Number.isFinite(position.ra) ||
            position.ra < 0 || position.ra >= 360 || !Number.isFinite(position.dec) || Math.abs(position.dec) > 90) {
          throw new CatalogApiError({ code: "invalid_response", message: "Name lookup returned an invalid sky position." });
        }
        if (position.identity != null && !validIdentity(position.identity)) {
          throw new CatalogApiError({ code: "invalid_response", message: "Name lookup returned invalid identity metadata." });
        }
        const metadata = position.positionProvenance;
        if (metadata != null && (typeof metadata.source !== "string" || typeof metadata.role !== "string" ||
          !(metadata.refEpochJulianYear === null || (typeof metadata.refEpochJulianYear === "number" && Number.isFinite(metadata.refEpochJulianYear))))) {
          throw new CatalogApiError({ code: "invalid_response", message: "Name lookup returned invalid position provenance." });
        }
        return position;
      } catch (error) {
        if (error instanceof CatalogApiError && error.code === "not_found") return null;
        throw error;
      }
    },
  };
}
