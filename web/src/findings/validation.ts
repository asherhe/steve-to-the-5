import type { EvidenceMark, FindingsViewport, SkyPosition } from './types.ts';

/** Client-side limits. The findings backend remains authoritative. */
export const LIMITS = {
  titleMaxChars: 120,
  noteMaxChars: 2000,
  replyMaxChars: 2000,
  maxMarks: 20,
  maxRadiusDeg: 180,
  minZoom: 0,
  maxZoom: 30,
  maxMarkers: 500,
} as const;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Wrap RA into [0, 360). */
export function normalizeRa(ra: number): number {
  const r = ra % 360;
  const w = r < 0 ? r + 360 : r;
  return w === 360 || Object.is(w, -0) ? 0 : w;
}

export function isValidSkyPosition(p: unknown): p is SkyPosition {
  if (!p || typeof p !== 'object') return false;
  const { ra, dec } = p as Record<string, unknown>;
  return isFiniteNumber(ra) && isFiniteNumber(dec) && ra >= 0 && ra < 360 && dec >= -90 && dec <= 90;
}

/** Count user-perceived characters roughly (code points, not UTF-16 units). */
export function charCount(s: string): number {
  return Array.from(s).length;
}

/** Normalize and bound a map viewport, or null if it is not a valid sky query. */
export function clampViewport(v: FindingsViewport): FindingsViewport | null {
  if (![v.ra, v.dec, v.radiusDeg, v.zoom].every(isFiniteNumber)) return null;
  if (v.dec < -90 || v.dec > 90 || v.radiusDeg <= 0) return null;
  return {
    ra: normalizeRa(v.ra),
    dec: v.dec,
    radiusDeg: Math.min(v.radiusDeg, LIMITS.maxRadiusDeg),
    // Backend accepts integer zoom only; Aladin zoom can be fractional.
    zoom: Math.min(LIMITS.maxZoom, Math.max(LIMITS.minZoom, Math.round(v.zoom))),
  };
}

export type FindingFieldErrors = Partial<Record<'comparison' | 'position' | 'title' | 'note' | 'marks', string>>;

export function validateFindingDraft(input: {
  comparisonId: string | null;
  selection: SkyPosition | null;
  title: string;
  note: string;
  marks: readonly EvidenceMark[];
  frameIds?: readonly string[];
}): FindingFieldErrors {
  const errors: FindingFieldErrors = {};
  if (!input.comparisonId) errors.comparison = 'Load a comparison before posting a finding.';
  if (!input.selection) errors.position = 'Select a point on the map first.';
  else if (!isValidSkyPosition(input.selection)) errors.position = 'The selected position is not a valid sky coordinate.';
  const title = input.title.trim();
  if (!title) errors.title = 'Add a short title.';
  else if (charCount(title) > LIMITS.titleMaxChars) errors.title = `Title is limited to ${LIMITS.titleMaxChars} characters.`;
  const note = input.note.trim();
  if (!note) errors.note = 'Describe what you saw or what you want checked.';
  else if (charCount(note) > LIMITS.noteMaxChars) errors.note = `Note is limited to ${LIMITS.noteMaxChars} characters.`;
  if (input.marks.length > LIMITS.maxMarks) errors.marks = `At most ${LIMITS.maxMarks} marks per finding.`;
  else if (input.marks.some((m) => !m.frameId || !isValidSkyPosition(m))) errors.marks = 'A mark has an invalid frame or position.';
  else if (input.frameIds && input.marks.some((m) => !input.frameIds!.includes(m.frameId)))
    errors.marks = 'A mark refers to a frame that is not in this comparison.';
  return errors;
}

export function hasErrors(e: object): boolean {
  return Object.keys(e).length > 0;
}

export function validateReplyText(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Write a reply first.';
  if (charCount(t) > LIMITS.replyMaxChars) return `Replies are limited to ${LIMITS.replyMaxChars} characters.`;
  return null;
}
