import type { EvidenceMark, SkyPosition } from './types.ts';
import { isValidSkyPosition } from './validation.ts';

/**
 * Drafts survive the sign-in redirect in sessionStorage (this tab only) and
 * expire after MAX_AGE_MS. They never hold credentials.
 */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type FindingDraft = {
  kind: 'finding';
  comparisonId: string;
  title: string;
  note: string;
  selection: SkyPosition | null;
  marks: EvidenceMark[];
};
export type ReplyDraft = { kind: 'reply'; findingId: string; text: string };
export type Draft = FindingDraft | ReplyDraft;
export type DraftRef = { kind: 'finding'; comparisonId: string } | { kind: 'reply'; findingId: string };

const PREFIX = 'spherex.findings.draft.v1:';
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function draftKey(ref: DraftRef): string {
  return ref.kind === 'finding' ? `${PREFIX}finding:${ref.comparisonId}` : `${PREFIX}reply:${ref.findingId}`;
}

export function defaultStorage(): DraftStorage | null {
  try {
    return (globalThis as { sessionStorage?: DraftStorage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft, storage: DraftStorage | null = defaultStorage(), now: number = Date.now()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(draftKey(draft), JSON.stringify({ savedAt: now, draft }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(ref: DraftRef, storage: DraftStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(draftKey(ref));
  } catch {
    /* storage unavailable */
  }
}

function load(ref: DraftRef, storage: DraftStorage | null, now: number): Record<string, unknown> | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(draftKey(ref));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown; draft?: unknown };
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > MAX_AGE_MS || !parsed.draft || typeof parsed.draft !== 'object') {
      clearDraft(ref, storage);
      return null;
    }
    return parsed.draft as Record<string, unknown>;
  } catch {
    clearDraft(ref, storage);
    return null;
  }
}

export function loadFindingDraft(comparisonId: string, storage: DraftStorage | null = defaultStorage(), now: number = Date.now()): FindingDraft | null {
  const d = load({ kind: 'finding', comparisonId }, storage, now);
  if (!d || d.kind !== 'finding' || d.comparisonId !== comparisonId) return null;
  const marks = Array.isArray(d.marks)
    ? (d.marks as unknown[]).filter((m): m is EvidenceMark => isValidSkyPosition(m) && typeof (m as EvidenceMark).frameId === 'string')
    : [];
  return {
    kind: 'finding',
    comparisonId,
    title: typeof d.title === 'string' ? d.title : '',
    note: typeof d.note === 'string' ? d.note : '',
    selection: isValidSkyPosition(d.selection) ? { ra: d.selection.ra, dec: d.selection.dec } : null,
    marks,
  };
}

export function loadReplyDraft(findingId: string, storage: DraftStorage | null = defaultStorage(), now: number = Date.now()): ReplyDraft | null {
  const d = load({ kind: 'reply', findingId }, storage, now);
  if (!d || d.kind !== 'reply' || d.findingId !== findingId || typeof d.text !== 'string') return null;
  return { kind: 'reply', findingId, text: d.text };
}
