import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Comparison, ComparisonFrame, ComparisonResult, Field, SkyPosition } from "../comparison";
import { CatalogApiError, createCatalogClient, SourceInspector, type MarkAction, type SelectedFrameMeta } from "../../inspector";
import { targetPresets } from "../coordinates";
import { FieldSearch, inFieldRange } from "../FieldSearch";
import { SkyMap } from "../SkyMap";
import { archiveDataSource, ArchiveRequestError } from "../archive";
import { ComparisonPlayback } from "../ComparisonPlayback";
import retainedExample from "../../../../fixtures/archive/real/response.json";
import type { Scenario } from "./fixtures";
import "./styles.css";

const scenarios: Record<Scenario, string> = {
  ready: "Matched pair",
  single_epoch: "Single epoch",
  no_coverage: "No coverage",
  no_comparable_pair: "No comparable pair",
  upstream_unavailable: "Archive unavailable",
};

const initialCenter = targetPresets[0];
const initialField = { ...initialCenter, fovArcmin: 6 };
const fieldLimits = { min: 1, max: 30 };
const catalogClient = createCatalogClient();
const fixtureMode = import.meta.env.DEV && new URLSearchParams(location.search).get("fixtures") === "1";

type Request =
  | { kind: "field"; field: Field }
  | { kind: "name"; name: string; fovArcmin: number }
  | { kind: "saved"; id: string };

type Panel = "search" | "comparison" | "gaia";

type Preview =
  | { kind: "idle" | "loading" | "missing" | "name_not_found" | "catalog_error" }
  | { kind: "error"; message: string }
  | { kind: "search"; result: ComparisonResult; field: Field }
  | { kind: "saved"; comparison: Comparison };

function Harness() {
  const [scenario, setScenario] = useState<Scenario>("ready");
  const [request, setRequest] = useState<Request | null>(() => {
    const id = new URLSearchParams(location.search).get("comparison");
    return id ? { kind: "saved", id } : null;
  });
  const [focus, setFocus] = useState<Field | null>(null);
  const [panel, setPanel] = useState<Panel | null>(() =>
    new URLSearchParams(location.search).has("comparison") ? "comparison" : null);
  const panelButtons = useRef<Partial<Record<Panel, HTMLButtonElement>>>({});
  const [mapNotice, setMapNotice] = useState("");
  const [inspecting, setInspecting] = useState<SkyPosition | null>(null);
  const [frameSelection, setFrameSelection] = useState<{
    comparisonId: string; position: SkyPosition; frame: SelectedFrameMeta;
  } | null>(null);
  const [inspectFrame, setInspectFrame] = useState(false);
  const [catalogMark, setCatalogMark] = useState<MarkAction | null>(null);
  const [comparisonMark, setComparisonMark] = useState<{ comparisonId: string; mark: MarkAction } | null>(null);
  const [preview, setPreview] = useState<Preview>({ kind: "idle" });
  const [copyStatus, setCopyStatus] = useState("");

  function closePanel(current: Panel) {
    setPanel(null);
    panelButtons.current[current]?.focus();
  }

  function inspect(position: SkyPosition) {
    setInspecting(position);
    setInspectFrame(false);
    setPanel("gaia");
  }

  function inspectCutout(comparisonId: string, position: SkyPosition, frame: ComparisonFrame) {
    setFrameSelection({
      comparisonId,
      position,
      frame: { frameId: frame.id, observedAtUtc: frame.observedAtUtc, wavelengthUm: frame.wavelengthUm },
    });
    setInspectFrame(true);
    setPanel("gaia");
    panelButtons.current.gaia?.focus();
  }

  useEffect(() => {
    if (!request) {
      setPreview({ kind: "idle" });
      return;
    }
    const current = request;
    const controller = new AbortController();
    const signal = controller.signal;

    async function load() {
      setPreview({ kind: "loading" });
      setCopyStatus("");
      let resolving = false;
      try {
        const fixture = fixtureMode ? (await import("./fixtures")).fixtureDataSource(scenario) : null;
        if (signal.aborted) return;
        const source = fixture ?? archiveDataSource;
        if (current.kind === "saved") {
          const comparison = await source.loadSaved(current.id, signal);
          if (!signal.aborted) {
            setPreview(comparison ? { kind: "saved", comparison } : { kind: "missing" });
            if (comparison) setFocus(comparison.field);
          }
          return;
        }

        let field: Field;
        if (current.kind === "name") {
          resolving = true;
          const position = await fixture?.resolveName(current.name, signal) ??
            await catalogClient.resolve(current.name, signal);
          resolving = false;
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
        if (!resolving) {
          setPreview({ kind: "error", message: error instanceof ArchiveRequestError
            ? error.message : "The archive service could not be reached." });
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
    setPanel("comparison");
  }

  function compareViewport(field: Field) {
    if (!inFieldRange(field.fovArcmin, fieldLimits)) {
      setMapNotice(`Zoom to a field width of ${fieldLimits.min}–${fieldLimits.max} arcmin before comparing.`);
      return;
    }
    setMapNotice("");
    setRequest({ kind: "field", field });
    setPanel("comparison");
  }

  const comparison =
    preview.kind === "search" ? preview.result.comparison :
    preview.kind === "saved" ? preview.comparison : null;
  const selection = frameSelection?.comparisonId === comparison?.id ? frameSelection : null;
  const frameMark = comparisonMark?.comparisonId === comparison?.id ? comparisonMark?.mark ?? null : null;
  const inspectingCutout = inspectFrame && selection;
  const activeMark = inspectingCutout ? frameMark : catalogMark;

  const status =
    preview.kind === "search" ? scenarios[preview.result.status] :
    preview.kind === "saved" ? "Saved comparison" :
    preview.kind === "missing" ? "Saved comparison not found" :
    preview.kind === "name_not_found" ? "Object name not found. Try a preset or enter sky coordinates." :
    preview.kind === "catalog_error" ? "Name lookup is unavailable. Try a preset or enter sky coordinates." :
    preview.kind === "error" ? preview.message :
    preview.kind === "idle" ? "Choose a field to compare." :
    "Loading comparison…";
  const diagnostics = preview.kind === "search" ? preview.result.diagnostics : comparison?.diagnostics;
  const kind = comparison?.provenance?.evidenceKind;
  const fallbackAvailable = preview.kind === "error" ||
    (preview.kind === "search" && preview.result.status === "upstream_unavailable");

  async function openExample() {
    const id = fixtureMode ? (await import("./fixtures")).savedFixtureId : retainedExample.comparison.id;
    setRequest({ kind: "saved", id });
  }

  function comparisonLink(id: string) {
    const link = new URL(location.href);
    link.searchParams.set("comparison", id);
    return link.href;
  }

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(comparisonLink(id));
      setCopyStatus("Comparison link copied.");
    } catch {
      setCopyStatus("Copying failed. Use the saved comparison link.");
    }
  }

  return (
    <main className="sky-workspace" onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented && panel) closePanel(panel);
    }}>
      <SkyMap initialCenter={initialCenter} focus={focus} onCompare={compareViewport}
        onInspect={inspect} catalogMark={catalogMark} notice={mapNotice} />
      <header className="viewer-bar">
        <h1>SPHEREx viewer</h1>
        <nav className="panel-buttons" aria-label="Viewer panels">
          {([["search", "Search"], ["comparison", "Comparison"], ["gaia", "Gaia"]] as const).map(([id, label]) => (
            <button key={id} type="button" ref={(button) => {
              if (button) panelButtons.current[id] = button;
            }} aria-expanded={panel === id} aria-controls={`${id}-panel`}
              onClick={() => setPanel(panel === id ? null : id)}>{label}</button>
          ))}
        </nav>
      </header>
      <section id="gaia-panel" aria-labelledby="gaia-heading" className="floating-panel panel-right" hidden={panel !== "gaia"}>
        <div className="panel-heading">
          <h2 id="gaia-heading">Gaia source inspector</h2>
          <button type="button" onClick={() => closePanel("gaia")}>Close</button>
        </div>
        {inspectingCutout && <p>Selected SPHEREx frame <time dateTime={inspectingCutout.frame.observedAtUtc}>
          {inspectingCutout.frame.observedAtUtc}
        </time> · RA {inspectingCutout.position.ra.toFixed(6)}°, Dec {inspectingCutout.position.dec.toFixed(6)}°</p>}
        <SourceInspector skyPosition={inspectFrame ? selection?.position ?? null : inspecting}
          selectedFrame={inspectingCutout ? inspectingCutout.frame : null} client={catalogClient}
          onMark={(mark) => {
            if (inspectingCutout) setComparisonMark({ comparisonId: inspectingCutout.comparisonId, mark });
            else setCatalogMark(mark);
          }} />
        {activeMark && (
          <p role="status">
            {activeMark.predicted ? "Predicted Gaia position" : "Gaia catalog position"} for {activeMark.sourceId}
            {" at RA "}{activeMark.ra.toFixed(6)}°, Dec {activeMark.dec.toFixed(6)}°.{" "}
            <button type="button" onClick={() => {
              if (inspectingCutout) setComparisonMark(null);
              else setCatalogMark(null);
            }}>Clear mark</button>
          </p>
        )}
      </section>
      <section id="search-panel" aria-labelledby="search-heading" className="floating-panel panel-left" hidden={panel !== "search"}>
        <div className="panel-heading">
          <h2 id="search-heading">Compare a field</h2>
          <button type="button" onClick={() => closePanel("search")}>Close</button>
        </div>
        <FieldSearch field={initialField} limits={fieldLimits} onSearch={search}
          onResolve={(name, fovArcmin) => {
            setMapNotice("");
            setRequest({ kind: "name", name, fovArcmin });
            setPanel("comparison");
          }} />
      </section>
      <section id="comparison-panel" aria-labelledby="comparison-heading" className="floating-panel panel-right" hidden={panel !== "comparison"}>
        <div className="panel-heading">
          <h2 id="comparison-heading">Comparison</h2>
          <button type="button" onClick={() => closePanel("comparison")}>Close</button>
        </div>
        {fixtureMode && <p>Development fixtures. Comparison images and metadata are synthetic.</p>}
        {fixtureMode && <div className="controls">
          <label>
            Archive response
            <select value={scenario} onChange={(event) => {
              setScenario(event.target.value as Scenario);
              setRequest((current) => current?.kind === "field" ? current : { kind: "field", field: initialField });
            }}>
              {Object.entries(scenarios).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button onClick={openExample}>Open saved fixture</button>
          <button onClick={() => setRequest({ kind: "saved", id: "missing-fixture" })}>Try missing ID</button>
          {request?.kind === "saved" && <button onClick={() => setRequest(null)}>Back to search</button>}
        </div>}
        <p role="status">{status}</p>
        {preview.kind === "loading" && request?.kind !== "saved" && <p>An archive search can take a few minutes.</p>}
        {typeof diagnostics?.message === "string" && <p>{diagnostics.message}</p>}
        {comparison && diagnostics?.complete === false && <p>This comparison comes from an incomplete archive search.</p>}
        {fallbackAvailable && request && (
          <div className="controls">
            <button type="button" onClick={() => setRequest({ ...request })}>Retry</button>
            {request.kind !== "saved" && <button type="button" onClick={openExample}>
              {fixtureMode ? "Open saved fixture" : "Open saved real example"}
            </button>}
          </div>
        )}
        {!fixtureMode && preview.kind === "idle" && (
          <button type="button" onClick={openExample}>Open saved real example</button>
        )}
        {preview.kind === "search" && (
          <p>
            Requested RA {preview.field.ra.toFixed(6)}°, Dec {preview.field.dec.toFixed(6)}°,
            width {preview.field.fovArcmin.toFixed(2)} arcmin.
          </p>
        )}
        {comparison && (
          <>
            <p>{fixtureMode || kind === "synthetic_fixture" ? "Synthetic comparison" :
              kind === "saved_real_example" ? "Saved real SPHEREx example" : "SPHEREx archive observations"}</p>
            <ComparisonPlayback key={comparison.id} comparison={comparison} visible={panel === "comparison"}
              selectedPosition={selection?.position ?? null} frameMark={frameMark}
              onInspect={(position, frame) => inspectCutout(comparison.id, position, frame)} />
            <div className="controls">
              <a href={comparisonLink(comparison.id)}>Saved comparison link</a>
              <button type="button" onClick={() => void copyLink(comparison.id)}>Copy comparison link</button>
            </div>
            {copyStatus && <p role="status">{copyStatus}</p>}
          </>
        )}
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Fixture harness root is missing.");
createRoot(root).render(<Harness />);
