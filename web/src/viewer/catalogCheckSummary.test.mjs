import test from "node:test";
import assert from "node:assert/strict";
import { gaiaNeighbours, nearestRow, summarize } from "./catalogCheckSummary.ts";

// Synthetic check results: shapes follow fixtures/catalogs/openapi.json; values are made up.
const check = (catalog, status, rows = []) => ({ catalog, status, scope: "", sourceUrl: "", rows });
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

test("an unchecked catalog makes an empty result incomplete, never empty", () => {
  const result = summarize(review(["no_candidates", "unavailable", "no_candidates", "no_candidates", "skipped", "no_candidates"]));
  assert.equal(result.tone, "incomplete");
  assert.match(result.detail, /SIMBAD, SkyBoT were not checked/);
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

test("expected points follow point-check-v2: known 10, uncatalogued up to 20, otherwise 0", async () => {
  const { expectedPoints } = await import("./catalogCheckSummary.ts");
  const make = (statuses, mode = "live") => ({ mode, ra: 0, dec: 0, radiusArcsec: 30, observedAtUtc: null, limitations: [],
    checks: names.map((name, i) => check(name, statuses[i])) });
  assert.equal(expectedPoints(make(["candidates", ...Array(5).fill("no_candidates")])).points, 10);
  const blank = expectedPoints(make(Array(6).fill("no_candidates")));
  assert.equal(blank.points, 20);
  assert.ok(blank.needsBrightness);
  assert.equal(expectedPoints(make(["unavailable", ...Array(5).fill("no_candidates")])).points, 0);
  assert.equal(expectedPoints(make(Array(6).fill("skipped"), "offline")).points, null);
});
