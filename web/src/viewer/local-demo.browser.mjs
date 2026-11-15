/** Local development workflow with real retained pixels and browser-only findings. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.VIEWER_TEST_URL ?? 'http://127.0.0.1:5173';
const root = new URL('../../../', import.meta.url);
const liveArchive = process.env.LOCAL_REAL_ARCHIVE === '1';
const response = JSON.parse(await readFile(new URL('fixtures/archive/real-barnard/response.json', root)));
const comparison = response.comparison;
const record = JSON.parse(await readFile(new URL(`fixtures/archive/real-barnard/evidence/manifests/${comparison.id}.json`, root)));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const apiCalls = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/findings')) { apiCalls.push(url.pathname); return route.fulfill({ status: 599 }); }
    if (liveArchive && url.pathname.startsWith('/api/comparisons')) return route.continue();
    if (url.pathname === `/api/comparisons/${comparison.id}`) return route.fulfill({ json: response });
    if (url.pathname.startsWith(`/api/comparisons/${comparison.id}/assets/`)) {
      const sha = record.assets[url.pathname.split('/').at(-1)];
      return sha ? route.fulfill({ contentType: 'image/png', body: await readFile(new URL(`fixtures/archive/real-barnard/evidence/blobs/${sha}`, root)) }) : route.fulfill({ status: 404 });
    }
    if (url.pathname === '/api/comparisons') return route.fulfill({ json: response });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503 });
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  await page.addInitScript(() => localStorage.setItem('spherex.tutorial.review-v1.seen', '1'));
  await page.goto(origin);
  assert.equal(await page.getByRole('group', { name: 'Sky survey' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Time', exact: true }).click();
  await page.getByRole('button', { name: 'Open saved real example' }).click();
  await page.getByText('Barnard’s Star field:', { exact: false }).first().waitFor();
  await page.locator('.comparison-frame img').evaluate(img => img.decode());
  assert.equal(await page.locator('.comparison-frame img').evaluate(img => img.naturalWidth), 59);
  await page.getByRole('button', { name: 'Inspect image. Press Enter to inspect its center.' }).press('Enter');
  await page.getByRole('button', { name: 'Review this point' }).click();
  await page.getByRole('button', { name: 'Run simulated catalog checks' }).click();
  await page.getByRole('heading', { name: '20 participation points' }).waitFor();
  await page.getByLabel('Title').fill('Inspect a possible point');
  await page.getByLabel('Note').fill('Check whether this is a source or an artifact.');
  await page.getByRole('button', { name: 'Post finding' }).click();
  await page.getByRole('heading', { name: 'Inspect a possible point' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Inspect a possible point' }).waitFor();
  await page.getByRole('textbox', { name: 'Reply', exact: true }).fill('The saved frames are available.');
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByText('The saved frames are available.').waitFor();
  assert.deepEqual(apiCalls, []);
  console.log(`Local demo passed (${liveArchive ? 'actual local archive' : 'recorded HTTP fixtures'}): saved 59-pixel field, no sign-in, simulated review, post, replay and reply without findings requests.`);
  await context.close();
} finally { await browser.close(); }
