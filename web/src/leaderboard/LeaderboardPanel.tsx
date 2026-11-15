import { useEffect, useState } from "react";
import type { LeaderboardBoard, LeaderboardDataSource, LeaderboardEntry, LeaderboardResult, RarityTier } from "./types";
import "./leaderboard.css";

const tierLabels: Record<RarityTier, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  very_rare: "Very rare",
  extremely_rare: "Extremely rare",
};

const boardLabels: Record<LeaderboardBoard, string> = { daily: "Today", allTime: "All time" };

export interface LeaderboardPanelProps {
  dataSource: LeaderboardDataSource;
  /** Data loads only while the panel is open. */
  open: boolean;
  onGoTo: (entry: LeaderboardEntry) => void;
  onShowEvidence: (entry: LeaderboardEntry) => void;
}

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; result: LeaderboardResult };

export function LeaderboardPanel({ dataSource, open, onGoTo, onShowEvidence }: LeaderboardPanelProps) {
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
  }, [dataSource, board, open, attempt]);

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
        <p className="leaderboard-notice">Placeholder data. Scoring isn’t built yet, so names, scores and tiers are invented.</p>
      )}
      <p className="leaderboard-caption">
        Ranked by a game rarity signal. Entries are candidates worth a closer look, not discoveries.
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
                    <span className="leaderboard-score">{entry.rarityScore ?? "—"}</span>
                  </span>
                  <span className="leaderboard-line leaderboard-meta">
                    <span className="leaderboard-tier">{entry.tier ? `${tierLabels[entry.tier]} candidate` : "Not enough data to score"}</span>
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
                }}>Show evidence</button>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
