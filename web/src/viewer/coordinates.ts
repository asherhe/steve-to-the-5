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
