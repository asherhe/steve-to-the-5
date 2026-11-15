import { useEffect, useState } from "react";
import type { LeaderboardBoard, LeaderboardDataSource, LeaderboardEntry, LeaderboardResult } from "./types";
import "./leaderboard.css";

const boardLabels: Record<LeaderboardBoard, string> = { daily: "Today", allTime: "All time" };

export interface LeaderboardPanelProps {
  dataSource: LeaderboardDataSource;
  /** Data loads only while the panel is open. */
  open: boolean;
  onGoTo: (entry: LeaderboardEntry) => void;
  onShowEvidence: (entry: LeaderboardEntry) => void;
  refresh?: number;
  selectedFindingId?: string | null;
}

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; result: LeaderboardResult };

export function LeaderboardPanel({ dataSource, open, onGoTo, onShowEvidence, refresh = 0, selectedFindingId }: LeaderboardPanelProps) {
  const [board, setBoard] = useState<LeaderboardBoard>("daily");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    dataSource.list(board, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setState({ kind: "ready", result }); },
      () => { if (!controller.signal.aborted) setState({ kind: "error" }); },
    );
    return () => controller.abort();
  }, [dataSource, board, open, attempt, refresh]);

  useEffect(() => { if (selectedFindingId) setSelectedId(selectedFindingId); }, [selectedFindingId]);

  return (
    <div className="leaderboard">
      <div className="leaderboard-tabs" role="group" aria-label="Leaderboard period">
        {(Object.keys(boardLabels) as LeaderboardBoard[]).map((id) => (
          <button key={id} type="button" aria-pressed={board === id} onClick={() => setBoard(id)}>
            {boardLabels[id]}
          </button>
        ))}
      </div>

      {state.kind === "ready" && state.result.placeholder && (
        <p className="leaderboard-notice">Development fixture data. These entries are invented and do not appear on the public board.</p>
      )}
      <p className="leaderboard-caption">
        Ranked by points: 10 for a known object, 20 for a point no catalog lists that is bright in two surveys. Points are not a discovery. Today uses UTC. Each entry links to saved images and a public discussion.
      </p>

      {state.kind === "loading" && <p role="status">Loading leaderboard…</p>}
      {state.kind === "error" && (
        <p role="status">
          Leaderboard unavailable.{" "}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </p>
      )}
      {state.kind === "ready" && state.result.entries.length === 0 && <p role="status">No entries yet.</p>}
      {state.kind === "ready" && state.result.entries.length > 0 && (
        <ol className="leaderboard-list">
          {state.result.entries.map((entry) => (
            <li key={entry.id} className="leaderboard-entry" data-tier={entry.tier ?? "unscored"}
              aria-current={selectedId === entry.id ? "true" : undefined}>
              <button type="button" className="leaderboard-goto"
                aria-label={`${entry.rank ? `Rank ${entry.rank}, ` : "Unscored, "}${entry.displayName}. Go to RA ${entry.ra.toFixed(4)}°, Dec ${entry.dec.toFixed(4)}°`}
                onClick={() => { setSelectedId(entry.id); onGoTo(entry); }}>
                <span className="leaderboard-rank" aria-hidden="true">{entry.rank ?? "—"}</span>
                <span className="leaderboard-body">
                  <span className="leaderboard-line">
                    <span className="leaderboard-name">{entry.displayName}</span>
                    <span className="leaderboard-score">{entry.rarityScore === null ? "Unscored" : `${entry.rarityScore} points`}</span>
                  </span>
                  <span className="leaderboard-line leaderboard-meta">
                    <span className="leaderboard-tier">{entry.title ?? "Candidate review"}</span>
                    <span className="leaderboard-coords">{entry.ra.toFixed(2)}°, {entry.dec >= 0 ? "+" : ""}{entry.dec.toFixed(2)}°</span>
                  </span>
                  {entry.reasons.length > 0 && (
                    <span className="leaderboard-reasons">
                      {entry.reasons.map((reason) => <span key={reason}>{reason}</span>)}
                    </span>
                  )}
                </span>
              </button>
              {entry.comparisonId && (
                <button type="button" className="leaderboard-evidence" onClick={() => {
                  setSelectedId(entry.id);
                  onShowEvidence(entry);
                }}>Evidence & discussion</button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
