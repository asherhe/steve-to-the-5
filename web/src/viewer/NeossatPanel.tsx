import { useEffect, useRef, useState } from "react";
import type { SkyPosition } from "./comparison";
import { loadNeossat, samePosition, type NeossatImage, type NeossatResult } from "./neossat";

export function useNeossat() {
  const [result, setResult] = useState<NeossatResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const attempted = useRef(false);
  useEffect(() => () => {
    const current = controller.current;
    controller.current = null;
    current?.abort();
  }, []);

  async function refresh(position: SkyPosition | null) {
    if (!position) return;
    attempted.current = true;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const timeout = setTimeout(() => current.abort(), 30_000);
    setLoading(true); setError("");
    try {
      const value = await loadNeossat(position, current.signal);
      if (controller.current === current && !current.signal.aborted) setResult(value);
    } catch (cause) {
      if (controller.current === current) setError(current.signal.aborted
        ? "The NEOSSat request timed out. Try Refresh again."
        : cause instanceof Error ? cause.message : "NEOSSat images are unavailable. Try Refresh again.");
    } finally {
      clearTimeout(timeout);
      if (controller.current === current) setLoading(false);
    }
  }

  return { result, loading, error, refresh, open(position: SkyPosition | null) {
    // Opening for the first time loads once. Selection changes and subsequent opens
    // never fetch; only the panel's Refresh button updates an existing snapshot.
    if (!attempted.current) void refresh(position);
  } };
}

function positionText(position: SkyPosition) {
  return `RA ${position.ra.toFixed(6)}°, Dec ${position.dec >= 0 ? "+" : ""}${position.dec.toFixed(6)}°`;
}

function Preview({ image }: { image: NeossatImage }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  return <figure className="neossat-image">
    <a href={image.imageUrl} target="_blank" rel="noreferrer" aria-label={`Open full NEOSSat preview ${image.observationId}`}>
      <img src={image.imageUrl} alt={`NEOSSat ${image.product} observation ${image.observationId}`} hidden={state === "error"}
        onLoad={() => setState("ready")} onError={() => setState("error")} />
    </a>
    {state === "loading" && <p role="status">Loading preview…</p>}
    {state === "error" && <p role="status">Preview unavailable. Use Refresh to try again.</p>}
    <figcaption><time dateTime={image.observedAtUtc}>{image.observedAtUtc.replace("T", " ").replace("Z", " UTC")}</time>
      <span>{image.observationId} · {image.product.toUpperCase()}</span>
    </figcaption>
  </figure>;
}

export function NeossatPanel({ position, snapshot }: { position: SkyPosition | null; snapshot: ReturnType<typeof useNeossat> }) {
  const { result, loading, error, refresh } = snapshot;
  return <div className="neossat-panel" aria-busy={loading}>
    <p className="pane-intro">NEOSSat optical reference images from CADC. Images stay fixed until you press Refresh.</p>
    <div className="neossat-actions">
      <p className="neossat-selection">{position ? `Selected: ${positionText(position)}` : "Select a point on the map or search for a field first."}</p>
      <button type="button" className="primary" disabled={!position || loading} onClick={() => void refresh(position)}>{loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    {loading && <p role="status">Querying NEOSSat observations covering the selected position…</p>}
    {error && <p role="alert">{error}{result && " Previous results are retained below."}</p>}
    {result && <>
      <p className="neossat-loaded">Loaded: {positionText(result.position)}<br />
        Retrieved <time dateTime={result.retrievedAtUtc}>{result.retrievedAtUtc.replace("T", " ").replace("Z", " UTC")}</time>
      </p>
      {!samePosition(position, result.position) && <p className="example-notice">The selection has changed. Press Refresh to load images for the selected position.</p>}
      {result.images.length === 0 ? <p role="status">No public NEOSSat previews were returned for this position. This does not rule out observations without published previews.</p>
        : <><p>{result.images.length} observation{result.images.length === 1 ? "" : "s"} · newest first{result.truncated ? " · showing a limited selection" : ""}</p>
          <div className="neossat-images">{result.images.map(image => <Preview key={`${result.retrievedAtUtc}:${image.observationId}`} image={image} />)}</div></>}
    </>}
    <p className="neossat-note">Full-frame archive previews; the selected point is within the image footprint. Preview orientation, processing and brightness scales may differ. These optical images are separate from SPHEREx/WISE playback.</p>
    <p className="neossat-note"><a href="https://www.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/en/neossat/" target="_blank" rel="noreferrer">NEOSSat archive and product information</a>. NEOSSat is a joint mission of CSA and DRDC, with contributions from MSCI, the University of Calgary, Bishop’s University and NRC.</p>
  </div>;
}
