import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadNeossat } from "./neossat.ts";
const fixture = JSON.parse(await readFile(new URL("../../../fixtures/catalogs/neossat.json", import.meta.url), "utf8"));

test("NEOSSat queries only the requested position and forwards cancellation without caching", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await loadNeossat(fixture.position, controller.signal, async (path, options) => {
    calls.push(path); assert.equal(options.signal, controller.signal); assert.equal(options.cache, "no-store");
    return Response.json(fixture);
  });
  assert.deepEqual(calls, ["/api/catalogs/neossat?ra=10&dec=20"]);
  assert.deepEqual(result, fixture);
});

test("empty searches succeed; outages, unsafe image URLs and mismatched positions fail explicitly", async () => {
  const request = body => async () => Response.json(body);
  assert.deepEqual((await loadNeossat(fixture.position, undefined, request({ ...fixture, images: [] }))).images, []);
  for (const value of [null, { ...fixture, position: { ra: 20, dec: 30 } }, { ...fixture, images: [{ ...fixture.images[0], imageUrl: "https://evil.test/img.png" }] }, { ...fixture, images: [fixture.images[0], fixture.images[0]] }]) {
    await assert.rejects(loadNeossat(fixture.position, undefined, request(value)), /invalid response/);
  }
  await assert.rejects(loadNeossat(fixture.position, undefined, async () => new Response("outage", { status: 503 })), /unavailable/);
  await assert.rejects(loadNeossat(fixture.position, undefined, async () => new Response("<html>fallback</html>")), /unreadable/);
});

test("invalid positions never query the archive", async () => {
  for (const position of [{ ra: NaN, dec: 0 }, { ra: 360, dec: 0 }, { ra: 0, dec: -91 }]) {
    await assert.rejects(loadNeossat(position, undefined, async () => assert.fail("unexpected request")), /valid sky position/);
  }
});
