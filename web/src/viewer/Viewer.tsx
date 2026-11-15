import { useEffect, useRef, useState, type ComponentType } from "react";
import type { Comparison, ComparisonFrame, ComparisonResult, Field, SkyPosition, ViewerDataSource } from "./comparison";
import { CatalogApiError, predictAtObservation, type CatalogAstrometry, type SourceInspectorProps, type MarkAction, type SelectedFrameMeta } from "../inspector";
import { targetPresets } from "./coordinates";
import { FieldSearch, inFieldRange } from "./FieldSearch";
import { SkyMap } from "./SkyMap";
import { SearchBox } from "./SearchBox";
import { archiveFieldLimits, ArchiveRequestError } from "./archive";
import { FloatingPane } from "./FloatingPane";
import { TimeControls } from "./TimeControls";
import { usePlayback } from "./usePlayback";
import { ComparisonPlayback } from "./ComparisonPlayback";
import { cutoutWcs } from "./cutoutWcs";
import { EvidenceReplayError, evidenceLink, validateFinding, type SavedFinding, type EvidenceDiscussionProps } from "./evidence";
import "./styles.css";

const scenarios: Record<ComparisonResult["status"], string> = {
  ready: "Matched pair",
  single_epoch: "Single epoch",
  no_coverage: "No coverage",
  no_comparable_pair: "No comparable pair",
  upstream_unavailable: "Archive unavailable",
};

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

export function Viewer({ dataSource, Inspector, Discussion, loadFinding, Controls, savedExampleId, synthetic = false }: ViewerProps) {
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
  const [mapNotice, setMapNotice] = useState("");
  const [inspecting, setInspecting] = useState<SkyPosition | null>(null);
  const [frameSelection, setFrameSelection] = useState<{
    comparisonId: string; position: SkyPosition; frame: SelectedFrameMeta;
  } | null>(null);
  const [inspectFrame, setInspectFrame] = useState(false);
  const [catalogMark, setCatalogMark] = useState<MarkAction | null>(null);
  const [comparisonMark, setComparisonMark] = useState<{ comparisonId: string; source: CatalogAstrometry } | null>(null);
  const [preview, setPreview] = useState<Preview>({ kind: "idle" });
  const [copyStatus, setCopyStatus] = useState("");
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
    setPanels(old=>({...old,[current]:false}));
    panelButtons.current[current]?.focus();
  }

  function inspect(position: SkyPosition) {
    setInspecting(position);
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

  return (
    <main className="sky-workspace">
      <SkyMap initialCenter={initialCenter} focus={focus} onCompare={compareViewport}
        onInspect={inspect} onAdvancedSearch={() => openPanel("search")} catalogMark={catalogMark} notice={mapNotice} layoutReset={layoutReset}
        dated={comparison && playback.frame ? {comparison,frame:playback.frame,assets:playback.assets,attempt:playback.attempt,
          selected:selection?.position ?? null,marks:finding?.marks ?? [],predictedMark:frameMark} : null}
        onInspectDated={position=>{playback.pause();if(comparison && playback.frame)inspectCutout(comparison.id,position,playback.frame);}} />
      <header className="top-bar">
        <SearchBox fovArcmin={initialField.fovArcmin} onSearch={search} onResolve={resolve}
          inputRef={(input) => { if (input) panelButtons.current.search = input; }} />
        <nav className="panel-buttons" aria-label="Viewer panels">
          <button ref={timeButton} type="button" aria-expanded={timeOpen} aria-controls="time-window" onClick={()=>setTimeOpen(!timeOpen)}>Time</button>
          <button type="button" ref={button=>{if(button)panelButtons.current.gaia=button;}} aria-expanded={panels.gaia} aria-controls="gaia-panel" onClick={()=>setPanels(old=>({...old,gaia:!old.gaia}))}>Inspect</button>
          <button type="button" aria-label="Reset layout" title="Reset window positions" onClick={()=>setLayoutReset(v=>v+1)}>↺</button>
        </nav>
      </header>
      <FloatingPane id="gaia-panel" title="Source inspector" open={panels.gaia} onClose={()=>closePanel("gaia")} reset={layoutReset}>
        {inspectingCutout && <p>Selected SPHEREx frame <time dateTime={inspectingCutout.frame.observedAtUtc}>
          {inspectingCutout.frame.observedAtUtc}
        </time> · RA {inspectingCutout.position.ra.toFixed(6)}°, Dec {inspectingCutout.position.dec.toFixed(6)}°</p>}
        <Inspector skyPosition={inspectFrame ? selection?.position ?? null : inspecting}
          selectedFrame={inspectingCutout ? inspectingCutout.frame : null}
          onMark={(mark) => {
            if (inspectingCutout) setComparisonMark({ comparisonId: inspectingCutout.comparisonId, source: mark.astrometry });
            else setCatalogMark(mark);
          }} />
        {markedSourceId && (
          <p role="status">
            {inspectingCutout ? "Predicted Gaia position" : "Gaia catalog position"} for {markedSourceId}
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
      <FloatingPane id="time-window" title="Time" anchor="time" open={timeOpen} reset={layoutReset} onClose={()=>{playback.pause();setTimeOpen(false);timeButton.current?.focus();}}>

        {Controls && <details className="fixture-tools"><summary>Development fixtures</summary>
          <p>Comparison images and metadata are synthetic.</p>
          <Controls onSearch={search}
            onLoadSaved={(id,findingId)=>{setRequest({kind:"saved",id,findingId});setTimeOpen(true);}}
            onReset={()=>setRequest(null)} />
        </details>}
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
        {preview.kind === "idle" && <button type="button" onClick={()=>search(initialField)}>Load images of Barnard’s Star</button>}
        {preview.kind === "loading" && <button type="button" onClick={()=>setRequest(null)}>Cancel</button>}
        {comparison && <>
          <p className="evidence-kind">{synthetic || kind === "synthetic_fixture" ? "Synthetic comparison" : kind === "saved_real_example" ? "Saved real SPHEREx example" : "Dated SPHEREx imagery"}</p>
          <TimeControls comparison={comparison} playback={playback} onDetails={()=>openPanel("comparison")} />
        </>}
      </FloatingPane>
      <FloatingPane id="comparison-panel" title="Compare details" open={panels.comparison} reset={layoutReset} onClose={()=>closePanel("comparison")}>
        {!comparison && <p>Load dated images using the Time window.</p>}
        {comparison && (
          <>
            <p>{synthetic || kind === "synthetic_fixture" ? "Synthetic comparison" :
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
