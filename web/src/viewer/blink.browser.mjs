// Synthetic HTTP responses: verifies transport/UI behavior, not archive availability.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const origin = process.env.VIEWER_TEST_URL ?? "http://127.0.0.1:5178";
const fixtures = new URL("../../../fixtures/archive/", import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, fixtures), "utf8"));
const ready = await json("responses/ready.json");
const store = await json(`synthetic/evidence/manifests/${ready.comparison.id}.json`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => localStorage.setItem("spherex.tutorial.review-v1.seen", "1"));
  const calls = [], errors = [];
  // Aladin's intentionally blocked external reference tile fetch can reject.
  page.on("pageerror", error => { if (error.message !== "Failed to fetch") errors.push(error.message); });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname.includes("/assets/")) {
      const name = url.pathname.split("/").at(-1);
      const hash = store.assets[name];
      return hash ? route.fulfill({ contentType: "image/png", body: await readFile(new URL(`synthetic/evidence/blobs/${hash}`, fixtures)) }) : route.fulfill({ status: 404 });
    }
    if (["/api/comparisons", "/api/wise/comparisons"].includes(url.pathname)) {
      calls.push(url);
      return route.fulfill({ json: ready, headers: { "X-Comparison-Source": "saved-cache" } });
    }
    if (url.pathname === "/api/resolve") return route.fulfill({ json: { name: "Test field", ...ready.comparison.field } });
    return route.fulfill({ status: 404, json: { code: "NOT_FOUND", message: "Test service" } });
  });
  await page.goto(origin);
  const input = page.getByRole("combobox", { name: "Object name or coordinates" });
  const search = async text => { await input.fill(text); await page.getByRole("button", { name: "Search", exact: true }).click(); };
  const blink = page.getByRole("button", { name: "Blink A ↔ B", exact: true });
  const waitBlink = () => page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "Blink A ↔ B" && !b.disabled));
  await search("10, 20");
  await waitBlink();
  await page.getByText("Previously built comparison · replayed without an archive search.", { exact: true }).waitFor();
  const date = await page.locator(".active-date time").getAttribute("datetime");
  await blink.click();
  await page.waitForFunction(date => document.querySelector(".active-date time")?.getAttribute("datetime") !== date, date);
  // DSS must remove the controls and dated sky layer and stop fetching comparisons.
  await page.getByRole("button", { name: "DSS", exact: true }).click();
  await page.locator(".time-controls").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "Blink", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Compare this field", exact: true }).count(), 0);
  assert.equal(await page.locator(".dated-footprint").count(), 0);
  const before = calls.length;
  await search("11, 21");
  await search("WISE 0855");
  await page.waitForTimeout(500);
  assert.equal(calls.length, before);
  // Switching back restores the saved pair paused, without another archive search.
  await page.getByRole("button", { name: "SPHEREx", exact: true }).click();
  await waitBlink();
  assert.equal(calls.length, before);
  await page.getByRole("button", { name: "Close Blink", exact: true }).click();
  await page.getByRole("button", { name: "WISE", exact: true }).click();
  await search("10, 20");
  await waitBlink();
  assert.equal(calls.at(-1).pathname, "/api/wise/comparisons");
  assert.equal(calls.at(-1).searchParams.get("mode"), null); // server default is blink
  await page.getByRole("button", { name: "Load longer time-lapse", exact: true }).click();
  await waitBlink();
  assert.equal(calls.at(-1).searchParams.get("mode"), "timeline");
  await page.getByRole("button", { name: "Check archive again", exact: true }).click();
  await waitBlink();
  assert.equal(calls.at(-1).searchParams.get("refresh"), "true");
  assert.equal(calls.at(-1).searchParams.get("mode"), "timeline");
  assert.deepEqual(errors, []);
  console.log("PASS: SPHEREx blink advances dates; DSS removes playback and never builds; survey return is paused; WISE timeline and refresh are explicit; cached evidence is labelled.");
} finally { await browser.close(); }
