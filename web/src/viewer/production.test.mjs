import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createViewerDataSource } from "./production.ts";
import { archiveFieldLimits, ArchiveRequestError } from "./archive.ts";

const archiveRoot = new URL("../../../fixtures/archive/", import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, archiveRoot), "utf8"));
const ready = await read("responses/ready.json");
const field = ready.comparison.field;
function client(body, status = 200) {
  const calls = [];
  const source = createViewerDataSource(async (path, options) => {
    calls.push({ path, options });
    return Response.json(body, { status });
  });
  return { source, calls };
}

test("search maps every owner-supplied status and incomplete-search fixture", async () => {
  for (const name of ["ready", "single_epoch", "no_coverage", "no_comparable_pair", "upstream_unavailable", "ready_incomplete_retrieval", "upstream_unavailable_incomplete_negative"]) {
    const fixture = await read(`responses/${name}.json`);
    const { source, calls } = client(fixture);
    const result = await source.search(field);
    assert.equal(result.status, fixture.status);
    assert.deepEqual(result.diagnostics, fixture.diagnostics);
    assert.equal(calls[0].path, "/api/comparisons?ra=10&dec=20&fovArcmin=6");
    if (fixture.comparison) {
      assert.equal(result.comparison.id, fixture.comparison.id);
      assert.deepEqual(result.comparison.grid, fixture.comparison.grid);
      assert.deepEqual(result.comparison.stretch, { min: fixture.comparison.stretch.lower, max: fixture.comparison.stretch.upper, unit: fixture.comparison.stretch.unit });
      assert.deepEqual(result.comparison.frames, [...fixture.comparison.frames].sort((a,b) => Date.parse(a.observedAtUtc)-Date.parse(b.observedAtUtc)));
      assert.deepEqual(result.comparison.provenance, fixture.comparison.provenance);
      assert.deepEqual(result.comparison.wavelengthRangeUm, fixture.comparison.wavelengthRangeUm);
    } else assert.equal(result.comparison, null);
  }
});
test("saved replay preserves assets, grid and provenance and does not perform a search", async () => {
  const fixture = await read("real/response.json");
  const { source, calls } = client(fixture);
  const saved = await source.loadSaved(fixture.comparison.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/comparisons/${fixture.comparison.id}`);
  assert.deepEqual(saved.frames.map(f=>f.imageUrl).sort(), fixture.comparison.frames.map(f=>f.imageUrl).sort());
  assert.deepEqual(saved.grid, fixture.comparison.grid);
  assert.deepEqual(saved.provenance, fixture.comparison.provenance);
  await assert.rejects(source.loadSaved("different-id"), /different saved evidence/);
});
test("missing saved IDs map to null; owner-supplied HTTP errors preserve their codes", async () => {
  for (const name of ["not_found", "build_busy", "processing_limit_deadline", "processing_limit_cutout_budget", "invalid_request"]) {
    const fixture = await read(`responses/errors/${name}.json`);
    const { source } = client(fixture.body, fixture.httpStatus);
    if (name === "not_found") assert.equal(await source.loadSaved("missing"), null);
    else await assert.rejects(source.search(field), error => error instanceof ArchiveRequestError && error.code === fixture.body.code && error.message === fixture.body.message);
  }
});
test("invalid response shapes, duplicate frame IDs, unknown statuses and HTML fallbacks are explicit failures", async () => {
  for (const body of [null, {status:"unknown"}, {status:"ready",comparison:null}, {...ready,comparison:{...ready.comparison,frames:[]}}, {...ready,comparison:{...ready.comparison,frames:[ready.comparison.frames[0],ready.comparison.frames[0]]}}]) {
    await assert.rejects(client(body).source.search(field), error => error.code === "INVALID_RESPONSE");
  }
  const source = createViewerDataSource(async () => new Response("<html>fallback</html>"));
  await assert.rejects(source.search(field), error => error.code === "INVALID_RESPONSE");
});
test("bounds agree with OpenAPI; invalid fields never issue requests", async () => {
  const schema = await read("openapi.json");
  const bounds = schema.components.schemas.FieldRequest.properties.fovArcmin;
  assert.deepEqual(archiveFieldLimits, {min:bounds.minimum,max:bounds.maximum});
  const {source,calls} = client(ready);
  for (const invalid of [{...field,ra:360},{...field,dec:91},{...field,fovArcmin:31},{...field,fovArcmin:0},{...field,ra:NaN}]) {
    await assert.rejects(source.search(invalid), error => error.code === "INVALID_REQUEST");
  }
  assert.equal(calls.length,0);
});
test("name resolution uses the same-origin catalog route and distinguishes missing names and outages", async () => {
  const presets = JSON.parse(await readFile(new URL("../../../services/catalogs/fixtures/catalogs/presets.json", import.meta.url),"utf8"));
  const preset = presets.presets[0];
  const expected = {name:preset.name,ra:preset.ra,dec:preset.dec};
  const {source,calls} = client(expected);
  assert.deepEqual(await source.resolveName(preset.name), expected);
  assert.equal(calls[0].path, `/api/resolve?name=${encodeURIComponent(preset.name)}`);
  assert.equal(await client({code:"not_found",message:"Missing"},404).source.resolveName("unknown"),null);
  await assert.rejects(client({code:"upstream_unavailable",message:"Outage"},503).source.resolveName("unknown"), error=>error.code==="upstream_unavailable");
  await assert.rejects(client({...expected,ra:NaN}).source.resolveName("invalid"), error=>error.code==="invalid_response");
});
test("all three operations forward cancellation; saved IDs are path-encoded", async () => {
  const signal = AbortSignal.abort();
  const seen=[];
  const source = createViewerDataSource(async (path,options) => {
    seen.push(path);assert.equal(options.signal,signal);options.signal.throwIfAborted();
  });
  await assert.rejects(source.search(field,signal), {name:"AbortError"});
  await assert.rejects(source.loadSaved("id/with space",signal), {name:"AbortError"});
  await assert.rejects(source.resolveName("name",signal), {name:"AbortError"});
  assert.equal(seen[1],"/api/comparisons/id%2Fwith%20space");
});
