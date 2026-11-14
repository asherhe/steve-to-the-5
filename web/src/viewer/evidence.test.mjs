import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceLink, validateFinding } from "./evidence.ts";

const comparison = { id: "saved-v1", frames: [{ id: "early" }, { id: "late" }] };
const finding = { id: "pin", comparisonId: "saved-v1", marks: [
  { frameId: "early", ra: 120, dec: 15 }, { frameId: "late", ra: 119.99, dec: 15 },
] };

test("evidence link retains harness mode and carries both durable IDs", () => {
  const url = new URL(evidenceLink("http://localhost/?fixtures=1&comparison=old&finding=old", "saved-v1", "pin"));
  assert.equal(url.searchParams.get("fixtures"), "1");
  assert.equal(url.searchParams.get("comparison"), "saved-v1");
  assert.equal(url.searchParams.get("finding"), "pin");
});
test("comparison-only sharing removes stale finding IDs", () => {
  const url = new URL(evidenceLink("http://localhost/?finding=old", "new"));
  assert.equal(url.searchParams.has("finding"), false);
});
test("valid saved marks preserve their recorded frames without mutation", () => {
  const before = JSON.stringify(finding);
  validateFinding(finding, comparison);
  assert.equal(JSON.stringify(finding), before);
});
test("mismatched comparison and missing frame IDs are rejected", () => {
  assert.throws(() => validateFinding(finding, { ...comparison, id: "other" }), /different comparison/);
  assert.throws(() => validateFinding({ ...finding, marks: [{ frameId: "unknown", ra: 120, dec: 15 }] }, comparison), /invalid saved frame/);
});
test("nonfinite and out-of-bounds sky coordinates are rejected", () => {
  for (const [ra, dec] of [[NaN, 15], [Infinity, 15], [-1, 15], [360, 15], [120, 91]]) {
    assert.throws(() => validateFinding({ ...finding, marks: [{ frameId: "early", ra, dec }] }, comparison));
  }
});
