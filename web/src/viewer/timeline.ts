import type { ComparisonFrame } from "./comparison";
export function frameTimes(frames: readonly ComparisonFrame[]) { return frames.map(f => Date.parse(f.observedAtUtc)); }
export function timeFraction(times: readonly number[], index: number) {
  const span = times[times.length - 1] - times[0];
  return span > 0 ? (times[index] - times[0]) / span : 0.5;
}
export function nearestFrame(times: readonly number[], timestamp: number) {
  return times.reduce((best, time, i) => Math.abs(time - timestamp) < Math.abs(times[best] - timestamp) ? i : best, 0);
}
export function boundPane(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number, topInset = 8) {
  return { x: Math.max(8, Math.min(x, viewportWidth - width - 8)), y: Math.max(topInset, Math.min(y, viewportHeight - Math.min(height, viewportHeight - topInset - 8) - 8)) };
}
