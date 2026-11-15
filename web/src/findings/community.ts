import type { FindingMarker, PinMarker } from './adapter.ts';
import type { SkyPosition } from './types.ts';

export type CommunitySort = 'newest' | 'replies' | 'nearest';

export const sortLabels: Record<CommunitySort, string> = { newest: 'Newest', replies: 'Most replies', nearest: 'Nearest' };

/** Great-circle separation in arcminutes. */
export function separationArcmin(a: SkyPosition, b: SkyPosition): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.dec - a.dec) * r) / 2) ** 2 +
    Math.cos(a.dec * r) * Math.cos(b.dec * r) * Math.sin(((b.ra - a.ra) * r) / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h)))) / r) * 60;
}

/**
 * Pins in the chosen order, then clusters nearest first. The map numbers pins by this
 * order, so a list row and its pin carry the same number. Ties fall back to nearest,
 * then to the finding ID, so the order is stable between reloads.
 */
export function sortMarkers(markers: readonly FindingMarker[], sort: CommunitySort, center: SkyPosition | null): FindingMarker[] {
  const distance = (m: FindingMarker) => (center ? separationArcmin(center, m) : 0);
  const time = (m: PinMarker) => (m.createdAtUtc ? Date.parse(m.createdAtUtc) : -Infinity);
  const pins = markers.filter((m): m is PinMarker => m.kind === 'pin');
  const clusters = markers.filter((m) => m.kind === 'cluster');
  pins.sort((a, b) => {
    const primary = sort === 'newest' ? time(b) - time(a)
      : sort === 'replies' ? (b.replyCount ?? -1) - (a.replyCount ?? -1)
        : 0;
    return primary || distance(a) - distance(b) || a.findingId.localeCompare(b.findingId);
  });
  clusters.sort((a, b) => distance(a) - distance(b));
  return [...pins, ...clusters];
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the UTC date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const minutes = Math.round((now - t) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

export function formatSeparation(arcmin: number): string {
  if (arcmin * 60 < 2) return 'at map centre';
  if (arcmin < 1) return `${Math.round(arcmin * 60)}″ from centre`;
  if (arcmin < 60) return `${arcmin.toFixed(arcmin < 10 ? 1 : 0)}′ from centre`;
  return `${(arcmin / 60).toFixed(1)}° from centre`;
}

/** Second line of a list row; missing fields are left out rather than guessed. */
export function pinMeta(pin: PinMarker, center: SkyPosition | null, now = Date.now()): string[] {
  const parts: string[] = [];
  if (pin.author) parts.push(pin.author);
  if (pin.createdAtUtc) parts.push(relativeTime(pin.createdAtUtc, now));
  if (pin.replyCount !== undefined) parts.push(pin.replyCount === 1 ? '1 reply' : `${pin.replyCount} replies`);
  if (pin.survey) parts.push(pin.survey === 'wise' ? 'WISE' : 'SPHEREx');
  if (center) parts.push(formatSeparation(separationArcmin(center, pin)));
  return parts;
}
