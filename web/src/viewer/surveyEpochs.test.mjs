import assert from "node:assert/strict";
import test from "node:test";
import { surveyEpochs, timeShiftNotice } from "./surveyEpochs.ts";

test("switching maps reports the direction and size of the jump in time", () => {
  assert.match(timeShiftNotice("spherex", "dss"), /^Back about 39 years in time: DSS2 images were taken 1975–1998/);
  assert.match(timeShiftNotice("dss", "spherex"), /^Forward about 39 years in time: SPHEREx DR1 images were taken 2025–2026/);
  assert.match(timeShiftNotice("spherex", "wise"), /^Back about 15 years in time: AllWISE/);
  assert.match(timeShiftNotice("wise", "spherex"), /^Forward about 15 years/);
  assert.match(timeShiftNotice("wise", "dss"), /^Back about 24 years/);
  assert.match(timeShiftNotice("dss", "wise"), /^Forward about 24 years/);
});

test("the notice names both surveys' dates and the reason objects move", () => {
  const notice = timeShiftNotice("spherex", "dss");
  assert.match(notice, /compared with 2025–2026 for SPHEREx DR1/);
  assert.match(notice, /varies across the sky/);
  assert.match(notice, /Fast-moving stars appear in a different spot\.$/);
});

test("no notice when the map does not change", () => {
  for (const survey of Object.keys(surveyEpochs)) assert.equal(timeShiftNotice(survey, survey), null);
});

test("survey dates stay in their documented order", () => {
  assert.ok(surveyEpochs.dss.year < surveyEpochs.wise.year && surveyEpochs.wise.year < surveyEpochs.spherex.year);
});
