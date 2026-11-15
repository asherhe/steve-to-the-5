/** Production app in Chromium with intercepted auth/catalog/findings responses.
 * Real retained image bytes are replayed; simulated users/reviews are never sent to a service.
 * The separate PGlite test exercises API + SQL enforcement. This is not hosted auth verification.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.VIEWER_TEST_URL ?? 'http://127.0.0.1:5188';
const root = new URL('../../../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const response = await json('fixtures/archive/real-wise0855/response.json');
const comparison = response.comparison;
const manifest = await json(`fixtures/archive/real-wise0855/evidence/manifests/${comparison.id}.json`);
const flow = await json('services/findings/fixtures/candidate-flow.json');
const output = new URL('.local-test-temp/masterplan-browser/', root);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
let finding = null, review = null, posts = 0, replies = 0, boardLoads = 0;
const requests = [], errors = [];
let failImage = false, failReview = false, slowReview = false;
const authOrigin = 'http://127.0.0.1:18999';
function authSession(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated' })).toString('base64url');
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture-signature`, token_type: 'bearer', refresh_token: 'fixture-refresh', expires_in: 3600,
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'private@example.test', user_metadata: { display_name: userId === '33333333-3333-4333-8333-333333333333' ? 'Observer One' : 'Observer Two' } } };
}
async function contextFor(userId, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600, permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => { localStorage.setItem('spherex.tutorial.review-v1.seen', '1'); });
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === authOrigin) {
      if (u.pathname.endsWith('/otp')) return route.fulfill({ json: {} });
      if (u.pathname.endsWith('/verify') || u.pathname.endsWith('/token')) return route.fulfill({ json: authSession(userId) });
      if (u.pathname.endsWith('/user')) return route.fulfill({ json: authSession(userId).user });
      if (u.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
      return route.fulfill({ status: 404, json: {} });
    }
    if (u.origin !== origin) return route.abort();
    if (!u.pathname.startsWith('/api/')) return route.continue();
    requests.push({ path: u.pathname, query: u.search, method: req.method() });
    if (u.pathname.includes('/assets/')) {
      if (failImage) return route.fulfill({ status: 404 });
      const hash = manifest.assets[u.pathname.split('/').at(-1)];
      return hash ? route.fulfill({ contentType: 'image/png', body: await readFile(new URL(`fixtures/archive/real-wise0855/evidence/blobs/${hash}`, root)) }) : route.fulfill({ status: 404 });
    }
    if (u.pathname === '/api/findings/auth/config') return route.fulfill({ json: { url: authOrigin, publishableKey: 'test-only-publishable-key' } });
    if (u.pathname === '/api/findings/leaderboard') {
      boardLoads++;
      return route.fulfill({ json: { board: u.searchParams.get('board'), placeholder: false, entries: finding ? [{ ...flow.leaderboard.entries[0], id: finding.id, findingId: finding.id, comparisonId: finding.comparisonId, survey: finding.survey, title: finding.title, displayName: 'Observer One' }] : [] } });
    }
    if (u.pathname === '/api/findings/reviews') {
      assert(req.headers().authorization, 'Review must carry a session token');
      if (failReview) return route.fulfill({ status: 503, json: { code: 'catalogs_unavailable', message: 'Catalog review could not complete.' } });
      const input = req.postDataJSON();
      review = { ...structuredClone(flow.review), ...input, observedAtUtc: comparison.frames.find(f => f.id === input.frameId).observedAtUtc };
      Object.assign(review.catalogReview, { ra: input.ra, dec: input.dec, radiusArcsec: input.radiusArcsec, observedAtUtc: review.observedAtUtc });
      if (slowReview) await new Promise(r => setTimeout(r, 500));
      return route.fulfill({ status: 201, json: review });
    }
    if (u.pathname === '/api/findings' && req.method() === 'POST') {
      assert(req.headers().authorization, 'Finding must carry a session token');
      const input = req.postDataJSON();
      assert.equal(input.reviewId, review.id); assert.equal(input.survey, review.survey);
      assert(input.marks.some(m => m.frameId === review.frameId && m.ra === review.ra && m.dec === review.dec));
      assert(!('score' in input));
      if (finding) return route.fulfill({ status: 409, json: { code: 'duplicate_candidate', message: 'You already shared this reviewed image position.' } });
      posts++; finding = { ...input, id: flow.leaderboard.entries[0].id, authorDisplayName: 'Observer One', createdAtUtc: new Date().toISOString(), replies: [], candidateReview: review };
      return route.fulfill({ status: 201, json: { id: finding.id } });
    }
    if (u.pathname.endsWith('/replies')) {
      assert(req.headers().authorization); replies++;
      const reply = { id: 'reply-2', authorDisplayName: 'Observer Two', createdAtUtc: new Date().toISOString(), text: req.postDataJSON().text };
      finding.replies.push(reply); return route.fulfill({ status: 201, json: reply });
    }
    if (finding && u.pathname === `/api/findings/${finding.id}`) return route.fulfill({ json: finding });
    if (u.pathname === '/api/findings') return route.fulfill({ json: { items: finding ? [{ id: finding.id, title: finding.title, ra: finding.ra, dec: finding.dec }] : [] } });
    if (u.pathname.startsWith('/api/findings/')) return route.fulfill({ status: 404, json: { code: 'finding_not_found', message: 'Finding not found.' } });
    if (u.pathname === `/api/comparisons/${comparison.id}` || u.pathname === `/api/wise/comparisons/${comparison.id}`) return route.fulfill({ json: response });
    if (u.pathname === '/api/catalogs/nearby') return route.fulfill({ headers: { 'X-SPHEREx-Catalog-Mode': 'live' }, json: { sources: [] } });
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', e => errors.push({ message: String(e), stack: e.stack ?? '' }));
  return { page, context };
}
const press = (page, name) => page.getByRole('button', { name, exact: true }).press('Enter');
async function signIn(page) {
  const pane = page.locator('#account-panel');
  await pane.getByLabel('Email', { exact: true }).fill('observer@example.test');
  await pane.getByRole('button', { name: 'Send sign-in email', exact: true }).press('Enter');
  await pane.getByLabel('Email code').fill('123456');
  await pane.getByRole('button', { name: 'Verify code', exact: true }).press('Enter');
  await pane.waitFor({ state: 'hidden' });
}
const checks = [];
try {
  const { page, context } = await contextFor('33333333-3333-4333-8333-333333333333');
  await page.goto(origin);
  await press(page, 'Time'); await press(page, 'Open saved real example');
  await page.locator('.comparison-frame img').evaluate(img => img.decode());
  const image = page.locator('.comparison-frame img');
  assert.equal(await image.evaluate(img => img.naturalWidth), comparison.grid.width);
  assert((await image.boundingBox()).width > 300, 'Example must have a useful enlarged display');
  await page.screenshot({ path: new URL('desktop-example.png', output).pathname });
  // Enlarged image controls continue working when the Time pane is closed.
  await press(page, 'Close Time');
  await press(page, 'Blink image dates');
  const firstBlinkImage = await page.locator('.comparison-frame img').getAttribute('src');
  await page.waitForFunction(src => document.querySelector('.comparison-frame img')?.getAttribute('src') !== src, firstBlinkImage);
  await press(page, 'Pause image blink');
  await press(page, 'Time');
  checks.push('saved six-arcminute example, unchanged native pixels, independent image blink');
  await press(page, 'Inspect image. Press Enter to inspect its center.');
  await press(page, 'Review this point'); await press(page, 'Sign in to review');
  assert.equal(requests.filter(x => x.path === '/api/findings/reviews').length, 0);
  assert(new URL(page.url()).searchParams.has('reviewFrame'));
  await signIn(page);
  await page.reload();
  await page.getByRole('button', { name: 'Run six catalog checks', exact: true }).waitFor();
  checks.push('sign-in return restores survey, image frame and selection');
  failReview = true;
  await press(page, 'Run six catalog checks'); await page.getByText('Catalog review could not complete.', { exact: true }).waitFor();
  failReview = false; await press(page, 'Run six catalog checks');
  await page.getByRole('heading', { name: '50 participation points', exact: true }).waitFor();
  await page.locator('#review-panel').screenshot({ path: new URL('desktop-review.png', output).pathname });
  const originalFrame = review.frameId;
  await page.getByLabel('Title', { exact: true }).fill('Could this point be an artifact?');
  await page.getByLabel('Note', { exact: true }).fill('Please compare the saved dates and review the catalog context.');
  await press(page, 'Post finding');
  await page.locator('#leaderboard-panel').getByRole('heading', { name: finding.title, exact: true }).waitFor();
  assert.equal(posts, 1); assert(boardLoads > 0); assert.equal(finding.marks[0].frameId, originalFrame);
  await page.locator('#leaderboard-panel').getByText('50 points', { exact: true }).waitFor();
  await page.screenshot({ path: new URL('desktop-discussion.png', output).pathname });
  await press(page, 'Copy link'); const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(new URL(copied).searchParams.get('finding'), finding.id);
  assert(!copied.includes('reviewFrame')); assert(!copied.includes('code='));
  checks.push('review retry, score, locked mark, post, refreshed ranking, discussion and copy link');
  const second = await contextFor('44444444-4444-4444-8444-444444444444', { width: 390, height: 844 });
  await second.page.goto(copied);
  await second.page.getByRole('heading', { name: finding.title, exact: true }).waitFor();
  await second.page.getByRole('img', { name: 'Saved finding mark', exact: true }).waitFor();
  const before = await second.page.locator('.comparison-frame img').getAttribute('src');
  assert.equal(before, comparison.frames.find(f => f.id === originalFrame).imageUrl);
  await second.page.getByLabel('Reply', { exact: true }).fill('I can replay the original dates. The point may be an artifact.');
  await press(second.page, 'Sign in to reply'); assert.equal(replies, 0);
  await signIn(second.page); await press(second.page, 'Reply');
  await second.page.getByText('Observer Two', { exact: true }).waitFor(); assert.equal(replies, 1);
  await second.page.screenshot({ path: new URL('mobile-discussion.png', output).pathname });
  // Real touch input and keyboard pane movement, with no page overflow.
  const tourButton = second.page.getByRole('button', { name: /How this works/ });
  await tourButton.scrollIntoViewIfNeeded(); await tourButton.tap();
  await second.page.getByRole('button', { name: 'Close tour', exact: true }).tap();
  const mobilePane = second.page.locator('#comparison-panel');
  const mobileBox = await mobilePane.boundingBox();
  assert(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 391);
  assert.equal(await second.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobilePane.getByRole('button', { name: 'Move Compare details window', exact: true }).press('ArrowLeft');
  checks.push('fresh anonymous mobile replay, original mark, sign-in gate, second-user reply, touch and keyboard panes');
  // Identity, not whichever view happened to be active, selects WISE's saved store.
  finding.survey = 'wise'; finding.candidateReview = { ...finding.candidateReview, survey: 'wise' };
  const third = await contextFor('44444444-4444-4444-8444-444444444444');
  const start = requests.length;
  await third.page.goto(`${origin}/?finding=${finding.id}`);
  await third.page.getByRole('heading', { name: finding.title, exact: true }).waitFor();
  assert.equal(new URL(third.page.url()).searchParams.get('view'), 'wise');
  assert(requests.slice(start).some(r => r.path === `/api/wise/comparisons/${comparison.id}`));
  assert(!requests.slice(start).some(r => r.path === `/api/comparisons/${comparison.id}`));
  await press(third.page, 'Copy link'); const wiseLink = await third.page.evaluate(() => navigator.clipboard.readText());
  assert.equal(new URL(wiseLink).searchParams.get('view'), 'wise');
  await third.page.goto(wiseLink); await third.page.getByRole('heading', { name: finding.title, exact: true }).waitFor();
  checks.push('finding-only WISE identity redirect and copied-link reload');
  await third.page.goto(`${origin}/?comparison=wrong&finding=${finding.id}`);
  await third.page.getByText(/This finding belongs to a different comparison/).first().waitFor();
  await third.page.goto(`${origin}/?finding=missing`);
  await third.page.getByText(/not found|could not be reached/i).first().waitFor();
  checks.push('mismatched and missing IDs fail visibly');
  // Selection changes abort the pending review and cannot reuse its response.
  finding = null;
  await page.goto(`${origin}/?comparison=${comparison.id}`); await press(page, 'Comparison');
  await page.locator('.comparison-frame img').evaluate(img => img.decode());
  await press(page, 'Inspect image. Press Enter to inspect its center.'); await press(page, 'Review this point');
  slowReview = true; await press(page, 'Run six catalog checks'); await press(page, 'Next observation');
  await page.waitForTimeout(650);
  assert.equal(await page.getByRole('heading', { name: '50 participation points' }).count(), 0); slowReview = false;
  checks.push('late responses cannot attach to another active frame');
  failImage = true;
  await page.goto(`${origin}/?comparison=${comparison.id}`); await press(page, 'Comparison');
  await page.locator('#comparison-panel').getByRole('button', { name: 'Retry frame', exact: true }).waitFor();
  failImage = false; await page.locator('#comparison-panel').getByRole('button', { name: 'Retry frame', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Inspect image. Press Enter to inspect its center.', exact: true }).waitFor();
  checks.push('broken image retry preserves comparison');
  const externalMapErrors = errors.filter(e => /aladin-/.test(e.stack) && /Failed to fetch|HiPS.*error/.test(e.message));
  assert.deepEqual(errors.filter(e => !externalMapErrors.includes(e)), [], 'Unexpected application error');
  await writeFile(new URL('result.json', output), JSON.stringify({ kind: 'local-production-browser-with-simulated-services', checks, externalMapErrors, applicationErrors: [] }, null, 2));
  console.log(JSON.stringify({ passed: checks, screenshots: output.pathname }, null, 2));
  await context.close(); await second.context.close(); await third.context.close();
} catch (error) {
  console.error(error);
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: new URL('failure.png', output).pathname }).catch(() => {});
  throw error;
} finally { await browser.close(); }
