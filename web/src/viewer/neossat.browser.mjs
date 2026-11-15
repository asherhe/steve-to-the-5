// Intercepted synthetic data verifies panel behavior; this is not a live archive check.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const origin = process.env.VIEWER_TEST_URL ?? "http://127.0.0.1:5173";
const fixture = JSON.parse(await readFile(new URL("../../../fixtures/catalogs/neossat.json", import.meta.url), "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem("spherex.tutorial.review-v1.seen", "1"));
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const calls = [];
  let mode = "ready", failImage = false, imageRequests = 0;
  await page.route("**/api/catalogs/neossat?*", async route => {
    const params = new URL(route.request().url()).searchParams;
    const position = { ra: Number(params.get("ra")), dec: Number(params.get("dec")) };
    calls.push(position);
    if (mode === "outage") return route.fulfill({ status: 503, json: { code: "upstream_unavailable", message: "Unavailable" } });
    await route.fulfill({ json: { ...fixture, position, images: mode === "empty" ? [] : fixture.images,
      retrievedAtUtc: `2026-11-15T14:00:${String(calls.length).padStart(2, "0")}Z`, truncated: mode === "limited" } });
  });
  await page.route("https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/data/pub/NEOSSAT/**", async route => {
    imageRequests++;
    if (failImage) return route.fulfill({ status: 503, body: "Unavailable" });
    await route.fulfill({ contentType: "image/png", path: new URL("./harness/epoch-one.png", import.meta.url).pathname });
  });
  async function search(text) {
    await page.getByRole("combobox", { name: "Object name or coordinates", exact: true }).fill(text);
    await page.getByRole("button", { name: "Search", exact: true }).click();
  }
  await page.goto(origin + "/?fixtures=1");
  // Close first-run tutorial if this browser has not dismissed it under the current key.
  const tutorialClose = page.getByRole("button", { name: /Close tour/ });
  if (await tutorialClose.count()) await tutorialClose.first().click();
  const button = page.getByRole("button", { name: "NEOSSat", exact: true });
  const panel = page.getByRole("region", { name: "NEOSSat", exact: true });
  await button.click();
  assert(await panel.getByRole("button", { name: "Refresh", exact: true }).isDisabled());
  assert.equal(calls.length, 0);
  await panel.getByRole("button", { name: "Close NEOSSat", exact: true }).click();
  await search("10, 20");
  await button.click();
  await panel.getByText("synthetic-neossat-1 · CORD", { exact: true }).waitFor();
  await panel.locator("img").evaluate(image => image.decode());
  assert.deepEqual(calls, [{ ra: 10, dec: 20 }]);
  // Panning/zooming, playback, collapse and reopening must preserve the snapshot.
  const imagesBefore = imageRequests;
  await panel.getByRole("button", { name: "Collapse NEOSSat", exact: true }).click();
  await panel.getByRole("button", { name: "Expand NEOSSat", exact: true }).click();
  await panel.getByRole("button", { name: "Close NEOSSat", exact: true }).click();
  await button.click();
  await page.getByRole("button", { name: "Reset layout", exact: true }).click();
  await page.locator(".sky-map").dispatchEvent("wheel", { deltaY: -100 });
  await search("11, 21");
  await panel.getByText(/The selection has changed/).waitFor();
  assert.equal(calls.length, 1); assert.equal(imageRequests, imagesBefore);
  assert.match(await panel.locator(".neossat-loaded").innerText(), /RA 10.000000/);
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.locator(".neossat-loaded").filter({ hasText: "RA 11.000000" }).waitFor();
  assert.deepEqual(calls[1], { ra: 11, dec: 21 });
  // An outage retains successful images; the same button recovers to an explicit empty search.
  mode = "outage";
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.locator("img").count(), 1);
  mode = "empty";
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.getByText(/No public NEOSSat previews were returned/).waitFor();
  assert.equal(await panel.locator("img").count(), 0);
  mode = "limited"; failImage = true;
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.getByText(/Preview unavailable/).waitFor();
  await panel.getByText(/showing a limited selection/).waitFor();
  failImage = false;
  const recoveryNumber = calls.length + 1;
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(expected => document.querySelector("#neossat-panel .neossat-loaded time")?.dateTime === expected,
    `2026-11-15T14:00:${String(recoveryNumber).padStart(2, "0")}Z`);
  await panel.locator("img").evaluate(image => image.decode());
  await page.screenshot({ path: "/tmp/neossat-desktop.png" });
  await panel.getByRole("button", { name: "Move NEOSSat window", exact: true }).focus();
  const before = await panel.boundingBox();
  await page.keyboard.press("ArrowLeft");
  assert(Math.abs((await panel.boundingBox()).x - before.x + 20) < 1);
  await page.keyboard.press("Escape");
  assert.equal(await panel.isVisible(), false);
  assert(await button.evaluate(element => element === document.activeElement));
  await button.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const box = document.querySelector("#neossat-panel").getBoundingClientRect();
    return box.x >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
  });
  await page.screenshot({ path: "/tmp/neossat-mobile.png" });
  console.log("PASS: first-open fetch, selected-position refresh, no automatic updates, reopen/collapse/layout retention, outage retention, empty results, capped results, broken-image retry, keyboard movement/focus and mobile bounds.");
} finally { await browser.close(); }
