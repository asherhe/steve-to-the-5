/** Query parameters defined by the shared contract for exact replay and thread opening. */
export const REPLAY_PARAMS = { comparison: 'comparison', finding: 'finding' } as const;

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Build a shareable link from the current page URL that carries only the
 * replay IDs and survey. Other query parameters (e.g. auth return codes) are dropped.
 */
export function buildReplayUrl(currentHref: string, ids: { comparisonId?: string | null; findingId?: string | null; survey?: 'spherex' | 'wise' }): string {
  const src = new URL(currentHref);
  const url = new URL(src.origin + src.pathname);
  const survey = ids.survey ?? (src.searchParams.get('view') === 'wise' ? 'wise' : 'spherex');
  if (survey === 'wise') url.searchParams.set('view', 'wise');
  const c = clean(ids.comparisonId);
  const f = clean(ids.findingId);
  if (c) url.searchParams.set(REPLAY_PARAMS.comparison, c);
  if (f) url.searchParams.set(REPLAY_PARAMS.finding, f);
  return url.toString();
}

export function readReplayParams(search: string): { comparisonId: string | null; findingId: string | null } {
  const p = new URLSearchParams(search);
  return { comparisonId: clean(p.get(REPLAY_PARAMS.comparison)), findingId: clean(p.get(REPLAY_PARAMS.finding)) };
}
