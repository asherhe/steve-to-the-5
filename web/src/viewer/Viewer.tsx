import { useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import type { Comparison, ComparisonFrame, ComparisonResult, Field, SkyPosition, ViewerDataSource } from "./comparison";
import { angularSeparationArcsec, CatalogApiError, predictAtObservation, type CatalogAstrometry, type SourceInspectorProps, type MarkAction, type SelectedFrameMeta, type ResolveResult } from "../inspector";
import { LeaderboardPanel, type LeaderboardDataSource, type LeaderboardEntry } from "../leaderboard";
import { barnardGaiaSourceId, targetPresets } from "./coordinates";
import { FieldSearch, inFieldRange } from "./FieldSearch";
import { SkyMap } from "./SkyMap";
import { SearchBox } from "./SearchBox";
import { archiveFieldLimits, ArchiveRequestError } from "./archive";
import { FloatingPane } from "./FloatingPane";
import { TimeControls } from "./TimeControls";
import { usePlayback } from "./usePlayback";
import { ComparisonPlayback } from "./ComparisonPlayback";
import { cutoutWcs } from "./cutoutWcs";
import { SpectralRuler, bandColors } from "./SpectralRuler";
import { bandForWavelength, spherexMosaicGuideTimeUtc, spherexMosaicSlice } from "./spherexSurvey";
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
  | { kind: "idle" | "loading" | "missing" | "name_not_found" }
  | { kind: "error" | "catalog_error"; message: string }
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
  const [panels, setPanels] = useState<Record<Panel,boolean>>({ search:false, comparison:new URLSearchParams(location.search).has("finding"), gaia:false });
  const [timeOpen,setTimeOpen] = useState(() => new URLSearchParams(location.search).has("comparison") || new URLSearchParams(location.search).has("finding"));
  const [layoutReset,setLayoutReset] = useState(0);
  function openPanel(panel: Panel) { setPanels(old => ({...old,[panel]:true})); }
  const timeButton = useRef<HTMLButtonElement>(null);
  const panelButtons = useRef<Partial<Record<Panel, HTMLElement>>>({});
  // The leaderboard is its own window so it can stay open beside the other panes.
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const leaderboardButton = useRef<HTMLButtonElement>(null);
  const [mapNotice, setMapNotice] = useState("");
  const [inspecting, setInspecting] = useState<{ position: SkyPosition; onSpherexMosaic: boolean } | null>(null);
  const [frameSelection, setFrameSelection] = useState<{
    comparisonId: string; position: SkyPosition; frame: SelectedFrameMeta;
  } | null>(null);
  const [inspectFrame, setInspectFrame] = useState(false);
  const [catalogMark, setCatalogMark] = useState<MarkAction | null>(null);
  const [comparisonMark, setComparisonMark] = useState<{ comparisonId: string; source: CatalogAstrometry; displayName?: string } | null>(null);
  const [preview, setPreview] = useState<Preview>({ kind: "idle" });
  const [resolvedTarget, setResolvedTarget] = useState<{ request: Request; result: ResolveResult } | null>(null);
  const target = resolvedTarget?.request === request ? resolvedTarget.result : null;
  const targetLabel = target?.identity?.commonName || target?.identity?.displayName || target?.name;
  const [copyStatus, setCopyStatus] = useState("");
  const [mapSlice, setMapSlice] = useState(spherexMosaicSlice);
  const [mapState, setMapState] = useState<"loading" | "ready" | "unavailable">("loading");
  const workspace = useRef<HTMLElement>(null);
  useHeightVariable(workspace, ".instrument-bar", "--header-height");
  useHeightVariable(workspace, ".sky-dock", "--dock-height");
  useEffect(() => {
    function restore() {
      const params = new URLSearchParams(location.search);
      const id = params.get("comparison") ?? "";
      const findingId = params.get("finding") ?? undefined;
      setRequest(id || findingId ? { kind: "saved", id, findingId } : null);
      setTimeOpen(!!(id || findingId));
      setPanels(old=>({...old,comparison:!!findingId}));
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  function closePanel(current: Panel) {
    setPanels(old => ({ ...old, [current]: false }));
    panelButtons.current[current]?.focus();
  }

  function closeLeaderboard() {
    setLeaderboardOpen(false);
    leaderboardButton.current?.focus();
  }

  function goToEntry(entry: LeaderboardEntry) {
    setMapNotice("");
    setFocus({ ra: entry.ra, dec: entry.dec, fovArcmin: entry.fovArcmin });
  }

  function showEntryEvidence(entry: LeaderboardEntry) {
    if (!entry.comparisonId) return;
    if (window.matchMedia(narrowScreen).matches) setLeaderboardOpen(false);
    setRequest({ kind: "saved", id: entry.comparisonId, findingId: entry.findingId ?? undefined });
    setTimeOpen(true);
    openPanel("comparison");
  }

  function inspect(position: SkyPosition, onSpherexMosaic: boolean) {
    setInspecting({ position, onSpherexMosaic });
    setInspectFrame(false);
    openPanel("gaia");
  }
  function inspectCutout(comparisonId: string, position: SkyPosition, frame: ComparisonFrame) {
    setFrameSelection({
      comparisonId,
      position,
      frame: { frameId: frame.id, observedAtUtc: frame.observedAtUtc, wavelengthUm: frame.wavelengthUm },
    });
    setInspectFrame(true);
    openPanel("gaia");
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
      setResolvedTarget(null);
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
          setResolvedTarget({ request: current, result: position });
          field = { ra: position.ra, dec: position.dec, fovArcmin: current.fovArcmin };
          setFocus(field);
        } else {
          field = current.field;
        }

        const result = await source.search(field, signal);
        if (!signal.aborted) {
          setPreview({ kind: "search", result, field });
          if (result.comparison && synthetic) setFocus(result.comparison.field);
        }
      } catch (error) {
        if (signal.aborted) return;
        if (!resolving) {
          setPreview({ kind: "error", message: error instanceof ArchiveRequestError || error instanceof EvidenceReplayError
            ? error.message : "The archive service could not be reached." });
        } else {
          const missing = error instanceof CatalogApiError && error.code === "not_found";
          setPreview(missing ? { kind: "name_not_found" } : { kind: "catalog_error", message: error instanceof CatalogApiError ? error.message : "Name lookup is unavailable. Try a preset or enter sky coordinates." });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [dataSource, loadFinding, request, synthetic]);

  function search(field: Field) {
    setPanels(old=>({...old,search:false}));
    setMapNotice("");
    setFocus(field);
    setRequest({ kind: "field", field });
    setTimeOpen(true);
  }

  function resolve(name: string, fovArcmin: number) {
    setPanels(old=>({...old,search:false}));
    setMapNotice("");
    setRequest({ kind: "name", name, fovArcmin });
    setTimeOpen(true);
  }

  function compareViewport(field: Field) {
    if (!inFieldRange(field.fovArcmin, fieldLimits)) {
      setMapNotice(`Zoom to a field width of ${fieldLimits.min}–${fieldLimits.max} arcmin before comparing.`);
      return;
    }
    setMapNotice("");
    setRequest({ kind: "field", field });
    setTimeOpen(true);
  }

  const comparison =
    preview.kind === "search" ? preview.result.comparison :
    preview.kind === "saved" ? preview.comparison : null;
  const playback = usePlayback(comparison, timeOpen && preview.kind !== "loading");
  const selection = frameSelection?.comparisonId === comparison?.id ? frameSelection : null;
  const markedSource = comparisonMark?.comparisonId === comparison?.id ? comparisonMark?.source : null;
  const frame = playback.frame;
  const prediction = markedSource && frame ? predictAtObservation(markedSource, frame.observedAtUtc) : null;
  const imagePoint = comparison && prediction ? cutoutWcs(comparison.grid)?.toImage(prediction) : null;
  const frameMark = comparison && frame && playback.assets[frame.id]?.state === "ready" &&
    imagePoint && imagePoint.x >= -0.5 && imagePoint.x < comparison.grid.width - 0.5 &&
    imagePoint.y >= -0.5 && imagePoint.y < comparison.grid.height - 0.5 ? prediction : null;
  const inspectingCutout = inspectFrame && selection && playback.frame ? {
    ...selection, frame:{frameId:playback.frame.id,observedAtUtc:playback.frame.observedAtUtc,wavelengthUm:playback.frame.wavelengthUm}
  } : null;
  const markedSourceId = inspectingCutout ? markedSource?.sourceId : catalogMark?.sourceId;
  const markedPosition = inspectingCutout ? prediction : catalogMark;
  const markedName = inspectingCutout ? comparisonMark?.displayName : catalogMark?.displayName;
  const mosaicInspection = !inspectFrame && inspecting?.onSpherexMosaic ? inspecting : null;
  const mosaicGuideSourceId = mosaicInspection && angularSeparationArcsec(mosaicInspection.position, initialCenter) <= 60
    ? barnardGaiaSourceId : undefined;

  const status =
    preview.kind === "search" ? scenarios[preview.result.status] :
    preview.kind === "saved" ? "Saved comparison" :
    preview.kind === "missing" ? "Saved comparison not found" :
    preview.kind === "name_not_found" ? "Object name not found. Try a preset or enter sky coordinates." :
    preview.kind === "catalog_error" ? preview.message :
    preview.kind === "error" ? preview.message :
    preview.kind === "idle" ? "Choose a field to compare." :
    "Loading comparison…";
  const diagnostics = preview.kind === "search" ? preview.result.diagnostics : comparison?.diagnostics;
  const kind = comparison?.provenance?.evidenceKind;
  const fallbackAvailable = preview.kind === "error" ||
    (preview.kind === "search" && preview.result.status === "upstream_unavailable");

  function openExample() {
    setTimeOpen(true);
    setRequest({ kind: "saved", id: savedExampleId });
  }

  function comparisonLink(id: string, findingId?: string) {
    return evidenceLink(location.href, id, findingId);
  }

  function showEvidence(finding: SavedFinding) {
    setRequest({ kind: "saved", id: finding.comparisonId, findingId: finding.id });
    setTimeOpen(true);
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
  const frameShown = comparison ? playback.frame : null;

  return (
    <main className="sky-workspace" ref={workspace}>
      <SkyMap initialCenter={initialCenter} focus={focus} onCompare={compareViewport}
        onInspect={inspect} onAdvancedSearch={() => openPanel("search")} catalogMark={catalogMark} target={target} notice={mapNotice}
        slice={mapSlice} onStateChange={setMapState}
        dated={comparison && playback.frame ? {comparison,frame:playback.frame,assets:playback.assets,attempt:playback.attempt,
          selected:selection?.position ?? null,marks:finding?.marks ?? [],predictedMark:frameMark,predictedLabel:markedName ?? (markedSourceId ? `Gaia DR3 ${markedSourceId}` : undefined)} : null}
        onInspectDated={position=>{playback.pause();if(comparison && playback.frame)inspectCutout(comparison.id,position,playback.frame);}}
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
        <SearchBox fovArcmin={initialField.fovArcmin} onSearch={search} onResolve={resolve} />
        {leaderboard && (
          <nav className="panel-buttons bar-start" aria-label="Engagement panels">
            <button type="button" ref={leaderboardButton} aria-expanded={leaderboardOpen}
              aria-controls="leaderboard-panel" onClick={() => setLeaderboardOpen(!leaderboardOpen)}>Leaderboard</button>
          </nav>
        )}
        <dl className="readouts" aria-label="Current field">
          {target && <div className="target-readout"><dt>Requested target</dt><dd>{targetLabel}</dd></div>}
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
            <button ref={timeButton} type="button" aria-expanded={timeOpen} aria-controls="time-window"
              onClick={() => setTimeOpen(!timeOpen)}>Time</button>
            {([["search", "Advanced"], ["comparison", "Comparison"], ["gaia", "Gaia"]] as const).map(([id, label]) => (
              <button key={id} type="button" ref={(button) => {
                if (button) panelButtons.current[id] = button;
              }} aria-expanded={panels[id]} aria-controls={`${id}-panel`}
                onClick={() => setPanels((old) => ({ ...old, [id]: !old[id] }))}>{label}</button>
            ))}
            <button type="button" aria-label="Reset layout" title="Reset window positions"
              onClick={() => setLayoutReset((value) => value + 1)}>↺</button>
          </nav>
        </div>
      </header>
      {leaderboard && (
        <FloatingPane id="leaderboard-panel" title="Rarity leaderboard" anchor="left" open={leaderboardOpen} reset={layoutReset} onClose={closeLeaderboard}>
          <LeaderboardPanel dataSource={leaderboard} open={leaderboardOpen} onGoTo={goToEntry} onShowEvidence={showEntryEvidence} />
        </FloatingPane>
      )}
      <FloatingPane id="gaia-panel" title="Source inspector" open={panels.gaia} onClose={()=>closePanel("gaia")} reset={layoutReset}>
        {inspectingCutout && <p>Selected SPHEREx frame <time dateTime={inspectingCutout.frame.observedAtUtc}>
          {inspectingCutout.frame.observedAtUtc}
        </time> · RA {inspectingCutout.position.ra.toFixed(6)}°, Dec {inspectingCutout.position.dec.toFixed(6)}°</p>}
        <Inspector skyPosition={inspectFrame ? selection?.position ?? null : inspecting?.position ?? null}
          selectedFrame={inspectingCutout ? inspectingCutout.frame : null}
          mosaicGuideTimeUtc={mosaicInspection ? spherexMosaicGuideTimeUtc : undefined}
          mosaicGuideSourceId={mosaicGuideSourceId}
          onMark={(mark) => {
            if (inspectingCutout) setComparisonMark({ comparisonId: inspectingCutout.comparisonId, source: mark.astrometry, displayName: mark.displayName });
            else setCatalogMark(mark);
          }} />
        {markedSourceId && (
          <p role="status">
            {inspectingCutout ? "Predicted Gaia position" :
              catalogMark?.predicted ? "Approximate Gaia position on the SPHEREx mosaic" : "Gaia catalog position"} for {markedName ? `${markedName} · ` : ""}{markedSourceId}
            {markedPosition && <>{" at RA "}{markedPosition.ra.toFixed(6)}°, Dec {markedPosition.dec.toFixed(6)}°</>}.{" "}
            <button type="button" onClick={() => {
              if (inspectingCutout) setComparisonMark(null);
              else setCatalogMark(null);
            }}>Clear mark</button>
          </p>
        )}
      </FloatingPane>
      <FloatingPane id="search-panel" title="Advanced search" anchor="left" open={panels.search} onClose={()=>closePanel("search")} reset={layoutReset}>
        <FieldSearch field={initialField} limits={fieldLimits} onSearch={search} onResolve={resolve} />
      </FloatingPane>
      <FloatingPane id="time-window" title="Time" anchor="time" badge={comparison ? synthetic || kind === "synthetic_fixture" || kind === "fixture" ? "Synthetic" : kind === "saved_real_example" ? "Saved example" : "SPHEREx" : undefined} open={timeOpen} reset={layoutReset} onClose={()=>{playback.pause();setTimeOpen(false);timeButton.current?.focus();}}>

        {Controls && <details className="fixture-tools"><summary>Development fixtures</summary>
          <p>Comparison images and metadata are synthetic.</p>
          <Controls onSearch={search}
            onLoadSaved={(id,findingId)=>{setRequest({kind:"saved",id,findingId});setTimeOpen(true);}}
            onReset={()=>setRequest(null)} />
        </details>}
        {target && <section className="target-summary" aria-label="Requested target">
          <strong>{targetLabel}</strong>
          <small>Requested target · name resolved, image detection not established.</small>
        </section>}
        {!comparison && <p role="status">{status}</p>}
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
        {preview.kind === "search" && !comparison && (
          <p>
            Requested RA {preview.field.ra.toFixed(6)}°, Dec {preview.field.dec.toFixed(6)}°,
            width {preview.field.fovArcmin.toFixed(2)} arcmin.
          </p>
        )}
        {preview.kind === "idle" && <button type="button" onClick={()=>resolve(targetPresets[0].name, initialField.fovArcmin)}>Load images of Barnard’s Star</button>}
        {preview.kind === "loading" && <button type="button" onClick={()=>setRequest(null)}>Cancel</button>}
        {comparison && <>
          <TimeControls comparison={comparison} playback={playback} onDetails={()=>openPanel("comparison")} />
        </>}
      </FloatingPane>
      <FloatingPane id="comparison-panel" title="Compare details" open={panels.comparison} reset={layoutReset} onClose={()=>closePanel("comparison")}>
        {target && <section className="target-context" aria-label="Target details">
          <strong>{targetLabel}</strong>
          {target.identity && <p>{target.identity.canonicalDesignation} · {target.identity.component}</p>}
          <p>Name resolved. Identification of an image source and visible target detection are not established by this lookup.</p>
          <small>{target.positionProvenance?.source ?? "Resolver reference position"}{target.positionProvenance?.refEpochJulianYear != null ? ` · position epoch ${target.positionProvenance.refEpochJulianYear.toFixed(3)}` : " · position epoch unspecified"}</small>
          {target.identity && <details><summary>Name references and aliases</summary>
            <p>{target.identity.aliases.join(" · ")}</p>
            {target.identity.relatedDesignations.length > 0 && <p>Distinct related objects: {target.identity.relatedDesignations.join(" · ")}</p>}
            {target.identity.provenance.map(item => <p key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.source}</a> · snapshot {item.retrievedAtUtc.slice(0,10)} · {item.kind.replaceAll("_", " ")}</p>)}
          </details>}
        </section>}
        {!comparison && <p>Load dated images using the Time window.</p>}
        {comparison && (
          <>
            <p>{synthetic || kind === "synthetic_fixture" || kind === "fixture" ? "Synthetic comparison" :
              kind === "saved_real_example" ? "Saved real SPHEREx example" : "SPHEREx archive observations"}</p>
            <ComparisonPlayback key={comparison.id} comparison={comparison} playback={playback}
              selectedPosition={selection?.position ?? null} frameMark={frameMark} savedMarks={finding?.marks}
              onInspect={(position, frame) => inspectCutout(comparison.id, position, frame)} />
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
      </FloatingPane>
    </main>
  );
}
