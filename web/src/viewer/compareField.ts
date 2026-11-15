/**
 * Widest map view, in degrees, from which "Compare this field" works. From a wider
 * view the centre cannot be aimed well enough to choose a field a few arcminutes across.
 */
export const compareReachDeg = 10;
/** Interactive blink size; larger fields remain available in Advanced search. */
export const quickCompareArcmin = 10;

/**
 * Widest field, in arcmin, that "Compare this field" requests, even when the service
 * allows more. Smaller fields build faster and keep the compared box tight on the target.
 */
export const compareFieldMaxArcmin = 10;

/**
 * Field compared from a map view of the given width: the view itself when it fits the
 * limits, otherwise the widest (or narrowest) allowed field at the same centre. The
 * widest is the smaller of the service's limit and `compareFieldMaxArcmin`.
 * Null when the view is wider than `compareReachDeg`.
 */
export function fieldWidthFromView(viewWidthDeg: number, limits: { min: number; max: number }): number | null {
  if (!Number.isFinite(viewWidthDeg) || viewWidthDeg <= 0 || viewWidthDeg > compareReachDeg) return null;
  const max = Math.max(limits.min, Math.min(limits.max, compareFieldMaxArcmin));
  return Math.min(max, Math.max(limits.min, viewWidthDeg * 60));
}
