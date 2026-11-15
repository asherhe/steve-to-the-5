import { test } from "node:test";
import assert from "node:assert/strict";
import { blankSlices, nextReadySlice, nextScanSlice, scanMaxSlice, scanOrder, scanSampleCount, scanSamples, scanSpeeds, scanBaseStepMs, scannableSlices, bandForSlice, spherexSliceWavelengthsUm } from "./spherexSurvey.ts";

test("a scan visits every non-blank wavelength once, short to long, then wraps to the start", () => {
  const first = nextScanSlice(spherexSliceWavelengthsUm.length - 1);
  assert.equal(first, 1, "wraps to the first slice that has tiles, not slice 0");
  const visited = [first];
  for (let slice = nextScanSlice(first); slice !== first; slice = nextScanSlice(slice)) {
    assert.ok(visited.length <= spherexSliceWavelengthsUm.length, "the scan never loops back early");
    visited.push(slice);
  }
  const expected = spherexSliceWavelengthsUm.map((_, slice) => slice).filter(slice => !blankSlices.has(slice));
  assert.deepEqual(visited, expected);
  assert.deepEqual(visited.map(slice => spherexSliceWavelengthsUm[slice]), [...visited.map(slice => spherexSliceWavelengthsUm[slice])].sort((a, b) => a - b));
  // Slices with no tiles (0 and the two blank dichroic channels) are skipped, never shown.
  assert.ok([...blankSlices].every(slice => !visited.includes(slice)));
});

test("a scan only moves to wavelengths that are already loaded, in order, wrapping round", () => {
  assert.equal(scannableSlices.length, spherexSliceWavelengthsUm.length - blankSlices.size);
  // Scan order starts just after the slice on screen and ends with it.
  assert.deepEqual(scanOrder(98).slice(0, 3), [99, 100, 101]);
  assert.equal(scanOrder(98).at(-1), 98);
  assert.equal(scanOrder(98).length, scannableSlices.length);
  const ready = new Set([5, 20, 49, 52, 101]);
  assert.equal(nextReadySlice(5, ready), 20);
  assert.equal(nextReadySlice(20, ready), 49);
  // The blank slices 50 and 51 are never chosen, even if they were somehow listed as ready.
  assert.equal(nextReadySlice(49, new Set([...ready, 50, 51])), 52);
  assert.equal(nextReadySlice(101, ready), 5, "wraps to the start");
  // Nothing else is loaded yet, or only the slice on screen: the scan waits instead of repeating it.
  assert.equal(nextReadySlice(5, new Set()), null);
  assert.equal(nextReadySlice(5, new Set([5])), null);
});

test("a scan preloads ten wavelengths spread evenly from the shortest up to band 5, never band 6", () => {
  assert.equal(scanSamples.length, scanSampleCount);
  assert.equal(scanSamples[0], scannableSlices[0]);
  assert.equal(scanSamples.at(-1), scanMaxSlice);
  assert.equal(new Set(scanSamples).size, scanSamples.length);
  assert.ok(scanSamples.every((slice, i) => i === 0 || slice > scanSamples[i - 1]));
  assert.ok(scanSamples.every(slice => !blankSlices.has(slice)));
  // The longest wavelengths, where the map drew white, are left out.
  assert.ok(scanSamples.every(slice => bandForSlice(slice) <= 5));
  assert.equal(bandForSlice(scanMaxSlice), 5);
  assert.equal(bandForSlice(scanMaxSlice + 1), 6, "the next slice is the first of band 6");
  const range = scannableSlices.filter(slice => slice <= scanMaxSlice);
  const gaps = scanSamples.slice(1).map((slice, i) => range.indexOf(slice) - range.indexOf(scanSamples[i]));
  assert.ok(Math.max(...gaps) <= 2 * (range.length - 1) / (scanSampleCount - 1), "evenly spread");
  // A scan from any slice cycles through exactly these ten when they are the ready set.
  const ready = new Set(scanSamples);
  const seen = [scanSamples[3]];
  for (let s = nextReadySlice(seen[0], ready); s !== seen[0]; s = nextReadySlice(s, ready)) seen.push(s);
  assert.deepEqual([...seen].sort((a, b) => a - b), [...scanSamples]);
});

test("scan speeds run from slow to fast, each step time shorter than the last", () => {
  assert.deepEqual([...scanSpeeds], [...scanSpeeds].sort((a, b) => a - b));
  assert.ok(scanSpeeds.includes(1));
  const stepMs = scanSpeeds.map(speed => scanBaseStepMs / speed);
  assert.ok(stepMs.every((ms, i) => i === 0 || ms < stepMs[i - 1]));
  assert.ok(Math.min(...stepMs) >= 25, "the fastest speed is still a visible step");
});
