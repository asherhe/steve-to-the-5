import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createWiseDataSource } from "./production.ts";
import { archiveFieldLimits, wiseFieldLimits } from "./archive.ts";
import { compareFieldMaxArcmin, compareReachDeg, fieldWidthFromView } from "./compareField.ts";

// The WISE service returns the archive's comparison shape, so the archive owner's
// synthetic response stands in for its body here. Only routing is under test.
const ready = JSON.parse(await readFile(new URL("../../../fixtures/archive/responses/ready.json", import.meta.url), "utf8"));
const field = ready.comparison.field;
function client(band, body = ready, status = 200) {
  const calls = [];
  const source = createWiseDataSource(band, async (path, options) => {
    calls.push({ path, options });
    return Response.json(body, { status });
  });
  return { source, calls };
}

test("search goes to the WISE route with the chosen band", async () => {
  for (const band of [1, 2]) {
    const { source, calls } = client(band);
    const result = await source.search(field);
    assert.equal(result.status, "ready");
    assert.equal(calls[0].path, `/api/wise/comparisons?ra=10&dec=20&fovArcmin=6&band=${band}`);
  }
});

test("saved replay uses the WISE evidence store, never the SPHEREx one", async () => {
  const { source, calls } = client(2);
  const saved = await source.loadSaved(ready.comparison.id);
  assert.equal(saved.id, ready.comparison.id);
  assert.deepEqual(calls.map(call => call.path), [`/api/wise/comparisons/${ready.comparison.id}`]);
  assert.equal(await client(2, { code: "NOT_FOUND", message: "Unknown comparison ID" }, 404).source.loadSaved("missing"), null);
});

test("a longer time-lapse is an explicit search and never changes saved replay", async () => {
  const {source,calls}=client(2);
  await source.search(field,undefined,undefined,{mode:"timeline",refresh:true});
  const url=new URL(calls[0].path,"http://viewer.test");
  assert.equal(url.searchParams.get("mode"),"timeline");
  assert.equal(url.searchParams.get("refresh"),"true");
  await source.loadSaved(ready.comparison.id);
  assert.equal(calls[1].path,`/api/wise/comparisons/${ready.comparison.id}`);
});

test("fields wider than the WISE limit never issue a request", async () => {
  const { source, calls } = client(2);
  assert.deepEqual(wiseFieldLimits, { min: 1, max: 12 });
  for (const fovArcmin of [0.5, 12.5, 30]) {
    await assert.rejects(source.search({ ...field, fovArcmin }), error =>
      error.code === "INVALID_REQUEST" && /1–12 arcmin/.test(error.message));
  }
  assert.equal(calls.length, 0);
});

test("a build reports progress from its own route and stops polling when it ends", async () => {
  const calls = [];
  const states = [];
  let polls = 0;
  const source = createWiseDataSource(2, async (path) => {
    calls.push(path);
    if (path.includes("/progress/")) {
      polls += 1;
      // The second poll answers as the service does once a build has finished.
      if (polls === 2) return Response.json({ code: "NOT_FOUND", message: "No running build" }, { status: 404 });
      return Response.json({ stage: "retrieval", done: 12, total: 30, fraction: 0.61, elapsedSeconds: 40 });
    }
    await new Promise(resolve => setTimeout(resolve, 60));
    return Response.json(ready);
  }, 10);
  const result = await source.search(field, undefined, state => states.push(state));
  assert.equal(result.status, "ready");
  const id = new URL(calls[0], "http://viewer.test").searchParams.get("progressId");
  assert.match(id, /^[A-Za-z0-9-]{8,64}$/);
  assert.ok(calls.slice(1).every(path => path === `/api/wise/comparisons/progress/${id}`));
  assert.ok(states.length >= 1 && states.length < polls);
  assert.deepEqual(states[0], { stage: "retrieval", done: 12, total: 30, fraction: 0.61, elapsedSeconds: 40 });
  const settled = calls.length;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(calls.length, settled);
});

test("a search without a progress listener sends no progress ID", async () => {
  const { source, calls } = client(2);
  await source.search(field);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].path.includes("progressId"));
});

test("a compare from the map uses the view when it fits and its centre when it is wider", () => {
  // Zoomed in further than the smallest field: the smallest field is used.
  assert.equal(fieldWidthFromView(0.5 / 60, wiseFieldLimits), 1);
  // Inside the limits the view itself is the field.
  assert.equal(fieldWidthFromView(6 / 60, wiseFieldLimits), 6);
  assert.equal(fieldWidthFromView(4 / 60, archiveFieldLimits), 4);
  // Wider views compare a capped field at the same centre, below the services' maxima.
  assert.equal(compareFieldMaxArcmin, 10);
  assert.equal(fieldWidthFromView(20 / 60, archiveFieldLimits), 10);
  assert.equal(fieldWidthFromView(2, wiseFieldLimits), 10);
  assert.equal(fieldWidthFromView(2, archiveFieldLimits), 10);
  assert.equal(fieldWidthFromView(compareReachDeg, wiseFieldLimits), 10);
  // Beyond the reach, and for unusable values, no compare is offered.
  for (const width of [compareReachDeg + 0.01, 180, 360, 0, -1, NaN]) {
    assert.equal(fieldWidthFromView(width, wiseFieldLimits), null);
  }
});

test("cancelling a search tells the service to stop the build", async () => {
  const calls = [];
  const controller = new AbortController();
  const source = createWiseDataSource(2, async (path, options = {}) => {
    calls.push({ path, method: options.method ?? "GET" });
    if (path.includes("/progress/")) return Response.json({ code: "NOT_FOUND", message: "none" }, { status: 404 });
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  }, 1000);
  const pending = source.search(field, controller.signal, () => {});
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  const id = new URL(calls[0].path, "http://viewer.test").searchParams.get("progressId");
  assert.ok(calls.some(call => call.method === "DELETE" && call.path === `/api/wise/comparisons/progress/${id}`));
});

test("a bare 404 from an out-of-date backend is reported as a missing route, not a generic failure", async () => {
  const source = createWiseDataSource(2, async () => Response.json({ detail: "Not Found" }, { status: 404 }));
  await assert.rejects(source.search(field), error => error.code === "ROUTE_NOT_FOUND" && /Restart it/.test(error.message));
  // A saved ID that does not exist still comes back as a coded NOT_FOUND and maps to null.
  const saved = createWiseDataSource(2, async () => Response.json({ code: "NOT_FOUND", message: "Unknown comparison ID" }, { status: 404 }));
  assert.equal(await saved.loadSaved("missing"), null);
});
