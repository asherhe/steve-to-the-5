import assert from "node:assert/strict";
import test from "node:test";
import { createPointReviewCache } from "./pointReviewCache.ts";

const request = { ra: 269.44366462612743, dec: 4.771713114167801, radiusArcsec: 30, observedAtUtc: null };
const revisit = { ...request, ra: 269.4456061558476, dec: 4.770098368937224 };
const review = {
  ...request, mode: "live", limitations: [], checks: [
    { catalog: "Gaia DR3", status: "candidates", rows: [{ sourceId: "42", ra: request.ra, dec: request.dec }] },
    { catalog: "SkyBoT", status: "skipped", rows: [] },
  ],
};

test("an exact revisit reuses its report and a shifted mark gets a nearby preview", () => {
  const cache = createPointReviewCache();
  cache.remember(request, review);
  assert.deepEqual(cache.lookup(request), { exact: review });
  assert.deepEqual(cache.lookup(revisit), { nearby: review });
  assert.equal(cache.lookup({ ...request, dec: request.dec + 1 / 60 }).nearby, undefined);
  assert.equal(cache.lookup({ ...revisit, radiusArcsec: 10 }).nearby, undefined);
  assert.equal(cache.lookup({ ...revisit, observedAtUtc: "2026-01-01T00:00:00Z" }).nearby, undefined);
});

test("an outage leaves prior sources available for preview and retries the exact mark", () => {
  const cache = createPointReviewCache();
  const incomplete = { ...review, checks: [...review.checks, { catalog: "SIMBAD", status: "unavailable" }] };
  cache.remember(request, incomplete);
  assert.deepEqual(cache.lookup(request), { nearby: incomplete });
});

test("old results expire from the browser cache", t => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const cache = createPointReviewCache();
  cache.remember(request, review);
  t.mock.timers.tick(5 * 60_000);
  assert.equal(cache.lookup(request).exact, undefined);
  assert.equal(cache.lookup(revisit).nearby, undefined);
});
