import assert from "node:assert/strict";
import test from "node:test";
import { isDecimalPair, parseAngle, parseSkyPosition } from "./coordinates.ts";

// WISE 0855−0714 as SIMBAD lists it: 08h55m10.831s −07°14′42.53″ (≈ 133.795129°, −7.245147°).
const wise0855 = { ra: 133.795129, dec: -7.245147 };

function near(position, expected) {
  assert.ok(position, "expected a position");
  assert.ok(Math.abs(position.ra - expected.ra) < 1e-5, `RA ${position.ra}`);
  assert.ok(Math.abs(position.dec - expected.dec) < 1e-5, `Dec ${position.dec}`);
}

test("labelled and unit-marked sexagesimal positions parse", () => {
  for (const text of [
    "Right Ascension 08h55m10.831s, declination -7d14m42.53s",
    "right ascension 08h55m10.831s declination -7d14m42.53s",
    "RA 08h55m10.831s Dec -7d14m42.53s",
    "RA 08h55m10.831s and Dec -7d14m42.53s",
    "RA: 08h 55m 10.831s, Dec: −07° 14′ 42.53″",
    "R.A. = 08 55 10.831, Decl. = -07 14 42.53 (J2000)",
    "α 08:55:10.831 δ -07:14:42.53",
    "08h55m10.831s; -07°14'42.53\"",
    "08 h 55 m 10.831 s, -7 d 14 m 42.53 s",
    "08h55m10.831s -07 14 42.53",
    "ICRS 08:55:10.831 -07:14:42.53",
  ]) near(parseSkyPosition(text), wise0855);
});

test("existing decimal and sexagesimal forms still parse", () => {
  near(parseSkyPosition("133.795129, -7.245147"), wise0855);
  near(parseSkyPosition("133.795129 -7.245147"), wise0855);
  near(parseSkyPosition("133.795129° -7.245147°"), wise0855);
  near(parseSkyPosition("17 57 48.5 +04 41 36"), { ra: 269.4520833, dec: 4.6933333 });
  near(parseSkyPosition("17:57:48.5 +04:41:36"), { ra: 269.4520833, dec: 4.6933333 });
  assert.equal(isDecimalPair("400, -20"), true);
  assert.equal(parseSkyPosition("400, -20"), null);
});

test("names and incomplete input are not taken for positions", () => {
  for (const text of ["Barnard's Star", "RW Aurigae", "Epsilon Indi B", "WISE 0855-0714", "Dec 5", "RA 08h55m10.831s"]) {
    assert.equal(parseSkyPosition(text), null, text);
    assert.equal(isDecimalPair(text), false, text);
  }
  // Out-of-range minutes or seconds, and a negative RA, are rejected.
  assert.equal(parseSkyPosition("08h60m10s, -7d14m42s"), null);
  assert.equal(parseSkyPosition("-08h55m10s, -7d14m42s"), null);
});

test("single fields from the advanced form accept the same spellings", () => {
  assert.ok(Math.abs(parseAngle("RA 08h55m10.831s", "ra") - wise0855.ra) < 1e-5);
  assert.ok(Math.abs(parseAngle("Dec −07° 14′ 42.53″", "dec") - wise0855.dec) < 1e-5);
  assert.equal(parseAngle("95", "dec"), null);
});
