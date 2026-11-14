import type { Comparison, SkyPosition } from "./comparison";

/** Viewer slot boundary; the findings owner supplies the production component. */
export interface SavedFinding {
  id: string;
  comparisonId: string;
  title: string;
  note: string;
  marks: readonly (SkyPosition & { frameId: string })[];
}
export interface EvidenceDiscussionProps {
  finding: SavedFinding;
  onShowEvidence: (finding: SavedFinding) => void;
  onCopyLink: (finding: SavedFinding) => void;
}

export class EvidenceReplayError extends Error {}

export function evidenceLink(href: string, comparisonId: string, findingId?: string): string {
  const url = new URL(href);
  url.searchParams.set("comparison", comparisonId);
  url.searchParams.delete("finding");
  if (findingId) url.searchParams.set("finding", findingId);
  return url.href;
}

export function validateFinding(finding: SavedFinding, comparison: Comparison): void {
  if (finding.comparisonId !== comparison.id) {
    throw new EvidenceReplayError("This finding belongs to a different comparison. Open its own evidence link.");
  }
  const frames = new Set(comparison.frames.map(frame => frame.id));
  if (finding.marks.some(mark => !frames.has(mark.frameId) ||
      !Number.isFinite(mark.ra) || mark.ra < 0 || mark.ra >= 360 ||
      !Number.isFinite(mark.dec) || Math.abs(mark.dec) > 90)) {
    throw new EvidenceReplayError("This finding contains invalid saved frame marks. Evidence was not opened.");
  }
}
