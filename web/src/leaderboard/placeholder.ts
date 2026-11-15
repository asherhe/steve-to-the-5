import type { LeaderboardBoard, LeaderboardDataSource, LeaderboardEntry, RarityTier } from "./types";

// Placeholder data: no scoring system exists yet. Names, scores, tiers and dates are invented
// for layout. Positions are the five challenge targets, the saved real example field, and a few
// arbitrary, unremarkable sky positions. Only the saved real example links to evidence, so replay can be tried.
// Reasons name the planned scoring components without asserting anything about the object.

const savedRealExampleId = "c7c23ac6da7f3025e4f514f95004a979106846c62577096da1cc95a63b115f31";

type Seed = [name: string, score: number | null, tier: RarityTier | null, reasons: string[],
  ra: number, dec: number, comparisonId?: string];

const familiarity = "Catalog familiarity";
const bands = "Band distinctiveness";
const feature = "Candidate feature";

const daily: Seed[] = [
  ["Placeholder player 1", 912, "extremely_rare", [familiarity, bands, feature], 304.693508808, 42.4436872991, savedRealExampleId],
  ["Placeholder player 2", 744, "very_rare", [familiarity, bands], 133.795129, -7.245147],
  ["Placeholder player 3", 518, "rare", [bands], 76.956250, 30.401389],
  ["Placeholder player 4", 301, "uncommon", [familiarity], 248.167608, 66.754984],
  ["Placeholder player 5", 122, "common", [familiarity], 269.452077, 4.693365],
  ["Placeholder player 6", null, null, [], 331.065600, -56.790100],
];

const allTime: Seed[] = [
  ["Placeholder player 7", 988, "extremely_rare", [familiarity, bands, feature], 120.500000, -20.250000],
  ["Placeholder player 1", 912, "extremely_rare", [familiarity, bands, feature], 304.693508808, 42.4436872991, savedRealExampleId],
  ["Placeholder player 8", 861, "very_rare", [bands, feature], 15.250000, 35.500000],
  ["Placeholder player 2", 744, "very_rare", [familiarity, bands], 133.795129, -7.245147],
  ["Placeholder player 9", 690, "rare", [familiarity, feature], 210.750000, -30.500000],
  ["Placeholder player 3", 518, "rare", [bands], 76.956250, 30.401389],
  ["Placeholder player 10", 455, "rare", [familiarity], 175.400000, 5.800000],
  ["Placeholder player 4", 301, "uncommon", [familiarity], 248.167608, 66.754984],
  ["Placeholder player 11", 207, "uncommon", [bands], 60.100000, 15.300000],
  ["Placeholder player 5", 122, "common", [familiarity], 269.452077, 4.693365],
];

function build(board: LeaderboardBoard, seeds: Seed[]): LeaderboardEntry[] {
  let rank = 0;
  return seeds.map(([displayName, rarityScore, tier, reasons, ra, dec, comparisonId], index) => ({
    id: `placeholder-${board}-${index + 1}`,
    rank: rarityScore === null ? null : ++rank,
    displayName,
    rarityScore,
    tier,
    reasons,
    ra,
    dec,
    fovArcmin: comparisonId ? 1 : 6,
    comparisonId: comparisonId ?? null,
    findingId: null,
    enteredAtUtc: board === "daily" ? "2026-11-14T00:00:00Z" : `2026-${String(11 - (index % 6)).padStart(2, "0")}-01T00:00:00Z`,
  }));
}

const boards: Record<LeaderboardBoard, LeaderboardEntry[]> = {
  daily: build("daily", daily),
  allTime: build("allTime", allTime),
};

export function createPlaceholderLeaderboard(): LeaderboardDataSource {
  return {
    async list(board) {
      return { board, placeholder: true, entries: boards[board] };
    },
  };
}
