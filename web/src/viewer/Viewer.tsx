import { useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import type { Comparison, ComparisonFrame, ComparisonResult, Field, SkyPosition, ViewerDataSource } from "./comparison";
import { CatalogApiError, type SourceInspectorProps, type MarkAction, type SelectedFrameMeta } from "../inspector";
import { LeaderboardPanel, type LeaderboardDataSource, type LeaderboardEntry } from "../leaderboard";
import { targetPresets } from "./coordinates";
import { FieldSearch, inFieldRange } from "./FieldSearch";
import { SkyMap } from "./SkyMap";
import { archiveFieldLimits, ArchiveRequestError } from "./archive";
import { ComparisonPlayback } from "./ComparisonPlayback";
import { SpectralRuler, bandColors } from "./SpectralRuler";
import { bandForWavelength, spherexMosaicSlice } from "./spherexSurvey";
import { EvidenceReplayError, evidenceLink, validateFinding, type SavedFinding, type EvidenceDiscussionProps } from "./evidence";
import "./styles.css";

const scenarios: Record<ComparisonResult["status"], string> = {
  ready: "Matched pair",
  single_epoch: "Single epoch",
  no_coverage: "No coverage",
  no_comparable_pair: "No comparable pair",
  upstream_unavailable: "Archive unavailable",
};

/** Short labels for the header badge. Kept distinct from the status messages in the comparison panel. */
const badges: Record<ComparisonResult["status"], string> = {
  ready: "Matched pair",
  single_epoch: "Single epoch",
  no_coverage: "No SPHEREx coverage",
  no_comparable_pair: "No matched pair",
  upstream_unavailable: "Archive offline",
};

/** Publishes an element's height as a CSS variable on the workspace, so panels can avoid it. */
function useHeightVariable(workspace: RefObject<HTMLElement | null>, selector: string, variable: string) {
  useEffect(() => {
    const host = workspace.current;
    const element = host?.querySelector(selector);
    if (!host || !element) return;
    const observer = new ResizeObserver(() => {
      host.style.setProperty(variable, `${element.getBoundingClientRect().height}px`);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [workspace, selector, variable]);
}

function formatAngle(value: number, signed = false) {
  return `${signed && value >= 0 ? "+" : ""}${value.toFixed(6)}°`;
}

const initialCenter = targetPresets[0];
const initialField = { ...initialCenter, fovArcmin: 6 };
const fieldLimits = archiveFieldLimits;
export interface ViewerControlsProps {
  onSearch: (field: Field) => void;
  onLoadSaved: (id: string, findingId?: string) => void;
  onReset: () => void;
}
export interface ViewerProps {
  dataSource: ViewerDataSource;
  Inspector: ComponentType<Omit<SourceInspectorProps, "client">>;
  Discussion?: ComponentType<EvidenceDiscussionProps>;
  loadFinding?: (id: string, signal?: AbortSignal) => Promise<SavedFinding | null>;
  Controls?: ComponentType<ViewerControlsProps>;
  /** Optional engagement layer; the leaderboard button is hidden without it. */
  leaderboard?: LeaderboardDataSource;
  savedExampleId: string;
  synthetic?: boolean;
}

type Request =
  | { kind: "field"; field: Field }
  | { kind: "name"; name: string; fovArcmin: number }
  | { kind: "saved"; id: string; findingId?: string };

type Panel = "search" | "comparison" | "gaia";

type Preview =
  | { kind: "idle" | "loading" | "missing" | "name_not_found" | "catalog_error" }
  | { kind: "error"; message: string }
  | { kind: "search"; result: ComparisonResult; field: Field }
  | { kind: "saved"; comparison: Comparison; finding?: SavedFinding };

const narrowScreen = "(max-width: 42rem)";

export function Viewer({ dataSource, Inspector, Discussion, loadFinding, Controls, leaderboard, savedExampleId, synthetic = false }: ViewerProps) {
  const [request, setRequest] = useState<Request | null>(() => {
    const id = new URLSearchParams(location.search).get("comparison");
    const findingId = new URLSearchParams(location.search).get("finding") ?? undefined;
    return id || findingId ? { kind: "saved", id: id ?? "", findingId } : null;
  });
  const [focus, setFocus] = useState<Field | null>(null);
  const [panel, setPanel] = useState<Panel | null>(() =>
    (new URLSearchParams(location.search).has("comparison") || new URLSearchParams(location.search).has("finding")) ? "comparison" : null);
  const panelButtons = useRef<Partial<Record<Panel, HTMLButtonElement>>>({});
  // The leaderboard sits on the left and can stay open beside the right-hand panels.
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const leaderboardButton = useRef<HTMLButtonElement>(null);
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
  const [mapSlice, setMapSlice] = useState(spherexMosaicSlice);
  const [mapState, setMapState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [frameOnScreen, setFrameOnScreen] = useState<ComparisonFrame | null>(null);
  const workspace = useRef<HTMLElement>(null);
  useHeightVariable(workspace, ".instrument-bar", "--header-height");
  useHeightVariable(workspace, ".sky-dock", "--dock-height");
  useEffect(() => {
    function restore() {
      const params = new URLSearchParams(location.search);
      const id = params.get("comparison") ?? "";
      const findingId = params.get("finding") ?? undefined;
      setRequest(id || findingId ? { kind: "saved", id, findingId } : null);
      setPanel(id || findingId ? "comparison" : null);
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function closePanel(current: Panel) {
    setPanel(null);
    panelButtons.current[current]?.focus();
  }

  function closeLeaderboard() {
    setLeaderboardOpen(false);
    leaderboardButton.current?.focus();
  }

  function toggleLeaderboard() {
    // Search shares the left edge, and on narrow screens every panel is a bottom sheet.
    if (!leaderboardOpen && panel && (panel === "search" || window.matchMedia(narrowScreen).matches)) setPanel(null);
    setLeaderboardOpen(!leaderboardOpen);
  }

  useEffect(() => {
    if (panel === "search" || (panel && window.matchMedia(narrowScreen).matches)) setLeaderboardOpen(false);
  }, [panel]);

  function goToEntry(entry: LeaderboardEntry) {
    setMapNotice("");
    setFocus({ ra: entry.ra, dec: entry.dec, fovArcmin: entry.fovArcmin });
  }

  function showEntryEvidence(entry: LeaderboardEntry) {
    if (!entry.comparisonId) return;
    if (window.matchMedia(narrowScreen).matches) setLeaderboardOpen(false);
    setRequest({ kind: "saved", id: entry.comparisonId, findingId: entry.findingId ?? undefined });
    setPanel("comparison");
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
        const source = dataSource;
        if (current.kind === "saved") {
          let finding: SavedFinding | undefined;
          if (current.findingId) {
            if (!loadFinding) throw new EvidenceReplayError("Finding replay is not connected yet. Open the comparison without the finding parameter.");
            finding = await loadFinding(current.findingId, signal) ?? undefined;
            if (signal.aborted) return;
            if (!finding) throw new EvidenceReplayError("Saved finding not found. Check the finding ID.");
          }
          const comparison = await source.loadSaved(current.id || finding?.comparisonId || "", signal);
          if (comparison && finding) validateFinding(finding, comparison);
          if (!signal.aborted) {
            setPreview(comparison ? { kind: "saved", comparison, finding } : { kind: "missing" });
            if (comparison) setFocus(comparison.field);
          }
          return;
        }

        let field: Field;
        if (current.kind === "name") {
          resolving = true;
          const position = await source.resolveName(current.name, signal);
          if (!position) {
            if (!signal.aborted) setPreview({ kind: "name_not_found" });
            return;
          }
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
  }, [dataSource, loadFinding, request]);

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

  function openExample() {
    setRequest({ kind: "saved", id: savedExampleId });
  }

  function comparisonLink(id: string, findingId?: string) {
    return evidenceLink(location.href, id, findingId);
  }

  function showEvidence(finding: SavedFinding) {
    setRequest({ kind: "saved", id: finding.comparisonId, findingId: finding.id });
    setPanel("comparison");
  }

  async function copyLink(id: string, findingId?: string) {
    try {
      await navigator.clipboard.writeText(comparisonLink(id, findingId));
      setCopyStatus(findingId ? "Evidence link copied." : "Comparison link copied.");
    } catch {
      setCopyStatus("Copying failed. Use the saved evidence link below.");
    }
  }
  const finding = preview.kind === "saved" ? preview.finding : undefined;

  const source = synthetic || kind === "synthetic_fixture" ? "synthetic" :
    kind === "saved_real_example" ? "saved real" : "live archive";
  const badge =
    preview.kind === "search" ? (comparison ? `${badges[preview.result.status]} · ${source}` : badges[preview.result.status]) :
    preview.kind === "saved" ? `${preview.comparison.frames.length > 1 ? "Matched pair" : "Single epoch"} · ${source}` :
    preview.kind === "loading" ? "Loading" :
    preview.kind === "idle" ? "No field selected" :
    preview.kind === "name_not_found" || preview.kind === "missing" ? "Not found" : "Unavailable";
  const tone = comparison ? "ready" : preview.kind === "idle" || preview.kind === "loading" ? "idle" : "problem";
  const readoutField = comparison?.field ?? (preview.kind === "search" ? preview.field : focus);
  const bands = comparison ? [...new Set(comparison.wavelengthRangeUm.map(bandForWavelength))] : [];
  const frameShown = comparison && frameOnScreen && comparison.frames.includes(frameOnScreen) ? frameOnScreen : null;

  return (
    <main className="sky-workspace" ref={workspace} onKeyDown={(event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (panel) closePanel(panel);
      else if (leaderboardOpen) closeLeaderboard();
    }}>
      <SkyMap initialCenter={initialCenter} focus={focus} onCompare={compareViewport}
        onInspect={inspect} catalogMark={catalogMark} notice={mapNotice}
        slice={mapSlice} onStateChange={setMapState}
        dock={<SpectralRuler mapSlice={mapSlice} onSelectSlice={setMapSlice} disabled={mapState !== "ready"}
          frameWavelengthUm={frameShown?.wavelengthUm ?? null}
          frameLabel={frameShown && comparison ? `Frame ${comparison.frames.indexOf(frameShown) + 1} · ${frameShown.wavelengthUm.toFixed(4)} µm` : null} />} />
      <header className="instrument-bar">
        <div className="brand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
          </svg>
          <span>SPHEREx / Field viewer</span>
        </div>
        {leaderboard && (
          <nav className="panel-buttons bar-start" aria-label="Engagement panels">
            <button type="button" ref={leaderboardButton} aria-expanded={leaderboardOpen}
              aria-controls="leaderboard-panel" onClick={toggleLeaderboard}>Leaderboard</button>
          </nav>
        )}
        <dl className="readouts" aria-label="Current field">
          <div><dt>RA</dt><dd>{readoutField ? formatAngle(readoutField.ra) : "—"}</dd></div>
          <div><dt>Dec</dt><dd>{readoutField ? formatAngle(readoutField.dec, true) : "—"}</dd></div>
          <div><dt>Width</dt><dd>{readoutField ? `${readoutField.fovArcmin.toFixed(2)} arcmin` : "—"}</dd></div>
          <div><dt>Frames</dt><dd>
            {comparison ? <>
              {bands.map((band) => band && <span key={band} className="band-swatch" style={{ background: bandColors[band - 1] }} aria-hidden="true" />)}
              {bands.some(Boolean) && `B${bands.filter(Boolean).join("–")} · `}
              {comparison.wavelengthRangeUm.map((value) => value.toFixed(4)).join("–")} µm
            </> : "—"}
          </dd></div>
        </dl>
        <div className="bar-actions">
          <span className="status-badge" data-tone={tone}><span className="status-dot" aria-hidden="true" />{badge}</span>
          <nav className="panel-buttons" aria-label="Viewer panels">
            {([["search", "Search"], ["comparison", "Comparison"], ["gaia", "Gaia"]] as const).map(([id, label]) => (
              <button key={id} type="button" ref={(button) => {
                if (button) panelButtons.current[id] = button;
              }} aria-expanded={panel === id} aria-controls={`${id}-panel`}
                onClick={() => setPanel(panel === id ? null : id)}>{label}</button>
            ))}
          </nav>
        </div>
      </header>
      {leaderboard && (
        <section id="leaderboard-panel" aria-labelledby="leaderboard-heading"
          className="floating-panel panel-left leaderboard-panel" hidden={!leaderboardOpen}>
          <div className="panel-heading">
            <h2 id="leaderboard-heading">Rarity leaderboard</h2>
            <button type="button" onClick={closeLeaderboard}>Close</button>
          </div>
          <LeaderboardPanel dataSource={leaderboard} open={leaderboardOpen}
            onGoTo={goToEntry} onShowEvidence={showEntryEvidence} />
        </section>
      )}
      <section id="gaia-panel" aria-labelledby="gaia-heading" className="floating-panel panel-right" hidden={panel !== "gaia"}>
        <div className="panel-heading">
          <h2 id="gaia-heading">Gaia source inspector</h2>
          <button type="button" onClick={() => closePanel("gaia")}>Close</button>
        </div>
        {inspectingCutout && <p>Selected SPHEREx frame <time dateTime={inspectingCutout.frame.observedAtUtc}>
          {inspectingCutout.frame.observedAtUtc}
        </time> · RA {inspectingCutout.position.ra.toFixed(6)}°, Dec {inspectingCutout.position.dec.toFixed(6)}°</p>}
        <Inspector skyPosition={inspectFrame ? selection?.position ?? null : inspecting}
          selectedFrame={inspectingCutout ? inspectingCutout.frame : null}
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
        {synthetic && <p>Development fixtures. Comparison images and metadata are synthetic.</p>}
        {Controls && <Controls onSearch={search}
          onLoadSaved={(id, findingId) => { setRequest({ kind: "saved", id, findingId }); setPanel("comparison"); }}
          onReset={() => setRequest(null)} />}
        <p role="status">{status}</p>
        {preview.kind === "loading" && request?.kind !== "saved" && <p>An archive search can take a few minutes.</p>}
        {typeof diagnostics?.message === "string" && <p>{diagnostics.message}</p>}
        {comparison && diagnostics?.complete === false && <p>This comparison comes from an incomplete archive search.</p>}
        {fallbackAvailable && request && (
          <div className="controls">
            <button type="button" onClick={() => setRequest({ ...request })}>Retry</button>
            {request.kind !== "saved" && <button type="button" onClick={openExample}>
              {synthetic ? "Open saved fixture" : "Open saved real example"}
            </button>}
          </div>
        )}
        {!synthetic && preview.kind === "idle" && (
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
            <p>{synthetic || kind === "synthetic_fixture" ? "Synthetic comparison" :
              kind === "saved_real_example" ? "Saved real SPHEREx example" : "SPHEREx archive observations"}</p>
            <ComparisonPlayback key={comparison.id} comparison={comparison} visible={panel === "comparison"}
              selectedPosition={selection?.position ?? null} frameMark={frameMark} savedMarks={finding?.marks}
              onInspect={(position, frame) => inspectCutout(comparison.id, position, frame)}
              onFrameChange={setFrameOnScreen} />
            {finding && Discussion && <Discussion finding={finding} onShowEvidence={showEvidence}
              onCopyLink={(value) => void copyLink(value.comparisonId, value.id)} />}
            {finding && <p><a href={comparisonLink(comparison.id, finding.id)}>Saved evidence link</a></p>}
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
