// Engagement layer only. An entry references saved evidence by ID; it is never evidence itself,
// and points follow the server's point-check-v2 rules, never rarity or a discovery.

export type LeaderboardBoard = "daily" | "allTime";

export type RarityTier = "common" | "uncommon" | "rare" | "very_rare" | "extremely_rare";

export interface LeaderboardEntry {
  id: string;
  survey?: "spherex" | "wise";
  title?: string;
  /** Null when the entry could not be scored (coverage gap, low quality, missing data). */
  rank: number | null;
  /** Public display name only. Emails and private identity never reach this layer. */
  displayName: string;
  rarityScore: number | null;
  tier: RarityTier | null;
  /** Scoring components that contributed, shown so the score is explainable. */
  reasons: string[];
  ra: number;
  dec: number;
  fovArcmin: number;
  /** Immutable saved comparison to replay, when one exists. */
  comparisonId: string | null;
  findingId: string | null;
  enteredAtUtc: string;
}

export interface LeaderboardResult {
  board: LeaderboardBoard;
  /** True while scoring does not exist and entries are invented for layout. */
  placeholder: boolean;
  entries: LeaderboardEntry[];
}

export interface LeaderboardDataSource {
  list(board: LeaderboardBoard, signal?: AbortSignal): Promise<LeaderboardResult>;
}
