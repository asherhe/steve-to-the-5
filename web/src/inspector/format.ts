// Unit-aware, null-safe value formatting for the inspector.
// Every displayed measurement carries its unit (contract requirement).

const PLACEHOLDER = "—";

export function fmtNumber(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;
  return value.toFixed(digits);
}

export function fmtWithUnit(
  value: number | null | undefined,
  unit: string,
  digits: number,
  error?: number | null
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return PLACEHOLDER;
  const base = value.toFixed(digits);
  if (error !== null && error !== undefined && Number.isFinite(error)) {
    return `${base} \u00b1 ${error.toFixed(digits)} ${unit}`;
  }
  return `${base} ${unit}`;
}

/** Degrees -> HMS for RA. */
export function fmtRaHms(raDeg: number): string {
  if (!Number.isFinite(raDeg)) return PLACEHOLDER;
  const hoursTotal = (raDeg % 360) / 15;
  const h = Math.floor(hoursTotal);
  const minTotal = (hoursTotal - h) * 60;
  const m = Math.floor(minTotal);
  const s = (minTotal - m) * 60;
  return `${pad(h)}h${pad(m)}m${s.toFixed(3).padStart(6, "0")}s`;
}

/** Degrees -> DMS for Dec. */
export function fmtDecDms(decDeg: number): string {
  if (!Number.isFinite(decDeg)) return PLACEHOLDER;
  const sign = decDeg < 0 ? "-" : "+";
  const abs = Math.abs(decDeg);
  const d = Math.floor(abs);
  const minTotal = (abs - d) * 60;
  const m = Math.floor(minTotal);
  const s = (minTotal - m) * 60;
  return `${sign}${pad(d)}\u00b0${pad(m)}\u2032${s.toFixed(2).padStart(5, "0")}\u2033`;
}

export function fmtDeg(deg: number | null | undefined): string {
  return fmtNumber(deg, 6);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
