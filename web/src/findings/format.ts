import type { SkyPosition } from './types.ts';

export function formatDeg(v: number, digits = 5): string {
  return `${v.toFixed(digits)}°`;
}

export function formatSky(p: SkyPosition): string {
  const sign = p.dec >= 0 ? '+' : '';
  return `RA ${formatDeg(p.ra)}, Dec ${sign}${formatDeg(p.dec)} (ICRS)`;
}

/** Display an ISO 8601 timestamp in UTC; falls back to the raw string if unparseable. */
export function formatUtc(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
