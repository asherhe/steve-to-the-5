import type { SkyPosition } from "./comparison";

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const separated = /^([+-]?\d+)(?::|\s+)(\d+)(?::|\s+)(\d+(?:\.\d+)?)$/;
const raUnits = /^([+]?\d+)h\s*(\d+)m\s*(\d+(?:\.\d+)?)s$/i;
const decUnits = /^([+-]?\d+)[°d]\s*(\d+)['′m]\s*(\d+(?:\.\d+)?)["″s]$/i;

export function parseAngle(input: string, axis: "ra" | "dec"): number | null {
  const value = input.trim().replace("−", "-");
  let degrees: number;

  if (decimal.test(value)) {
    degrees = Number(value);
  } else {
    const parts = value.match(separated) ?? value.match(axis === "ra" ? raUnits : decUnits);
    if (!parts) return null;
    const [, leading, minutes, seconds] = parts;
    if (Number(minutes) >= 60 || Number(seconds) >= 60) return null;
    if (axis === "ra" && leading.startsWith("-")) return null;

    const magnitude = Math.abs(Number(leading)) + Number(minutes) / 60 + Number(seconds) / 3600;
    degrees = axis === "ra" ? magnitude * 15 : leading.startsWith("-") ? -magnitude : magnitude;
  }

  const valid = axis === "ra" ? degrees >= 0 && degrees < 360 : degrees >= -90 && degrees <= 90;
  return valid ? degrees : null;
}

const targetCoordinates = [
  // SIMBAD ICRS J2000.0 coordinates for Barnard's Star.
  ["Barnard’s Star", "17:57:48.49847", "+04:41:36.11388"],
  // SIMPLE archive, Epsilon Indi B system.
  ["Epsilon Indi B", "331.0656", "-56.7901"],
  // Coordinates supplied in the challenge brief.
  ["WISE 0855", "08:55:10.831", "-07:14:42.53"],
  // Chandra Cycle 21 target list.
  ["RW Aurigae", "05:07:49.5", "+30:24:05.0"],
  // AAVSO Bulletin coordinates.
  ["R Draconis", "16:32:40.2258", "+66:45:17.943"],
] as const;

export const targetPresets = targetCoordinates.map(([name, rightAscension, declination]): SkyPosition & { name: string } => {
  const ra = parseAngle(rightAscension, "ra");
  const dec = parseAngle(declination, "dec");
  if (ra === null || dec === null) throw new Error(`Invalid preset coordinates for ${name}`);
  return { name, ra, dec };
});

const plainNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Splits free text into RA and Dec parts. Accepts "RA, Dec", "RA Dec" or six
 * space-separated sexagesimal fields ("17 57 48.5 +04 41 36").
 */
function splitPosition(input: string): [string, string] | null {
  const value = input.trim().replace(/−/g, "-");
  if (value.includes(",")) {
    const parts = value.split(",").map((part) => part.trim());
    return parts.length === 2 && parts.every(Boolean) ? [parts[0], parts[1]] : null;
  }
  const tokens = value.split(/\s+/);
  if (tokens.length === 2) return [tokens[0], tokens[1]];
  if (tokens.length === 6) return [tokens.slice(0, 3).join(" "), tokens.slice(3).join(" ")];
  return null;
}

/** Parses an ICRS position typed as one string. Returns null when it is not a valid position. */
export function parseSkyPosition(input: string): SkyPosition | null {
  const parts = splitPosition(input);
  if (!parts) return null;
  const ra = parseAngle(parts[0], "ra");
  const dec = parseAngle(parts[1], "dec");
  return ra === null || dec === null ? null : { ra, dec };
}

/** True for two plain decimal numbers, which can only mean a (possibly out-of-range) position. */
export function isDecimalPair(input: string): boolean {
  const parts = splitPosition(input);
  return parts !== null && parts.every((part) => plainNumber.test(part));
}

export function normalizeRa(ra: number) {
  return ((ra % 360) + 360) % 360;
}

function sexagesimal(value: number, decimals: number): [number, number, string] {
  const scale = 10 ** decimals;
  let total = Math.round(value * 3600 * scale);
  const whole = Math.floor(total / (3600 * scale));
  total -= whole * 3600 * scale;
  const minutes = Math.floor(total / (60 * scale));
  const seconds = (total - minutes * 60 * scale) / scale;
  return [whole, minutes, seconds.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, "0")];
}

const pad = (value: number) => String(value).padStart(2, "0");

export function formatRa(ra: number) {
  const [hours, minutes, seconds] = sexagesimal(normalizeRa(ra) / 15, 1);
  return `${pad(hours % 24)}h ${pad(minutes)}m ${seconds}s`;
}

export function formatDec(dec: number) {
  const [degrees, minutes, seconds] = sexagesimal(Math.abs(dec), 0);
  return `${dec < 0 ? "−" : "+"}${pad(degrees)}° ${pad(minutes)}′ ${seconds}″`;
}

export function formatAngularSize(degrees: number) {
  if (degrees >= 1) return `${degrees.toFixed(degrees >= 10 ? 0 : 1)}°`;
  const arcmin = degrees * 60;
  if (arcmin >= 1) return `${arcmin.toFixed(arcmin >= 10 ? 1 : 2)}′`;
  return `${(arcmin * 60).toFixed(1)}″`;
}
