import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Comparison, ComparisonResult, Field, SkyPosition } from "../comparison";
import { CatalogApiError, createCatalogClient, SourceInspector, type MarkAction } from "../../inspector";
import { targetPresets } from "../coordinates";
import { FieldSearch, inFieldRange } from "../FieldSearch";
import { SkyMap } from "../SkyMap";
import { fixtureDataSource, fixtureField, savedFixtureId, type Scenario } from "./fixtures";
import "./styles.css";

const scenarios: Record<Scenario, string> = {
  ready: "Matched pair",
  single_epoch: "Single epoch",
  no_coverage: "No coverage",
  no_comparable_pair: "No comparable pair",
  upstream_unavailable: "Archive unavailable",
};

const initialCenter = targetPresets[0];
const initialField = { ...initialCenter, fovArcmin: fixtureField.fovArcmin };
const fieldLimits = { min: 1, max: 30 };
const catalogClient = createCatalogClient();

type Request =
  | { kind: "field"; field: Field }
  | { kind: "name"; name: string; fovArcmin: number }
  | { kind: "saved"; id: string };

type Preview =
  | { kind: "idle" | "loading" | "missing" | "name_not_found" | "catalog_error" | "error" }
  | { kind: "search"; result: ComparisonResult; field: Field }
  | { kind: "saved"; comparison: Comparison };

function Harness() {
  const [scenario, setScenario] = useState<Scenario>("ready");
  const [request, setRequest] = useState<Request | null>(null);
  const [focus, setFocus] = useState<Field | null>(null);
  const [mapNotice, setMapNotice] = useState("");
  const [inspecting, setInspecting] = useState<SkyPosition | null>(null);
  const [catalogMark, setCatalogMark] = useState<MarkAction | null>(null);
  const [preview, setPreview] = useState<Preview>({ kind: "idle" });

  useEffect(() => {
    if (!request) {
      setPreview({ kind: "idle" });
      return;
    }
    const current = request;
    const controller = new AbortController();
    const source = fixtureDataSource(scenario);
    const signal = controller.signal;

    async function load() {
      setPreview({ kind: "loading" });
      try {
        if (current.kind === "saved") {
          const comparison = await source.loadSaved(current.id, signal);
          if (!signal.aborted) {
            setPreview(comparison ? { kind: "saved", comparison } : { kind: "missing" });
          }
          return;
        }

        let field: Field;
        if (current.kind === "name") {
          const position = await source.resolveName(current.name, signal) ??
            await catalogClient.resolve(current.name, signal);
          if (signal.aborted) return;
          field = { ra: position.ra, dec: position.dec, fovArcmin: current.fovArcmin };
          setFocus(field);
        } else {
          field = current.field;
        }

        const result = await source.search(field, signal);
        if (!signal.aborted) setPreview({ kind: "search", result, field });
      } catch (error) {
        if (signal.aborted) return;
        if (current.kind !== "name") {
          setPreview({ kind: "error" });
        } else {
          const missing = error instanceof CatalogApiError && error.code === "not_found";
          setPreview({ kind: missing ? "name_not_found" : "catalog_error" });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [scenario, request]);

  function search(field: Field) {
    setMapNotice("");
    setFocus(field);
    setRequest({ kind: "field", field });
  }

  function compareViewport(field: Field) {
    if (!inFieldRange(field.fovArcmin, fieldLimits)) {
      setMapNotice(`Zoom to a field width of ${fieldLimits.min}–${fieldLimits.max} arcmin before comparing.`);
      return;
    }
    setMapNotice("");
    setRequest({ kind: "field", field });
  }

  const comparison =
    preview.kind === "search" ? preview.result.comparison :
    preview.kind === "saved" ? preview.comparison : null;

  const status =
    preview.kind === "search" ? scenarios[preview.result.status] :
    preview.kind === "saved" ? "Saved synthetic comparison" :
    preview.kind === "missing" ? "Saved comparison not found" :
    preview.kind === "name_not_found" ? "Object name not found. Try a preset or enter sky coordinates." :
    preview.kind === "catalog_error" ? "Name lookup is unavailable. Try a preset or enter sky coordinates." :
    preview.kind === "error" ? "Fixture could not be loaded" :
    preview.kind === "idle" ? "Choose a field to compare." :
    "Loading fixture…";

  return (
    <main>
      <header>
        <h1>SPHEREx viewer</h1>
        <p>Development fixtures. All images and observation metadata are synthetic.</p>
      </header>
      <SkyMap initialCenter={initialCenter} focus={focus} onCompare={compareViewport}
        onInspect={setInspecting} catalogMark={catalogMark} />
      {catalogMark && (
        <p role="status">
          Marked Gaia source {catalogMark.sourceId} at RA {catalogMark.ra.toFixed(6)}°, Dec {catalogMark.dec.toFixed(6)}°.{" "}
          <button type="button" onClick={() => setCatalogMark(null)}>Clear mark</button>
        </p>
      )}
      {inspecting && (
        <section aria-labelledby="gaia-heading" className="gaia-panel">
          <div className="sky-heading">
            <h2 id="gaia-heading">Gaia source inspector</h2>
            <button type="button" onClick={() => setInspecting(null)}>Close inspector</button>
          </div>
          <SourceInspector skyPosition={inspecting} client={catalogClient} onMark={setCatalogMark} />
        </section>
      )}
      {mapNotice && <p role="status">{mapNotice}</p>}
      <FieldSearch field={initialField} limits={fieldLimits} onSearch={search}
        onResolve={(name, fovArcmin) => {
          setMapNotice("");
          setRequest({ kind: "name", name, fovArcmin });
        }} />
      <h2>Fixture results</h2>
      <div className="controls">
        <label>
          Archive response
          <select value={scenario} onChange={(event) => {
            setScenario(event.target.value as Scenario);
            setRequest((current) => current?.kind === "field" ? current : { kind: "field", field: fixtureField });
          }}>
            {Object.entries(scenarios).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setRequest({ kind: "saved", id: savedFixtureId })}>Open saved fixture</button>
        <button onClick={() => setRequest({ kind: "saved", id: "missing-fixture" })}>Try missing ID</button>
        {request?.kind === "saved" && <button onClick={() => setRequest(null)}>Back to search</button>}
      </div>
      <p role="status">{status}</p>
      {preview.kind === "search" && (
        <p>
          Requested RA {preview.field.ra.toFixed(6)}°, Dec {preview.field.dec.toFixed(6)}°,
          width {preview.field.fovArcmin.toFixed(2)} arcmin. The fixture simulates the selected archive outcome.
        </p>
      )}
      {comparison && (
        <section aria-label="Synthetic comparison frames">
          <p>
            {comparison.wavelengthRangeUm.join("–")} µm · Shared stretch{" "}
            {comparison.stretch.min}–{comparison.stretch.max} {comparison.stretch.unit}
          </p>
          <div className="frames">
            {comparison.frames.map((frame, index) => (
              <figure key={frame.id}>
                <img
                  src={frame.imageUrl}
                  width={comparison.grid.width}
                  height={comparison.grid.height}
                  alt={`Synthetic star field, epoch ${index + 1}`}
                />
                <figcaption>
                  <time dateTime={frame.observedAtUtc}>{frame.observedAtUtc}</time>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Fixture harness root is missing.");
createRoot(root).render(<Harness />);
