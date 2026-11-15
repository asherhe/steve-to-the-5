/**
 * Widest map view, in degrees, from which "Compare this field" works. From a wider
 * view the centre cannot be aimed well enough to choose a field a few arcminutes across.
 */
export const compareReachDeg = 10;
/** Interactive blink size; larger fields remain available in Advanced search. */
export const quickCompareArcmin = 6;

/**
 * Field compared from a map view of the given width: the view itself when it fits the
 * quick-blink limit, otherwise the central six arcminutes (or the service minimum).
 * Null when the view is wider than `compareReachDeg`.
 */
export function fieldWidthFromView(viewWidthDeg: number, limits: { min: number; max: number }): number | null {
  if (!Number.isFinite(viewWidthDeg) || viewWidthDeg <= 0 || viewWidthDeg > compareReachDeg) return null;
  return Math.min(limits.max, Math.max(limits.min, Math.min(quickCompareArcmin, viewWidthDeg * 60)));
}
