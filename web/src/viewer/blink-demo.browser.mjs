// Real retained evidence through actual local HTTP services; no archive API mocks.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const origin = process.env.VIEWER_TEST_URL ?? "http://127.0.0.1:5178";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => localStorage.setItem("spherex.tutorial.review-v1.seen", "1"));
  const requests = [], errors = [];
  page.on("pageerror", error => { if (error.message !== "Failed to fetch") errors.push(error.message); });
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.includes("/comparisons")) requests.push(url);
  });
  // Demonstrate playback while external map/reference services are unavailable.
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const waitBlink = () => page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "Blink A ↔ B" && !b.disabled));
  await page.goto(`${origin}/?view=wise`);
  await page.getByRole("button", { name: "Time", exact: true }).click();
  await page.getByRole("button", { name: "Open saved real example", exact: true }).click();
  await waitBlink();
  await page.getByText(/Saved real WISE W2 example/).waitFor();
  const date = await page.locator(".active-date time").getAttribute("datetime");
  assert.ok(date.startsWith("2010-05-04"));
  await page.getByRole("button", { name: "Blink A ↔ B", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".active-date time")?.getAttribute("datetime")?.startsWith("2024-04-16"));
  await mkdir(".cache/blink-demo", { recursive: true });
  await page.screenshot({ path: ".cache/blink-demo/wise.png", fullPage: true });
  await page.getByRole("button", { name: "DSS", exact: true }).click();
  await page.locator(".time-controls").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "SPHEREx", exact: true }).click();
  if (!await page.getByRole("button", { name: "Open saved real example", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Time", exact: true }).click();
  }
  await page.getByRole("button", { name: "Open saved real example", exact: true }).click();
  await waitBlink();
  assert.ok((await page.locator(".active-date time").getAttribute("datetime")).startsWith("2025-05-06"));
  await page.screenshot({ path: ".cache/blink-demo/spherex.png", fullPage: true });
  assert.ok(requests.some(url => url.pathname.startsWith("/api/wise/comparisons/")));
  assert.ok(requests.some(url => url.pathname.startsWith("/api/comparisons/")));
  assert.ok(requests.every(url => !["/api/comparisons", "/api/wise/comparisons"].includes(url.pathname)), "Example playback must not start discovery");
  assert.deepEqual(errors, []);
  console.log("PASS: actual local services replay real WISE and SPHEREx examples, WISE dates advance, DSS disables playback, and no discovery requests are made.");
} finally { await browser.close(); }
