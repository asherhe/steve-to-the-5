import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Comparison, ComparisonResult } from "../comparison";
import { fixtureDataSource, fixtureField, savedFixtureId, type Scenario } from "./fixtures";
import "./styles.css";

const scenarios: Record<Scenario, string> = {
  ready: "Matched pair",
  single_epoch: "Single epoch",
  no_coverage: "No coverage",
  no_comparable_pair: "No comparable pair",
  upstream_unavailable: "Archive unavailable",
};

type Preview =
  | { kind: "loading" | "missing" | "error" }
  | { kind: "search"; result: ComparisonResult }
  | { kind: "saved"; comparison: Comparison };

function Harness() {
  const [scenario, setScenario] = useState<Scenario>("ready");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const source = fixtureDataSource(scenario);
    const signal = controller.signal;

    async function load() {
      setPreview({ kind: "loading" });
      try {
        if (savedId === null) {
          const result = await source.search(fixtureField, signal);
          if (!signal.aborted) setPreview({ kind: "search", result });
        } else {
          const comparison = await source.loadSaved(savedId, signal);
          if (!signal.aborted) {
            setPreview(comparison ? { kind: "saved", comparison } : { kind: "missing" });
          }
        }
      } catch {
        if (!signal.aborted) setPreview({ kind: "error" });
      }
    }

    void load();
    return () => controller.abort();
  }, [scenario, savedId]);

  const comparison =
    preview.kind === "search" ? preview.result.comparison :
    preview.kind === "saved" ? preview.comparison : null;

  const status =
    preview.kind === "search" ? scenarios[preview.result.status] :
    preview.kind === "saved" ? "Saved synthetic comparison" :
    preview.kind === "missing" ? "Saved comparison not found" :
    preview.kind === "error" ? "Fixture could not be loaded" :
    "Loading fixture…";

  return (
    <main>
      <header>
        <h1>SPHEREx viewer</h1>
        <p>Development fixtures. All images and observation metadata are synthetic.</p>
      </header>
      <div className="controls">
        <label>
          Archive response
          <select value={scenario} onChange={(event) => {
            setScenario(event.target.value as Scenario);
            setSavedId(null);
          }}>
            {Object.entries(scenarios).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setSavedId(savedFixtureId)}>Open saved fixture</button>
        <button onClick={() => setSavedId("missing-fixture")}>Try missing ID</button>
        {savedId !== null && <button onClick={() => setSavedId(null)}>Back to search</button>}
      </div>
      <p role="status">{status}</p>
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
