import test from "node:test";
import assert from "node:assert/strict";
import { gaiaNeighbours, nearestRow, summarize, catalogSources, publishedPosition } from "./catalogCheckSummary.ts";

// Synthetic check results: shapes follow fixtures/catalogs/openapi.json; values are made up.
const check = (catalog, status, rows = ["candidates", "partial"].includes(status) ? [{ name: "fixture" }] : []) => ({ catalog, status, scope: "", sourceUrl: "", rows });
const names = ["Gaia DR3", "SIMBAD", "CatWISE2020", "UltracoolSheet", "SkyBoT", "VizieR"];
const review = (statuses, extra = {}) => ({
  mode: "live", ra: 10, dec: 10, radiusArcsec: 30, observedAtUtc: null, limitations: [],
  checks: names.map((name, i) => check(name, statuses[i])), ...extra,
});

test("a record in any catalog reads as listed, not as a confirmed match", () => {
  const result = summarize(review(["no_candidates", "candidates", "no_candidates", "no_candidates", "skipped", "partial"]));
  assert.equal(result.tone, "listed");
  assert.match(result.title, /2 of 6/);
  assert.match(result.detail, /SIMBAD, VizieR/);
  assert.match(result.detail, /not a confirmed match/);
});

test("up to two unavailable catalogs allow an uncatalogued candidate with visible gaps", () => {
  const result = summarize(review(["no_candidates", "unavailable", "no_candidates", "no_candidates", "skipped", "no_candidates"]));
  assert.equal(result.tone, "empty");
  assert.match(result.detail, /Unavailable: SIMBAD/);
});

test("all six empty is a lead, not a discovery", () => {
  const result = summarize(review(Array(6).fill("no_candidates")));
  assert.equal(result.tone, "empty");
  assert.match(result.detail, /not a discovery/);
});

test("offline service is reported as not searched", () => {
  assert.equal(summarize(review(Array(6).fill("skipped"), { mode: "offline" })).tone, "offline");
});

test("nearest row uses the catalog's separation or its published position", () => {
  const point = { ra: 10, dec: 10 };
  assert.deepEqual(nearestRow(check("Gaia DR3", "candidates", [{ sourceId: "1", separationArcsec: 12 }, { sourceId: "2", separationArcsec: 3.5 }]), point), { name: "Gaia DR3 2", arcsec: 3.5 });
  const simbad = nearestRow(check("SIMBAD", "candidates", [{ main_id: "Example", ra: 10, dec: 10 + 6 / 3600 }]), point);
  assert.equal(simbad.name, "Example");
  assert.ok(Math.abs(simbad.arcsec - 6) < 1e-6);
  const allwise = nearestRow(check("VizieR", "candidates", [{ AllWISE: "J0000", RAJ2000: "10", DEJ2000: "10.001" }]), point);
  assert.ok(Math.abs(allwise.arcsec - 3.6) < 1e-6);
  assert.equal(nearestRow(check("SkyBoT", "candidates", [{ Name: "rock", RA: "00 40 00" }]), point), null);
});

test("Gaia neighbours are ordered by separation at the shown time, as the inspector predicts", () => {
  const point = { ra: 10, dec: 0 };
  const gaia = { ...check("Gaia DR3", "candidates", [
    // Catalog position 20" east, moving 1"/yr west: about 10" away by 2026.0.
    { sourceId: "fast", ra: 10 + 20 / 3600, dec: 0, refEpoch: 2016, pmRaCosDecMasYr: -1000, pmDecMasYr: 0, gMag: 12.5 },
    { sourceId: "still", ra: 10, dec: 15 / 3600, refEpoch: 2016, pmRaCosDecMasYr: null, pmDecMasYr: null, gMag: null },
    { sourceId: "bad", ra: "x", dec: 0, refEpoch: 2016 },
  ]) };
  const review = { mode: "live", ra: 10, dec: 0, radiusArcsec: 30, observedAtUtc: null, limitations: [], checks: [gaia] };
  const atCatalogEpoch = gaiaNeighbours(review, point, null);
  assert.deepEqual(atCatalogEpoch.map(s => s.sourceId), ["still", "fast"]);
  assert.equal(atCatalogEpoch[1].predicted, null);
  const at2026 = gaiaNeighbours(review, point, "2026-01-01T00:00:00Z");
  assert.deepEqual(at2026.map(s => s.sourceId), ["fast", "still"]);
  assert.ok(Math.abs(at2026[0].separationArcsec - 10) < 0.05);
  assert.equal(at2026[1].predicted, null, "no proper motion: kept at its catalog position");
});

test("expected points follow point-check-v3: known 10, uncatalogued up to 20, otherwise 0", async () => {
  const { expectedPoints } = await import("./catalogCheckSummary.ts");
  const make = (statuses, mode = "live") => ({ mode, ra: 0, dec: 0, radiusArcsec: 30, observedAtUtc: null, limitations: [],
    checks: names.map((name, i) => check(name, statuses[i])) });
  assert.equal(expectedPoints(make(["candidates", ...Array(5).fill("no_candidates")])).points, 10);
  const blank = expectedPoints(make(Array(6).fill("no_candidates")));
  assert.equal(blank.points, 20);
  assert.ok(blank.needsBrightness);
  assert.equal(expectedPoints(make(["unavailable", ...Array(5).fill("no_candidates")])).points, 20);
  assert.equal(expectedPoints(make(Array(6).fill("skipped"), "offline")).points, null);
});


test("all six catalogs supply usable published markers, including sexagesimal SkyBoT", () => {
  const rows = [
    { sourceId: "42", ra: 10, dec: 10, refEpoch: 2016, pmRaCosDecMasYr: 0, pmDecMasYr: 0 },
    { main_id: "SIMBAD source", ra: "10", dec: "10" },
    { source_name: "CatWISE source", ra: 10, dec: 10 },
    { name: "Cool source", ra_j2000_formula: "10", dec_j2000_formula: "10" },
    { Name: "Rock", RA: "00 40 00", DEC: "+10 00 00" },
    { AllWISE: "WISE source", RAJ2000: 10, DEJ2000: 10 },
  ];
  const checked = review(Array(6).fill("candidates"));
  checked.checks.forEach((check, i) => { check.rows = [rows[i]]; });
  const result = catalogSources(checked, { ra: 10, dec: 10 }, "2026-01-01T00:00:00Z");
  assert.equal(result.length, 6);
  assert.ok(result.every(source => source.placeable));
  assert.equal(result.find(source => source.catalog === "SkyBoT").ra, 10);
  assert.match(result.find(source => source.catalog === "SIMBAD").label, /published catalog position/);
  assert.match(result.find(source => source.catalog === "Gaia DR3").label, /predicted for 2026/);
});

test("malformed and out-of-range catalog coordinates never become map markers", () => {
  for (const row of [{ ra: 10, dec: 91 }, { ra: NaN, dec: 0 }, { RA: "24 00 00", DEC: "00 00 00" },
    { RA: "00 60 00", DEC: "00 00 00" }, { RA: "00 00 00", DEC: "+90 01 00" }]) {
    assert.equal(publishedPosition(row), null);
  }
  assert.deepEqual(publishedPosition({ RA: "23:59:59.9", DEC: "-00:00:01" }), { ra: (23 + 59/60 + 59.9/3600)*15, dec: -1/3600 });
});

test("an expected undated SkyBoT skip leaves the two-of-four brightness route available", async () => {
  const { expectedPoints } = await import("./catalogCheckSummary.ts");
  const checked = review(["no_candidates", "no_candidates", "no_candidates", "no_candidates", "skipped", "no_candidates"]);
  const result = expectedPoints(checked);
  assert.equal(result.points, 20);
  assert.match(result.detail, /SPHEREx, WISE, DSS and NEOSSat/);
  assert.equal(summarize(checked).tone, "empty");
  assert.match(summarize(checked).detail, /SkyBoT needs an observation time/);
});


test("three outages, unexpected skips and truncated empty results remain incomplete", () => {
  for (const statuses of [
    ["no_candidates", "unavailable", "unavailable", "unavailable", "skipped", "no_candidates"],
    ["no_candidates", "skipped", ...Array(4).fill("no_candidates")],
  ]) assert.equal(summarize(review(statuses)).tone, "incomplete");
  const partial = review(Array(6).fill("no_candidates"));
  partial.checks[1] = check("SIMBAD", "partial", []);
  assert.equal(summarize(partial).tone, "incomplete");
});

test("Gaia DR3 is not required for points, but a Gaia match still counts", async () => {
  const { expectedPoints } = await import("./catalogCheckSummary.ts");
  for (const gaia of ["unavailable", "skipped"]) {
    // Gaia not checked plus two other outages stays within the allowance.
    const result = review([gaia, "unavailable", "unavailable", "no_candidates", "skipped", "no_candidates"]);
    assert.equal(summarize(result).tone, "empty");
    assert.match(summarize(result).detail, /Gaia DR3 could not be checked; it is not required for points/);
    assert.match(summarize(result).detail, /Unavailable: SIMBAD, CatWISE2020;/);
    assert.equal(expectedPoints(result).points, 20);
  }
  const partial = review(Array(6).fill("no_candidates"));
  partial.checks[0] = check("Gaia DR3", "partial", []);
  assert.equal(summarize(partial).tone, "empty");
  const third = review(["unavailable", "unavailable", "unavailable", "unavailable", "skipped", "no_candidates"]);
  assert.equal(summarize(third).tone, "incomplete");
  const known = review(["candidates", ...Array(5).fill("no_candidates")]);
  assert.equal(summarize(known).tone, "listed");
  assert.equal(expectedPoints(known).points, 10);
});

test("server frame-time predictions place non-Gaia sources without changing native columns", () => {
  const observedAtUtc = "2026-01-01T00:00:00Z";
  const value = review(Array(6).fill("no_candidates"), { observedAtUtc });
  value.checks[1] = check("SIMBAD", "candidates", [{ main_id: "mover", ra: 11, dec: 10,
    predictedRa: 10, predictedDec: 10, positionAtUtc: observedAtUtc }]);
  const [source] = catalogSources(value, { ra: 10, dec: 10 }, observedAtUtc);
  assert.equal(source.ra, 10);
  assert.match(source.label, /predicted for 2026/);
  const [native] = catalogSources(value, { ra: 10, dec: 10 }, "2025-01-01T00:00:00Z");
  assert.equal(native.ra, 11, "do not reuse a prediction at another date");
});
