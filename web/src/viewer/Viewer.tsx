import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import type {
  Comparison,
  ComparisonFrame,
  ComparisonResult,
  Field,
  SkyPosition,
  ViewerDataSource,
} from "./comparison";
import {
  predictAtObservation,
  type CatalogAstrometry,
  type MarkAction,
  type SelectedFrameMeta,
  type ResolveResult,
} from "../inspector";
import {
  LeaderboardPanel,
  type LeaderboardDataSource,
  type LeaderboardEntry,
} from "../leaderboard";
import type { CommunityActivityProps } from "../findings/CommunityActivity";
import type { FindingsViewport } from "../findings/types";
import type { FindingMarker } from "../findings/adapter";
import type { PointSubmissionSlotProps } from "../findings/PointSubmissionPane";
import type { PointReviewInput, FrameRef } from "../findings/types";
import { targetPresets } from "./coordinates";
import { FieldSearch, inFieldRange } from "./FieldSearch";
import { compareReachDeg, fieldWidthFromView } from "./compareField";
import { SkyMap } from "./SkyMap";
import { SearchBox } from "./SearchBox";
import { archiveFieldLimits, wiseFieldLimits, type WiseBand } from "./archive";
import { FloatingPane } from "./FloatingPane";
import { NeossatPanel, useNeossat } from "./NeossatPanel";
import { TimeControls } from "./TimeControls";
import { usePlayback } from "./usePlayback";
import { ComparisonPlayback } from "./ComparisonPlayback";
import { cutoutWcs } from "./cutoutWcs";
import { SpectralRuler, bandColors } from "./SpectralRuler";
import {
  bandForWavelength,
  defaultMapSlice,
  spherexMosaicGuideTimeUtc,
} from "./spherexSurvey";
import {
  evidenceLink,
  type SavedFinding,
  type EvidenceDiscussionProps,
} from "./evidence";
import { useComparisonLoader, type Request } from "./useComparisonLoader";
import { WiseDock } from "./WiseDock";
import type { TileWatch } from "./tileWatch";
import { BuildProgressBar } from "./BuildProgress";
import { wiseBandName, type SkyView } from "./wiseSurvey";
import { InfoTip } from "./InfoTip";
import { Tutorial, useTutorial } from "./Tutorial";
import { PointCheck, type CheckPoint, type MarkedPoint } from "./PointCheck";
import type { CatalogSource } from "./catalogCheckSummary";
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

/** Wording that differs between the two survey views. */
const surveys = {
  spherex: {
    name: "SPHEREx", limits: archiveFieldLimits, panel: "Comparison", panelHeading: "Comparison",
    ready: "Matched pair", noCoverage: "No SPHEREx coverage",
    observations: "SPHEREx archive observations",
  },
  wise: {
    name: "WISE", limits: wiseFieldLimits, panel: "Time-lapse", panelHeading: "WISE time-lapse",
    ready: "Time-lapse", noCoverage: "No WISE coverage",
    observations: "WISE/NEOWISE single exposures from IRSA, combined per visit",
  },
} as const;

function viewFromUrl(): SkyView {
  return new URLSearchParams(location.search).get("view") === "wise" ? "wise" : "spherex";
}

function requestFromUrl(): Request | null {
  const params = new URLSearchParams(location.search);
  const id = params.get("comparison") ?? "";
  const findingId = params.get("finding") ?? undefined;
  return id || findingId ? { kind: "saved", id, findingId } : null;
}

/** Minimal selection carried through email sign-in; scores and identities never come from the URL. */
function pointReviewFromUrl(): PointReviewInput | null {
  const params = new URLSearchParams(location.search);
  if (!params.has("reviewRa") || !params.has("reviewDec")) return null;
  const ra = Number(params.get("reviewRa")), dec = Number(params.get("reviewDec"));
  const radiusArcsec = Number(params.get("reviewRadius") ?? 30);
  if (!Number.isFinite(ra) || ra < 0 || ra >= 360 || !Number.isFinite(dec) || Math.abs(dec) > 90 || !Number.isFinite(radiusArcsec) || radiusArcsec < 5 || radiusArcsec > 300) return null;
  const comparisonId = params.get("comparison"), frameId = params.get("reviewFrame");
  const frame: FrameRef | null = comparisonId && frameId ? { comparisonId, frameId, survey: params.get("view") === "wise" ? "wise" : "spherex" } : null;
  return { ra, dec, radiusArcsec, ...(frame ? { frame } : {}) };
}

/** Publishes an element's height as a CSS variable on the workspace, so panels can avoid it. */
function useHeightVariable(
  workspace: RefObject<HTMLElement | null>,
  selector: string,
  variable: string,
) {
  useEffect(() => {
    const host = workspace.current;
    const element = host?.querySelector(selector);
    if (!host || !element) return;
    const observer = new ResizeObserver(() => {
      host.style.setProperty(
        variable,
        `${element.getBoundingClientRect().height}px`,
      );
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
export interface ViewerControlsProps {
  onSearch: (field: Field) => void;
  onLoadSaved: (id: string, findingId?: string) => void;
  onReset: () => void;
}
export interface ViewerProps {
  dataSource: ViewerDataSource;
  Discussion?: ComponentType<EvidenceDiscussionProps>;
  Review?: ComponentType<PointSubmissionSlotProps>;
  /** Checks a double-clicked map point against the catalog chain. Marking is off without it. */
  checkPoint?: CheckPoint;
  Activity?: ComponentType<CommunityActivityProps>;
  Account?: ComponentType<{ mode: "button" | "pane" }>;
  loadFinding?: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<SavedFinding | null>;
  Controls?: ComponentType<ViewerControlsProps>;
  /**
   * Dated WISE/NEOWISE frames for one band. The SPHEREx/WISE switch is hidden without it.
   * Pass a stable function; its results use their own saved-comparison IDs.
   */
  wiseDataSource?: (band: WiseBand) => Pick<ViewerDataSource, "search" | "loadSaved">;
  /** Optional engagement layer; the leaderboard button is hidden without it. */
  leaderboard?: LeaderboardDataSource;
  savedExampleId: string;
  synthetic?: boolean;
}

type Panel = "search" | "comparison";

const narrowScreen = "(max-width: 42rem)";

export function Viewer({
  dataSource,
  wiseDataSource,
  Discussion,
  Review,
  checkPoint,
  Account,
  Activity,
  loadFinding,
  Controls,
  leaderboard,
  savedExampleId,
  synthetic = false,
}: ViewerProps) {
  // A link's `view` parameter says which survey its comparison ID belongs to.
  const [skyView, setSkyView] = useState<SkyView>(() => wiseDataSource ? viewFromUrl() : "spherex");
  const [wiseBand, setWiseBand] = useState<WiseBand>(2);
  const wiseSource = useMemo(() => wiseDataSource?.(wiseBand) ?? null, [wiseDataSource, wiseBand]);
  const [focus, setFocus] = useState<Field | null>(null);
  const [crossReferencePosition, setCrossReferencePosition] = useState<SkyPosition | null>(null);
  const [neossatOpen, setNeossatOpen] = useState(false);
  const neossatButton = useRef<HTMLButtonElement>(null);
  const neossat = useNeossat();
  function focusField(field: Field) {
    setFocus(field);
    setCrossReferencePosition({ ra: field.ra, dec: field.dec });
  }
  // Each view keeps its own request and result, so switching back shows what was there.
  const loaders = {
    spherex: useComparisonLoader({
      source: dataSource, survey: "spherex", resolveName: dataSource.resolveName, loadFinding, onFocus: focusField,
      initial: skyView === "spherex" ? requestFromUrl() : null,
    }),
    wise: useComparisonLoader({
      source: wiseSource, survey: "wise", resolveName: dataSource.resolveName, loadFinding, onFocus: focusField,
      initial: skyView === "wise" ? requestFromUrl() : null,
    }),
  };
  const { request, setRequest, preview } = loaders[skyView];
  const other = loaders[skyView === "wise" ? "spherex" : "wise"].preview;
  const survey = surveys[skyView];
  // While a build runs, its field stays outlined on the sky wherever the map is moved.
  const pinnedField = preview.kind === "loading" && request?.kind === "field" ? request.field : null;
  const fieldLimits = survey.limits;

  const [panels, setPanels] = useState<Record<Panel, boolean>>({
    search: false,
    comparison: new URLSearchParams(location.search).has("finding"),
  });
  const [timeOpen, setTimeOpen] = useState(
    () =>
      new URLSearchParams(location.search).has("comparison") ||
      new URLSearchParams(location.search).has("finding"),
  );
  const [communityOpen, setCommunityOpen] = useState(false);
  const [viewport, setViewport] = useState<FindingsViewport | null>(null);
  const [communityMarkers, setCommunityMarkers] = useState<FindingMarker[]>([]);
  // Hovering a finding in the list or on the map highlights it in both.
  const [highlightedMarker, setHighlightedMarker] = useState<string | null>(null);
  // Point double-clicked on the map, with the dated frame it was marked on (for its time).
  const [markedPoint, setMarkedPoint] = useState<(MarkedPoint & { comparisonId?: string; frameId?: string; survey: SkyView }) | null>(null);
  // Search radius chosen in the check pane; a submission scores the same cone.
  const [checkRadius, setCheckRadius] = useState(30);
  const [reviewOpen, setReviewOpen] = useState(() => !!pointReviewFromUrl());
  const [reviewTarget, setReviewTarget] = useState<PointReviewInput | null>(pointReviewFromUrl);
  const [shownCheckSource, setShownCheckSource] = useState<CatalogSource | null>(null);
  const [comparisonLarge, setComparisonLarge] = useState(false);
  const [leaderboardRefresh, setLeaderboardRefresh] = useState(0);
  const [discussionOpen, setDiscussionOpen] = useState(true);
  const [layoutReset, setLayoutReset] = useState(0);
  function openPanel(panel: Panel) {
    setPanels((old) => ({ ...old, [panel]: true }));
  }
  const timeButton = useRef<HTMLButtonElement>(null);
  const panelButtons = useRef<Partial<Record<Panel, HTMLElement>>>({});
  // The leaderboard is its own window so it can stay open beside the other panes.
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const leaderboardButton = useRef<HTMLButtonElement>(null);
  const [mapNotice, setMapNotice] = useState("");
  const [frameSelection, setFrameSelection] = useState<{
    comparisonId: string;
    survey: SkyView;
    position: SkyPosition;
    frame: SelectedFrameMeta;
  } | null>(null);
  const [inspectFrame, setInspectFrame] = useState(false);
  const [catalogMark, setCatalogMark] = useState<MarkAction | null>(null);
  const [comparisonMark, setComparisonMark] = useState<{
    comparisonId: string;
    source: CatalogAstrometry;
    displayName?: string;
  } | null>(null);
  const [resolvedTarget, setResolvedTarget] = useState<{ request: Request; result: ResolveResult } | null>(null);
  const target = resolvedTarget?.request === request ? resolvedTarget.result : null;
  const targetLabel = target?.identity?.commonName || target?.identity?.displayName || target?.name;
  const [copyStatus, setCopyStatus] = useState("");
  const [mapSlice, setMapSlice] = useState(defaultMapSlice);
  const [mapState, setMapState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const workspace = useRef<HTMLElement>(null);
  // The map's tile watcher, which the wavelength scan uses to load wavelengths ahead.
  const tiles = useRef<TileWatch | null>(null);
  useHeightVariable(workspace, ".instrument-bar", "--header-height");
  useHeightVariable(workspace, ".sky-dock", "--dock-height");
  const tutorial = useTutorial();

  useEffect(() => {
    for (const view of ["spherex", "wise"] as const) {
      const value = loaders[view].preview;
      if (value.kind !== "redirect" || (value.survey === "wise" && !wiseSource)) continue;
      loaders[view].setRequest(null);
      loaders[value.survey].setRequest(value.request);
      setSkyView(value.survey);
      const url = new URL(location.href);
      if (value.survey === "wise") url.searchParams.set("view", "wise");
      else url.searchParams.delete("view");
      history.replaceState(history.state, "", url);
    }
  }, [loaders.spherex.preview, loaders.wise.preview, wiseSource]);

  useEffect(() => {
    function restore() {
      const view = wiseDataSource ? viewFromUrl() : "spherex";
      const saved = requestFromUrl();
      setSkyView(view);
      setFrameSelection(null); setInspectFrame(false);
      loaders[view].setRequest(saved);
      setTimeOpen(!!saved);
      setDiscussionOpen(true);
      setReviewTarget(pointReviewFromUrl());
      setReviewOpen(!!pointReviewFromUrl());
      setPanels((old) => ({ ...old, comparison: new URLSearchParams(location.search).has("finding") }));
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
    // The loaders' setters are stable state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiseDataSource]);

  useEffect(() => {
    setCopyStatus("");
  }, [request, skyView]);

  // Resolve a requested name to its catalog identity so the target panel can describe it.
  // The loaders only report the field; this keeps the full resolve result for the panels.
  useEffect(() => {
    if (!request || request.kind !== "name") {
      setResolvedTarget(null);
      return;
    }
    const current = request;
    const controller = new AbortController();
    void dataSource.resolveName(current.name, controller.signal).then((result) => {
      if (!controller.signal.aborted && result) setResolvedTarget({ request: current, result });
    }).catch(() => {});
    return () => controller.abort();
  }, [dataSource, request]);

  /** Swaps the survey. The map keeps its centre and zoom; each view keeps its own result. */
  function switchView(next: SkyView) {
    if (next === skyView) return;
    setFrameSelection(null); setInspectFrame(false); setReviewOpen(false);
    setSkyView(next);
    setMapNotice("");
    // A comparison ID in the address belongs to the view it was opened in.
    const url = new URL(location.href);
    if (next === "wise") url.searchParams.set("view", "wise");
    else url.searchParams.delete("view");
    url.searchParams.delete("comparison");
    url.searchParams.delete("finding");
    for (const key of ["reviewFrame", "reviewRa", "reviewDec"]) url.searchParams.delete(key);
    history.replaceState(history.state, "", url);
  }

  function closePanel(current: Panel) {
    setPanels((old) => ({ ...old, [current]: false }));
    panelButtons.current[current]?.focus();
  }

  function closeLeaderboard() {
    setLeaderboardOpen(false);
    leaderboardButton.current?.focus();
  }

  function activateFindingMarker(marker: FindingMarker) {
    if (marker.kind === "cluster") {
      setFocus({ ra: marker.ra, dec: marker.dec, fovArcmin: 360 / 2 ** (marker.zoomTo + 1) * 60 });
    } else {
      setCommunityOpen(false);
      openFinding("", marker.findingId, skyView);
    }
  }

  function goToEntry(entry: LeaderboardEntry) {
    setMapNotice("");
    focusField({ ra: entry.ra, dec: entry.dec, fovArcmin: entry.fovArcmin ?? 6 });
  }

  function openFinding(comparisonId: string | null | undefined, findingId: string | undefined, view: SkyView) {
    if (view === "wise" && !wiseSource && comparisonId) { setMapNotice("The WISE evidence service is not connected."); return; }
    setFrameSelection(null); setInspectFrame(false); setReviewOpen(false);
    setSkyView(view);
    loaders[view].setRequest({ kind: "saved", id: comparisonId ?? "", findingId });
    setTimeOpen(true); setDiscussionOpen(true);
    openPanel("comparison");
    const url = new URL(evidenceLink(location.href, comparisonId, findingId));
    if (view === "wise") url.searchParams.set("view", "wise");
    else url.searchParams.delete("view");
    history.replaceState(history.state, "", url);
  }

  function showEntryEvidence(entry: LeaderboardEntry) {
    if (!entry.comparisonId && !entry.findingId) return;
    goToEntry(entry);
    if (window.matchMedia(narrowScreen).matches) setLeaderboardOpen(false);
    openFinding(entry.comparisonId, entry.findingId ?? undefined, entry.survey ?? "spherex");
  }

  function markPoint(position: SkyPosition, onDatedFrame: boolean, onSpherexMosaic: boolean) {
    // The marked point is also the NEOSSat selection. Marking is a deliberate choice of
    // point, so an open NEOSSat panel loads it at once instead of waiting for Refresh.
    setReviewOpen(false); setReviewTarget(null);
    showCheckSource(null);
    setCheckRadius(30);
    setCrossReferencePosition(position);
    if (neossatOpen) void neossat.refresh(position);
    const frame = onDatedFrame && comparison ? playback.frame : null;
    // Keep the frame the point was marked on in view while its check runs.
    if (frame) playback.pause();
    setMarkedPoint({
      position,
      survey: skyView,
      onSpherexMosaic,
      comparisonId: frame ? comparison!.id : undefined,
      frameId: frame?.id,
      frame: frame
        ? { observedAtUtc: frame.observedAtUtc, label: `${survey.name} frame ${comparison!.frames.indexOf(frame) + 1} (${frame.wavelengthUm.toFixed(3)} µm)` }
        : null,
    });
  }
  function beginReview(position: SkyPosition, frame?: FrameRef | null) {
    playback.pause();
    setReviewTarget({ ...position, radiusArcsec: checkRadius, ...(frame ? { frame } : {}) });
    setReviewOpen(true);
  }
  function reviewMarkedPoint() {
    if (!markedPoint) return;
    const frame: FrameRef | null = markedPoint.comparisonId && markedPoint.frameId
      ? { comparisonId: markedPoint.comparisonId, frameId: markedPoint.frameId, survey: markedPoint.survey } : null;
    beginReview(markedPoint.position, frame);
  }

  function search(field: Field) {
    setPanels((old) => ({ ...old, search: false }));
    setMapNotice("");
    focusField(field);
    setRequest({ kind: "field", field });
    setTimeOpen(true);
  }

  function resolve(name: string, fovArcmin: number) {
    setPanels((old) => ({ ...old, search: false }));
    setMapNotice("");
    setCrossReferencePosition(null);
    setRequest({ kind: "name", name, fovArcmin });
    setTimeOpen(true);
  }

  /** Compares the field at the map centre. `view.fovArcmin` is the width of the map view. */
  function compareViewport(view: Field) {
    const fovArcmin = fieldWidthFromView(view.fovArcmin / 60, fieldLimits);
    if (fovArcmin === null) {
      setMapNotice(`Zoom in until the map is under ${compareReachDeg}° wide, then compare. The button turns amber when it is ready.`);
      return;
    }
    setMapNotice("");
    setCrossReferencePosition({ ra: view.ra, dec: view.dec });
    setRequest({ kind: "field", field: { ra: view.ra, dec: view.dec, fovArcmin } });
    setTimeOpen(true);
    openPanel("comparison");
  }

  const comparison =
    preview.kind === "search"
      ? preview.result.comparison
      : preview.kind === "saved"
        ? preview.comparison
        : null;
  useEffect(() => {
    if (preview.kind === "saved" && preview.comparison.id === savedExampleId)
      // Close enough that a pixel-scale shift between the dated frames is visible when blinking.
      setFocus({ ...preview.comparison.field });
  }, [preview, savedExampleId]);
  const playback = usePlayback(
    comparison,
    (timeOpen || panels.comparison) && preview.kind !== "loading",
  );
  const selection =
    frameSelection?.comparisonId === comparison?.id && frameSelection?.survey === skyView ? frameSelection : null;
  const markedSource =
    comparisonMark?.comparisonId === comparison?.id
      ? comparisonMark?.source
      : null;
  const frame = playback.frame;
  const prediction =
    markedSource && frame
      ? predictAtObservation(markedSource, frame.observedAtUtc)
      : null;
  const imagePoint =
    comparison && prediction
      ? cutoutWcs(comparison.grid)?.toImage(prediction)
      : null;
  const frameMark =
    comparison &&
    frame &&
    playback.assets[frame.id]?.state === "ready" &&
    imagePoint &&
    imagePoint.x >= -0.5 &&
    imagePoint.x < comparison.grid.width - 0.5 &&
    imagePoint.y >= -0.5 &&
    imagePoint.y < comparison.grid.height - 0.5
      ? prediction
      : null;
  const inspectingCutout =
    inspectFrame && selection && playback.frame
      ? {
          ...selection,
          frame: {
            frameId: playback.frame.id,
            observedAtUtc: playback.frame.observedAtUtc,
            wavelengthUm: playback.frame.wavelengthUm,
          },
        }
      : null;

  // The signed-in candidate review needs the dated frame the point was marked on.
  const markedFrame = markedPoint?.frameId && comparison && comparison.id === markedPoint.comparisonId && skyView === markedPoint.survey
    ? comparison.frames.find(f => f.id === markedPoint.frameId) ?? null : null;
  // Gaia positions in the check pane are moved to the time the map shows, as in the inspector:
  // the marked frame's time, the mosaic guide date on the SPHEREx mosaic, or none (catalog epoch).
  const checkPredictionTime = markedPoint?.frame ? markedPoint.frame.observedAtUtc
    : markedPoint?.onSpherexMosaic ? spherexMosaicGuideTimeUtc : null;
  /** Gaia retains the existing frame-time prediction; other catalogs use labeled published positions. */
  function showCheckSource(source: CatalogSource | null) {
    setShownCheckSource(source);
    if (!source?.gaia) {
      if (shownCheckSource?.gaia) { setComparisonMark(null); setCatalogMark(null); }
      return;
    }
    const gaia = source.gaia;
    if (markedFrame && comparison) {
      setComparisonMark({ comparisonId: comparison.id, source: gaia });
      return;
    }
    const at = checkPredictionTime ? gaia.predicted : null;
    setCatalogMark({ frameId: null, ra: (at ?? gaia).ra, dec: (at ?? gaia).dec, sourceId: gaia.sourceId,
      predicted: at !== null, astrometry: gaia, refEpoch: gaia.refEpoch });
  }
  function clearMarkedPoint() {
    showCheckSource(null);
    setCheckRadius(30); setMarkedPoint(null); setReviewOpen(false); setReviewTarget(null);
  }
  const restoredReview = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const frameId = params.get("reviewFrame");
    const restoreKey = JSON.stringify([skyView, comparison?.id, frameId, params.get("reviewRa"), params.get("reviewDec")]);
    if (!comparison || !frameId || restoredReview.current === restoreKey) return;
    const raText = params.get("reviewRa"), decText = params.get("reviewDec");
    const ra = Number(raText), dec = Number(decText);
    const selected = comparison.frames.find(f => f.id === frameId);
    const point = selected && raText && decText && Number.isFinite(ra) && ra >= 0 && ra < 360 && Number.isFinite(dec) && Math.abs(dec) <= 90 ? cutoutWcs(comparison.grid)?.toImage({ ra, dec }) : null;
    if (selected && point && point.x >= -0.5 && point.x < comparison.grid.width - 0.5 && point.y >= -0.5 && point.y < comparison.grid.height - 0.5) {
      playback.select(playback.frames.findIndex(f => f.id === selected.id));
      setFrameSelection({ comparisonId: comparison.id, survey: skyView, position: { ra, dec }, frame: { frameId: selected.id, observedAtUtc: selected.observedAtUtc, wavelengthUm: selected.wavelengthUm } });
      setCrossReferencePosition({ ra, dec });
      setInspectFrame(true);
      setReviewTarget({ ra, dec, radiusArcsec: pointReviewFromUrl()?.radiusArcsec ?? 30, frame: { comparisonId: comparison.id, frameId: selected.id, survey: skyView } });
      setReviewOpen(true);
    }
    restoredReview.current = restoreKey;
  }, [comparison, skyView]);

  function prepareReviewSignIn() {
    if (!reviewTarget) return;
    const url = new URL(evidenceLink(location.href, reviewTarget.frame?.comparisonId));
    if (reviewTarget.frame?.survey === "wise") url.searchParams.set("view", "wise");
    else url.searchParams.delete("view");
    if (reviewTarget.frame) url.searchParams.set("reviewFrame", reviewTarget.frame.frameId);
    url.searchParams.set("reviewRa", String(reviewTarget.ra));
    url.searchParams.set("reviewDec", String(reviewTarget.dec));
    url.searchParams.set("reviewRadius", String(reviewTarget.radiusArcsec ?? 30));
    history.replaceState(history.state, "", url);
  }

  const status =
    preview.kind === "point" ? "Submitted sky position" : preview.kind === "search"
      ? (skyView === "wise" && preview.result.status === "ready"
          ? `Time-lapse of ${preview.result.comparison.frames.length} dated visits`
          : scenarios[preview.result.status])
      : preview.kind === "saved"
        ? "Saved comparison"
        : preview.kind === "missing"
          ? "Saved comparison not found"
          : preview.kind === "name_not_found"
            ? "Object name not found. Try a preset or enter sky coordinates."
            : preview.kind === "catalog_error"
              ? "Name lookup is unavailable. Try a preset or enter sky coordinates."
              : preview.kind === "error"
                ? preview.message
                : preview.kind === "idle"
                  ? (skyView === "wise" && !wiseSource
                      ? "The WISE time-lapse service is not connected."
                      : "Choose a field to compare.")
                  : "Loading comparison…";
  const diagnostics =
    preview.kind === "search"
      ? preview.result.diagnostics
      : comparison?.diagnostics;
  const kind = comparison?.provenance?.evidenceKind;
  const fallbackAvailable =
    preview.kind === "error" ||
    (preview.kind === "search" &&
      preview.result.status === "upstream_unavailable");

  function openExample() {
    setMapNotice("Saved Barnard’s Star field: blink the two dates to see the star shift north against the fixed background stars.");
    setTimeOpen(true);
    setRequest({ kind: "saved", id: savedExampleId });
    setComparisonLarge(false);
    openPanel("comparison");
  }

  function comparisonLink(id: string | null | undefined, findingId?: string) {
    const url = new URL(evidenceLink(location.href, id, findingId));
    if (skyView === "wise") url.searchParams.set("view", "wise");
    else url.searchParams.delete("view");
    return url.href;
  }

  function showEvidence(finding: SavedFinding) {
    openFinding(finding.comparisonId, finding.id, finding.survey ?? "spherex");
  }

  async function copyLink(id: string | null | undefined, findingId?: string) {
    try {
      await navigator.clipboard.writeText(comparisonLink(id, findingId));
      setCopyStatus(
        findingId ? "Evidence link copied." : "Comparison link copied.",
      );
    } catch {
      setCopyStatus("Copying failed. Use the saved evidence link below.");
    }
  }
  const finding = preview.kind === "saved" || preview.kind === "point" ? preview.finding : undefined;
  useEffect(() => {
    if (preview.kind !== "point") return;
    setTimeOpen(false); setPanels(old => ({ ...old, comparison: false }));
    setMarkedPoint(null); setDiscussionOpen(true);
  }, [preview]);

  useEffect(() => {
    const mark = finding?.marks[0];
    if (mark) {
      const index = playback.frames.findIndex(f => f.id === mark.frameId);
      if (index >= 0) playback.select(index);
    }
  }, [finding?.id]);

  const source =
    synthetic || kind === "synthetic_fixture"
      ? "synthetic"
      : comparison?.id === savedExampleId || kind === "saved_real_example"
        ? "saved real"
        : "live archive";
  const badgeFor = (state: ComparisonResult["status"]) =>
    state === "ready" ? survey.ready : state === "no_coverage" ? survey.noCoverage : badges[state];
  const badge =
    preview.kind === "point" ? "Submitted point" : preview.kind === "search"
      ? comparison
        ? `${badgeFor(preview.result.status)} · ${source}`
        : badgeFor(preview.result.status)
      : preview.kind === "saved"
        ? `${preview.comparison.frames.length > 1 ? survey.ready : "Single epoch"} · ${source}`
        : preview.kind === "loading"
          ? "Loading"
          : preview.kind === "idle"
            ? "No field selected"
            : preview.kind === "name_not_found" || preview.kind === "missing"
              ? "Not found"
              : "Unavailable";
  const tone = comparison || preview.kind === "point"
    ? "ready"
    : preview.kind === "idle" || preview.kind === "loading"
      ? "idle"
      : "problem";
  const readoutField =
    comparison?.field ?? (preview.kind === "search" ? preview.field : focus);
  const bands = comparison && skyView === "spherex"
    ? [...new Set(comparison.wavelengthRangeUm.map(bandForWavelength))]
    : [];
  // The field the other view last compared, offered here so one target can be seen both ways.
  const otherField = other.kind === "search" ? other.field : other.kind === "saved" ? other.comparison.field : null;
  const frameShown = comparison ? playback.frame : null;

  return (
    <main className="sky-workspace" ref={workspace}>
      <SkyMap
        initialCenter={initialCenter}
        onViewport={setViewport}
        communityMarkers={communityMarkers}
        onFindingMarker={activateFindingMarker}
        highlightedMarker={highlightedMarker}
        onHighlightMarker={setHighlightedMarker}
        activeFindingId={finding?.id ?? null}
        focus={focus}
        onCompare={compareViewport}
        pointMark={markedPoint?.position ?? (preview.kind === "point" && finding?.ra != null && finding.dec != null ? { ra: finding.ra, dec: finding.dec } : null)}
        sourceMarks={shownCheckSource && !shownCheckSource.gaia ? [shownCheckSource] : []}
        onMarkPoint={checkPoint ? markPoint : undefined}
        onAdvancedSearch={() => openPanel("search")}
        catalogMark={catalogMark}
        target={target}
        notice={mapNotice}
        slice={mapSlice}
        survey={skyView}
        onSurveyChange={switchView}
        tiles={tiles}
        compareLimits={fieldLimits}
        pinnedField={pinnedField}
        onStateChange={setMapState}
        dated={
          comparison && playback.frame
            ? {
                comparison,
                survey: skyView,
                frame: playback.frame,
                assets: playback.assets,
                attempt: playback.attempt,
                selected: selection?.position ?? null,
                marks: finding?.marks ?? [],
                predictedMark: frameMark,
                // Label the source the frame mark was predicted from (set by the inspector or the check pane).
                predictedLabel: frameMark && markedSource
                  ? comparisonMark?.displayName ?? `Gaia DR3 ${markedSource.sourceId}`
                  : undefined,
              }
            : null
        }
        dock={
          skyView === "wise" ? (
            <WiseDock band={wiseBand} onSelectBand={setWiseBand} />
          ) : (
            <SpectralRuler
              mapSlice={mapSlice}
              onSelectSlice={setMapSlice}
              disabled={mapState !== "ready"}
              tiles={tiles}
              frameWavelengthUm={frameShown?.wavelengthUm ?? null}
              frameLabel={
                frameShown && comparison
                  ? `Frame ${comparison.frames.indexOf(frameShown) + 1} · ${frameShown.wavelengthUm.toFixed(4)} µm`
                  : null
              }
            />
          )
        }
      />
      <header className="instrument-bar">
        <div className="brand">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
          </svg>
          <span>{survey.name} / Field viewer</span>
        </div>
        <SearchBox
          fovArcmin={initialField.fovArcmin}
          onSearch={search}
          onResolve={resolve}
        />
        {leaderboard && (
          <nav
            className="panel-buttons bar-start"
            aria-label="Engagement panels"
          >
            <button
              type="button"
              ref={leaderboardButton}
              aria-expanded={leaderboardOpen}
              aria-controls="leaderboard-panel"
              onClick={() => setLeaderboardOpen(!leaderboardOpen)}
            >
              Leaderboard
            </button>
          </nav>
        )}
        <dl className="readouts" aria-label="Current field">
          {target && (
            <div className="target-readout">
              <dt>Requested target</dt>
              <dd>{targetLabel}</dd>
            </div>
          )}
          <div>
            <dt>RA</dt>
            <dd>{readoutField ? formatAngle(readoutField.ra) : "—"}</dd>
          </div>
          <div>
            <dt>Dec</dt>
            <dd>{readoutField ? formatAngle(readoutField.dec, true) : "—"}</dd>
          </div>
          <div>
            <dt>Width</dt>
            <dd>
              {readoutField
                ? `${readoutField.fovArcmin.toFixed(2)} arcmin`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Frames</dt>
            <dd>
              {comparison ? (
                <>
                  {bands.map(
                    (band) =>
                      band && (
                        <span
                          key={band}
                          className="band-swatch"
                          style={{ background: bandColors[band - 1] }}
                          aria-hidden="true"
                        />
                      ),
                  )}
                  {bands.some(Boolean) &&
                    `B${bands.filter(Boolean).join("–")} · `}
                  {skyView === "wise" &&
                    `${wiseBandName(comparison.frames[0].wavelengthUm)} · `}
                  {comparison.wavelengthRangeUm
                    .map((value) => value.toFixed(4))
                    .join("–")}{" "}
                  µm
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        <div className="bar-actions">
          <span className="status-badge" data-tone={tone}>
            <span className="status-dot" aria-hidden="true" />
            {badge}
          </span>
          <nav className="panel-buttons" aria-label="Viewer panels">
            <button
              ref={timeButton}
              type="button"
              aria-expanded={timeOpen}
              aria-controls="time-window"
              onClick={() => setTimeOpen(!timeOpen)}
            >
              Time
            </button>
            {(
              [
                ["search", "Advanced"],
                ["comparison", survey.panel],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                ref={(button) => {
                  if (button) panelButtons.current[id] = button;
                }}
                aria-expanded={panels[id]}
                aria-controls={`${id}-panel`}
                onClick={() => setPanels((old) => ({ ...old, [id]: !old[id] }))}
              >
                {label}
              </button>
            ))}
            <button type="button" ref={neossatButton} aria-expanded={neossatOpen} aria-controls="neossat-panel"
              onClick={() => {
                if (!neossatOpen) neossat.open(crossReferencePosition);
                setNeossatOpen(!neossatOpen);
              }}>NEOSSat</button>
            {Activity && <button type="button" aria-expanded={communityOpen} aria-controls="community-panel" onClick={() => setCommunityOpen(!communityOpen)}>Community</button>}
            {Account && <Account mode="button" />}
            <button
              type="button"
              className="tutorial-open"
              onClick={tutorial.openTutorial}
            >
              <span aria-hidden="true">?</span> How this works
            </button>
            <button
              type="button"
              aria-label="Reset layout"
              title="Reset window positions"
              onClick={() => setLayoutReset((value) => value + 1)}
            >
              ↺
            </button>
          </nav>
        </div>
      </header>
      {leaderboard && (
        <FloatingPane
          id="leaderboard-panel"
          title="Participation leaderboard"
          anchor="left"
          open={leaderboardOpen}
          reset={layoutReset}
          onClose={closeLeaderboard}
        >
          <LeaderboardPanel
            dataSource={leaderboard}
            open={leaderboardOpen}
            refresh={leaderboardRefresh}
            selectedFindingId={finding?.id}
            onGoTo={goToEntry}
            onShowEvidence={showEntryEvidence}
          />
          {leaderboardOpen && finding && Discussion && discussionOpen && <Discussion finding={finding} onShowEvidence={showEvidence} onCopyLink={value => void copyLink(value.comparisonId, value.id)} onClose={() => setDiscussionOpen(false)} />}
        </FloatingPane>
      )}
      <FloatingPane id="neossat-panel" title="NEOSSat" open={neossatOpen} size="wide" reset={layoutReset}
        onClose={() => { setNeossatOpen(false); neossatButton.current?.focus(); }}>
        <NeossatPanel position={crossReferencePosition} snapshot={neossat} />
      </FloatingPane>
      {Account && <Account mode="pane" />}
      {Activity && <FloatingPane id="community-panel" title="Community findings" anchor="left" open={communityOpen} reset={layoutReset} onClose={() => setCommunityOpen(false)}><Activity viewport={viewport} onMarkersChange={setCommunityMarkers} onActivate={activateFindingMarker} refresh={leaderboardRefresh} highlighted={highlightedMarker} onHighlight={setHighlightedMarker} activeFindingId={finding?.id ?? null} /></FloatingPane>}
      {checkPoint && (
        <FloatingPane id="point-check-panel" title="Check this point" anchor="left" open={!!markedPoint} reset={layoutReset} onClose={clearMarkedPoint}>
          {markedPoint && (
            <PointCheck
              key={`${markedPoint.position.ra}:${markedPoint.position.dec}:${markedPoint.comparisonId ?? ''}:${markedPoint.frameId ?? ''}`}
              point={markedPoint}
              check={checkPoint}
              onClear={clearMarkedPoint}
              onReview={Review ? reviewMarkedPoint : undefined}
              predictionTimeUtc={checkPredictionTime}
              shownSourceId={shownCheckSource?.key ?? null}
              onShowSource={showCheckSource}
              onRadiusChange={radius => { setCheckRadius(radius); showCheckSource(null); setReviewOpen(false); setReviewTarget(null); }}
            />
          )}
        </FloatingPane>
      )}
      {Review && <FloatingPane id="review-panel" title="Submit point" anchor="left" size="wide" open={reviewOpen} reset={layoutReset} onClose={() => setReviewOpen(false)}>
        {reviewOpen && <Review position={reviewTarget ? { ra: reviewTarget.ra, dec: reviewTarget.dec } : null} frame={reviewTarget?.frame}
          defaultRadiusArcsec={reviewTarget?.radiusArcsec ?? 30} synthetic={!!reviewTarget?.frame && synthetic}
          onPrepareSignIn={prepareReviewSignIn} onShowDuplicate={id => openFinding(null, id, skyView)} onCreated={id => {
            setReviewOpen(false); setLeaderboardRefresh(n => n + 1); setLeaderboardOpen(true);
            openFinding(null, id, skyView);
          }} />}
      </FloatingPane>}
      <FloatingPane id="point-discussion-panel" title="Point discussion" anchor="left" size="wide"
        open={preview.kind === "point" && discussionOpen && !leaderboardOpen} reset={layoutReset} onClose={() => setDiscussionOpen(false)}>
        {preview.kind === "point" && finding && Discussion && discussionOpen && !leaderboardOpen && <Discussion finding={finding}
          onShowEvidence={showEvidence} onCopyLink={value => void copyLink(value.comparisonId, value.id)} onClose={() => setDiscussionOpen(false)} />}
      </FloatingPane>

      <FloatingPane
        id="search-panel"
        title="Advanced search"
        anchor="left"
        open={panels.search}
        onClose={() => closePanel("search")}
        reset={layoutReset}
      >
        <FieldSearch
          key={skyView}
          field={focus ?? initialField}
          limits={fieldLimits}
          onSearch={search}
          onResolve={resolve}
        />
      </FloatingPane>
      <FloatingPane
        id="time-window"
        title="Time"
        anchor="time"
        badge={
          comparison
            ? synthetic || kind === "synthetic_fixture" || kind === "fixture"
              ? "Synthetic"
              : comparison?.id === savedExampleId || kind === "saved_real_example"
                ? "Saved example"
                : survey.name
            : undefined
        }
        open={timeOpen}
        reset={layoutReset}
        onClose={() => {
          playback.pause();
          setTimeOpen(false);
          timeButton.current?.focus();
        }}
      >
        {Controls && (
          <details className="fixture-tools">
            <summary>Development fixtures</summary>
            <p>Comparison images and metadata are synthetic.</p>
            <Controls
              onSearch={search}
              onLoadSaved={(id, findingId) => {
                setRequest({ kind: "saved", id, findingId });
                setTimeOpen(true);
              }}
              onReset={() => setRequest(null)}
            />
          </details>
        )}
        {target && (
          <section className="target-summary" aria-label="Requested target">
            <strong>{targetLabel}</strong>
            <small>
              Requested target · name resolved, image detection not established.
            </small>
          </section>
        )}
        {!comparison && <p role="status">{status}</p>}
        {preview.kind === "loading" && request?.kind !== "saved" && (
          <>
            <BuildProgressBar
              key={preview.startedAt}
              startedAt={preview.startedAt}
              progress={preview.progress}
              waitingLabel={
                skyView === "wise"
                  ? "Starting the time-lapse build"
                  : "Searching the SPHEREx archive"
              }
            />
            <p>
              {skyView === "wise"
                ? "Building a few dated frames spread over 14 years of WISE exposures. The first build of a field usually takes about a minute."
                : "An archive search can take a few minutes."}
            </p>
          </>
        )}
        {typeof diagnostics?.message === "string" && (
          <p>{diagnostics.message}</p>
        )}
        {comparison && diagnostics?.complete === false && (
          <p>This comparison comes from an incomplete archive search.</p>
        )}
        {fallbackAvailable && request && (
          <div className="controls">
            <button type="button" onClick={() => setRequest({ ...request })}>
              Retry
            </button>
            {request.kind !== "saved" && skyView === "spherex" && (
              <button type="button" onClick={openExample}>
                {synthetic ? "Open saved fixture" : "Open saved real example"}
              </button>
            )}
          </div>
        )}
        {!synthetic && preview.kind === "idle" && skyView === "spherex" && (
          <button type="button" onClick={openExample}>
            Open saved real example
          </button>
        )}
        {preview.kind === "idle" && skyView === "wise" && wiseSource && (
          <p>
            Dated frames come from single WISE and NEOWISE exposures, 2010 to 2024, one frame per
            visit. Pick the band in the bar under the map.
          </p>
        )}
        {preview.kind === "idle" &&
          otherField &&
          (skyView === "spherex" || wiseSource) &&
          (inFieldRange(otherField.fovArcmin, fieldLimits) ? (
            <button type="button" onClick={() => search(otherField)}>
              Compare the {surveys[skyView === "wise" ? "spherex" : "wise"].name} field in{" "}
              {survey.name}
            </button>
          ) : (
            <p>
              The {surveys[skyView === "wise" ? "spherex" : "wise"].name} field is{" "}
              {otherField.fovArcmin.toFixed(1)} arcmin wide. {survey.name} comparisons take{" "}
              {fieldLimits.min}–{fieldLimits.max} arcmin.
            </p>
          ))}
        {preview.kind === "search" && !comparison && (
          <p>
            Requested RA {preview.field.ra.toFixed(6)}°, Dec{" "}
            {preview.field.dec.toFixed(6)}°, width{" "}
            {preview.field.fovArcmin.toFixed(2)} arcmin.
          </p>
        )}
        {preview.kind === "idle" && skyView === "spherex" && (
          <button
            type="button"
            onClick={() =>
              resolve(targetPresets[0].name, initialField.fovArcmin)
            }
          >
            Load images of Barnard’s Star
          </button>
        )}
        {preview.kind === "loading" && (
          <button type="button" onClick={() => setRequest(null)}>
            Cancel
          </button>
        )}
        {comparison && (
          <>
            <TimeControls
              comparison={comparison}
              playback={playback}
              onDetails={() => openPanel("comparison")}
            />
          </>
        )}
      </FloatingPane>
      <FloatingPane
        id="comparison-panel"
        title="Compare details"
        size={comparisonLarge ? "large" : "wide"}
        open={panels.comparison}
        reset={layoutReset}
        onClose={() => closePanel("comparison")}
      >
        <button type="button" aria-pressed={comparisonLarge} onClick={() => setComparisonLarge(!comparisonLarge)}>{comparisonLarge ? "Standard image view" : "Enlarge image view"}</button>
        {target && (
          <section className="target-context" aria-label="Target details">
            <strong>{targetLabel}</strong>
            {target.identity && (
              <p>
                {target.identity.canonicalDesignation} ·{" "}
                {target.identity.component}
              </p>
            )}
            <p>
              Name resolved. Identification of an image source and visible
              target detection are not established by this lookup.
            </p>
            <small>
              {target.positionProvenance?.source ?? "Resolver reference position"}
              {target.positionProvenance?.refEpochJulianYear != null
                ? ` · position epoch ${target.positionProvenance.refEpochJulianYear.toFixed(3)}`
                : " · position epoch unspecified"}
            </small>
            {target.identity && (
              <details>
                <summary>Name references and aliases</summary>
                <p>{target.identity.aliases.join(" · ")}</p>
                {target.identity.relatedDesignations.length > 0 && (
                  <p>
                    Distinct related objects:{" "}
                    {target.identity.relatedDesignations.join(" · ")}
                  </p>
                )}
                {target.identity.provenance.map((item) => (
                  <p key={item.url}>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.source}
                    </a>{" "}
                    · snapshot {item.retrievedAtUtc.slice(0, 10)} ·{" "}
                    {item.kind.replaceAll("_", " ")}
                  </p>
                ))}
              </details>
            )}
          </section>
        )}
        <p className="pane-intro">
          Blink comparison{" "}
          <InfoTip term="Blink comparison">
            The dated images are stacked on the same grid and brightness scale, then shown one
            after another. Objects that moved or changed brightness between the dates appear to
            jump or flicker; the steady background stays put. This is how moving objects are
            spotted.
          </InfoTip>
        </p>
        {!comparison && <p>Load dated images using the Time window.</p>}
        {comparison && (
          <>
            {request?.kind === "saved" && request.id === savedExampleId && <p className="example-notice">Barnard’s Star field: 6 arcminutes across, centred on the star’s Gaia DR3 position propagated to late 2025. Both frames are at 4.29 µm, 393 days apart. The star is saturated, so its core is masked and shows as a hole; blink the dates and the whole bright patch shifts about 2 pixels (≈11″) north while the field stars stay put. That matches its known proper motion of about 10.4″ per year. This is a visual quick-look, not a measured motion.</p>}
            <p>
              {synthetic || kind === "synthetic_fixture"
                ? "Synthetic comparison"
                : kind === "saved_real_example"
                  ? "Saved real SPHEREx example"
                  : survey.observations}
            </p>
            <ComparisonPlayback
              key={comparison.id}
              comparison={comparison}
              playback={playback}
              survey={skyView}
              selectedPosition={selection?.position ?? null}
              frameMark={frameMark}
              savedMarks={finding?.marks}
            />
            {finding && Discussion && discussionOpen && !leaderboardOpen && (
              <Discussion
                finding={finding}
                onClose={() => setDiscussionOpen(false)}
                onShowEvidence={showEvidence}
                onCopyLink={(value) =>
                  void copyLink(value.comparisonId, value.id)
                }
              />
            )}
            {finding && (
              <p>
                <a href={comparisonLink(comparison.id, finding.id)}>
                  Saved evidence link
                </a>
              </p>
            )}
            <div className="controls">
              <a href={comparisonLink(comparison.id)}>Saved comparison link</a>
              <button
                type="button"
                onClick={() => void copyLink(comparison.id)}
              >
                Copy comparison link
              </button>
            </div>
            {copyStatus && <p role="status">{copyStatus}</p>}
          </>
        )}
      </FloatingPane>
      <Tutorial open={tutorial.open} onClose={tutorial.close} />
    </main>
  );
}
