import { useEffect, useState } from "react";
import type { BuildProgress, Comparison, ComparisonResult, ComparisonSearchOptions, Field, ViewerDataSource } from "./comparison";
import { CatalogApiError } from "../inspector";
import { ArchiveRequestError } from "./archive";
import { EvidenceReplayError, validateFinding, type SavedFinding } from "./evidence";

export type Request =
  | ({ kind: "field"; field: Field } & ComparisonSearchOptions)
  | ({ kind: "name"; name: string; fovArcmin: number } & ComparisonSearchOptions)
  | { kind: "saved"; id: string; findingId?: string };

export type Preview =
  | { kind: "idle" | "missing" | "name_not_found" | "catalog_error" }
  /** `startedAt` is `Date.now()` at the request; `progress` arrives only from services that report it. */
  | { kind: "redirect"; survey: "spherex" | "wise"; request: Request }
  | { kind: "loading"; startedAt: number; progress?: BuildProgress }
  | { kind: "error"; message: string }
  | { kind: "search"; result: ComparisonResult; field: Field }
  | { kind: "saved"; comparison: Comparison; finding?: SavedFinding };

/**
 * One survey's comparison request and its result. Each survey view owns an instance,
 * so switching views keeps both results and never restarts a search.
 */
export function useComparisonLoader({ source, resolveName, loadFinding, onFocus, survey = "spherex", initial = null }: {
  /** Null when this survey's comparison service is not connected. */
  source: Pick<ViewerDataSource, "search" | "loadSaved"> | null;
  resolveName: ViewerDataSource["resolveName"];
  loadFinding?: (id: string, signal?: AbortSignal) => Promise<SavedFinding | null>;
  /** Called when a request settles on a field the map should show. */
  onFocus: (field: Field) => void;
  initial?: Request | null;
  survey?: "spherex" | "wise";
}) {
  const [request, setRequest] = useState<Request | null>(initial);
  const [preview, setPreview] = useState<Preview>({ kind: "idle" });

  useEffect(() => {
    if (!request || !source) {
      setPreview({ kind: "idle" });
      return;
    }
    const current = request;
    const active = source;
    const controller = new AbortController();
    const signal = controller.signal;

    async function load() {
      setPreview({ kind: "loading", startedAt: Date.now() });
      let resolving = false;
      try {
        if (current.kind === "saved") {
          let finding: SavedFinding | undefined;
          if (current.findingId) {
            if (!loadFinding) throw new EvidenceReplayError("Finding replay is not connected yet. Open the comparison without the finding parameter.");
            finding = await loadFinding(current.findingId, signal) ?? undefined;
            if (signal.aborted) return;
            if (!finding) throw new EvidenceReplayError("Saved finding not found. Check the finding ID.");
            if (current.id && current.id !== finding.comparisonId) throw new EvidenceReplayError("This finding belongs to a different comparison. Open its own evidence link.");
            if (finding.survey && finding.survey !== survey) {
              setPreview({ kind: "redirect", survey: finding.survey, request: { ...current, id: finding.comparisonId } });
              return;
            }
          }
          const comparison = await active.loadSaved(current.id || finding?.comparisonId || "", signal);
          if (comparison && finding) validateFinding(finding, comparison);
          if (!signal.aborted) {
            setPreview(comparison ? { kind: "saved", comparison, finding } : { kind: "missing" });
            if (comparison) onFocus(comparison.field);
          }
          return;
        }

        let field: Field;
        if (current.kind === "name") {
          resolving = true;
          const position = await resolveName(current.name, signal);
          if (!position) {
            if (!signal.aborted) setPreview({ kind: "name_not_found" });
            return;
          }
          resolving = false;
          if (signal.aborted) return;
          field = { ra: position.ra, dec: position.dec, fovArcmin: current.fovArcmin };
          onFocus(field);
        } else {
          field = current.field;
        }

        const result = await active.search(field, signal, (progress) => {
          if (!signal.aborted) setPreview((shown) => shown.kind === "loading" ? { ...shown, progress } : shown);
        }, { mode: current.mode, refresh: current.refresh });
        if (!signal.aborted) setPreview({ kind: "search", result, field });
      } catch (error) {
        if (signal.aborted) return;
        if (!resolving) {
          setPreview({ kind: "error", message: error instanceof ArchiveRequestError || error instanceof EvidenceReplayError
            ? error.message : "The archive service could not be reached." });
        } else {
          const missing = error instanceof CatalogApiError && error.code === "not_found";
          setPreview({ kind: missing ? "name_not_found" : "catalog_error" });
        }
      }
    }

    void load();
    return () => controller.abort();
    // `onFocus` is a state setter and `resolveName` belongs to the stable data source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, loadFinding, request, survey]);

  return { request, setRequest, preview };
}
