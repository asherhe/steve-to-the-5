import { useEffect, useState } from "react";
import type { BuildProgress } from "./comparison";

/** What each build stage is doing, and how to count it. */
const stages: Record<string, { step: number; label: string; unit: string }> = {
  discovery: { step: 1, label: "Searching the archive for exposures", unit: "mission phases answered" },
  retrieval: { step: 2, label: "Downloading exposures", unit: "downloaded" },
  combination: { step: 3, label: "Combining each visit into a frame", unit: "visits" },
  publication: { step: 3, label: "Saving the frames", unit: "" },
};

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Progress of a comparison build. With reports from the service the bar is measured;
 * without them it only shows that work is under way and for how long.
 */
export function BuildProgressBar({ startedAt, progress, waitingLabel }: {
  /** `Date.now()` when the request was sent. */
  startedAt: number;
  progress?: BuildProgress;
  /** Shown while no measured progress is available. */
  waitingLabel: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = clock(Math.max(0, Math.round((now - startedAt) / 1000)));
  const stage = progress ? stages[progress.stage] : undefined;
  const percent = progress ? Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100) : null;
  const label = progress && stage
    ? `Step ${stage.step} of 3 · ${stage.label}${stage.unit && progress.total > 1 ? ` · ${progress.done} of ${progress.total} ${stage.unit}` : ""}`
    : waitingLabel;
  // The archive search reports only when a whole query answers, so the bar can sit still.
  const waiting = percent === null || progress?.stage === "discovery";
  // Some WISE metadata searches take 30–80 s; report the delay without promising a completion time.
  const slowSearch = progress?.stage === "discovery" && now - startedAt > 90_000;

  return (
    <div className="build-progress">
      <div className="build-progress-track" role="progressbar" aria-label="Comparison build progress"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? label : `${percent}%, ${label}`} data-waiting={waiting || undefined}>
        <span className="build-progress-fill" style={percent === null ? undefined : { width: `${Math.max(percent, 2)}%` }} />
      </div>
      <p className="build-progress-label">
        <span>{label}</span>
        <span>{percent !== null && `${percent}% · `}{elapsed} elapsed</span>
      </p>
      {slowSearch && (
        <p className="build-progress-label">
          <span>IRSA's exposure search is slow or not answering right now. You can cancel and retry; finished downloads are retained. Previously built fields can replay without an archive search.</span>
        </p>
      )}
    </div>
  );
}
