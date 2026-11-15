import { namedTargets } from "./targetNames";

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

// Coordinates and names come from the same reviewed snapshot as /api/resolve.
export const targetPresets = namedTargets.map(target => ({
  name: target.identity!.displayName, ra: target.ra, dec: target.dec,
}));
