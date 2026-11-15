/**
 * Widest map view, in degrees, from which "Compare this field" works. From a wider
 * view the centre cannot be aimed well enough to choose a field a few arcminutes across.
 */
export const compareReachDeg = 10;

/**
 * Field compared from a map view of the given width: the view itself when it fits the
 * service's limits, otherwise the widest (or narrowest) allowed field at the same centre.
 * Null when the view is wider than `compareReachDeg`.
 */
export function fieldWidthFromView(viewWidthDeg: number, limits: { min: number; max: number }): number | null {
  if (!Number.isFinite(viewWidthDeg) || viewWidthDeg <= 0 || viewWidthDeg > compareReachDeg) return null;
  return Math.min(limits.max, Math.max(limits.min, viewWidthDeg * 60));
}
