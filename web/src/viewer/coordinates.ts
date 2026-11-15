import type { SkyPosition } from "./comparison";
import { namedTargets } from "./targetNames.ts";

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const degreeSuffix = /\s*(?:°|deg(?:rees?)?)$/i;
const separated = /^([+-]?\d+)(?::|\s+)(\d+)(?::|\s+)(\d+(?:\.\d+)?)$/;
const raUnits = /^([+]?\d+)\s*h\s*(\d+)\s*m\s*(\d+(?:\.\d+)?)\s*s?$/i;
const decUnits = /^([+-]?\d+)\s*(?:°|d|deg)\s*(\d+)\s*(?:'|m)\s*(\d+(?:\.\d+)?)\s*(?:"|s)?$/i;

/** Axis labels, frame names and joining words that may surround typed coordinates. */
const labels = /(?:\bright\s+ascension\b|\bdeclination\b|\bdecl?\b\.?|\br\.?a\b\.?|[αδ])\s*[:=]?|\(?\b(?:icrs|fk5|j2000(?:\.0)?)\b\)?|\band\b/gi;

/**
 * Puts typed coordinates into one spelling: ASCII signs and primes, no axis labels,
 * and no space between a number and its unit ("08 h 55 m" → "08h55m").
 */
function normalizeCoordinates(input: string): string {
  return input
    .replace(/[−–—]/g, "-")
    .replace(/[′’‘]/g, "'")
    .replace(/[″”“]|''/g, '"')
    .replace(labels, " ")
    .replace(/(\d)\s+(?=[hdms°'"](?![a-z]))/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export const barnardGaiaSourceId = "4472832130942575872";

/**
 * Parses one RA or Dec value: decimal degrees (optionally with "°" or "deg"), colon- or
 * space-separated sexagesimal, or units (RA "08h55m10.8s", Dec "-7d14m42.5s" / "-7°14′42.5″").
 */
export function parseAngle(input: string, axis: "ra" | "dec"): number | null {
  const value = normalizeCoordinates(input).replace(/^,+|,+$/g, "").trim();
  const unitless = value.replace(degreeSuffix, "");
  let degrees: number;

  if (decimal.test(unitless)) {
    degrees = Number(unitless);
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

// Names and centers are shared with /api/resolve, including the recorded center epoch.
export const targetPresets = namedTargets.map(target => ({
  name: target.identity!.displayName, ra: target.ra, dec: target.dec,
}));

const plainNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Possible RA / Dec splits of free text. With a comma or semicolon the text splits there;
 * otherwise every split between whitespace-separated tokens is offered, so "RA Dec",
 * six sexagesimal fields ("17 57 48.5 +04 41 36") and labelled forms
 * ("Right Ascension 08h55m10.8s, declination -7d14m42.5s") all work.
 */
function splitPosition(input: string): [string, string][] {
  const value = normalizeCoordinates(input);
  if (/[,;]/.test(value)) {
    const parts = value.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
    return parts.length === 2 ? [[parts[0], parts[1]]] : [];
  }
  const tokens = value.split(" ").filter(Boolean);
  return tokens.slice(1).map((_, i) => [tokens.slice(0, i + 1).join(" "), tokens.slice(i + 1).join(" ")]);
}

/** Parses an ICRS position typed as one string. Returns null when it is not a valid position. */
export function parseSkyPosition(input: string): SkyPosition | null {
  for (const [raText, decText] of splitPosition(input)) {
    const ra = parseAngle(raText, "ra");
    const dec = parseAngle(decText, "dec");
    if (ra !== null && dec !== null) return { ra, dec };
  }
  return null;
}

/** True for two plain decimal numbers, which can only mean a (possibly out-of-range) position. */
export function isDecimalPair(input: string): boolean {
  return splitPosition(input).some((parts) => parts.every((part) => plainNumber.test(part.replace(degreeSuffix, ""))));
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
