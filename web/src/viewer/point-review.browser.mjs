/** Real UI/map interactions, synthetic HiPS and intercepted catalog/auth/findings APIs.
 * No hosted writes or scientific coverage claims. SQL enforcement is tested separately.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.VIEWER_TEST_URL ?? 'http://127.0.0.1:5189';
const demo = process.env.POINT_REVIEW_DEMO === '1';
const flow = JSON.parse(await readFile(new URL('../../../services/findings/fixtures/point-flow.json', import.meta.url), 'utf8'));
const output = process.env.POINT_REVIEW_OUTPUT ?? `/tmp/point-v3-browser-${demo ? 'demo' : 'live-ui'}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const bootstrap = await browser.newPage();
const [overview, fine] = (await bootstrap.evaluate(() => {
  const canvas = document.createElement('canvas'); canvas.width = 1728; canvas.height = 1856;
  let ctx = canvas.getContext('2d'); ctx.fillStyle = '#151b22'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const atlas = canvas.toDataURL().split(',')[1]; canvas.width = canvas.height = 512;
  ctx = canvas.getContext('2d'); ctx.fillStyle = '#151b22'; ctx.fillRect(0, 0, 512, 512);
  return [atlas, canvas.toDataURL().split(',')[1]];
})).map(value => Buffer.from(value, 'base64'));
await bootstrap.close();
const properties = ['creator_did = ivo://IPAC/P/SPHEREx/DR1/cube', 'hips_frame = equatorial', 'hips_order = 5', 'hips_order_min = 0',
  'hips_tile_width = 512', 'hips_tile_format = png', 'moc_sky_fraction = 1', 'dataproduct_type = cube', 'hips_cube_depth = 102',
  'hips_cube_firstframe = 1', 'em_min = 7.43e-7', 'em_max = 5.009e-6'].join('\n');
const authOrigin = 'http://127.0.0.1:18999';
let finding = null, review = null, mode = 'known', outage = false, racing = false, posts = 0;
let listedCatalogs = true;
const requests = [], errors = [], checks = [], externalBlocked = [];
function authSession(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now()/1000) + 3600, role: 'authenticated' })).toString('base64url');
  return { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`, token_type: 'bearer', refresh_token: 'fixture-refresh', expires_in: 3600,
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'private@example.test', user_metadata: { display_name: userId.endsWith('3') ? 'Observer One' : 'Observer Two' } } };
}
function catalogAt(point, listed = false, observedAtUtc = null) {
  const report = structuredClone(flow.known.catalogReview);
  Object.assign(report, { ra: point.ra, dec: point.dec, radiusArcsec: point.radiusArcsec ?? 30, observedAtUtc });
  const common = { ra: point.ra, dec: point.dec };
  const rows = [{ sourceId: '42', ...common, refEpoch: 2016, pmRaCosDecMasYr: 0, pmDecMasYr: 0 },
    { main_id: 'Synthetic SIMBAD', ...common }, { source_name: 'Synthetic CatWISE', ...common },
    { name: 'Synthetic ultracool', ra_j2000_formula: point.ra, dec_j2000_formula: point.dec },
    { Name: 'Synthetic asteroid', RA: point.ra, DEC: point.dec }, { AllWISE: 'Synthetic AllWISE', RAJ2000: point.ra, DEJ2000: point.dec }];
  report.checks.forEach((check, i) => { check.status = listed ? 'candidates' : check.catalog === 'SkyBoT' && !observedAtUtc ? 'skipped' : 'no_candidates'; check.rows = listed ? [rows[i]] : []; });
  return report;
}
async function newContext(userId, mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, hasTouch: mobile,
    permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(() => localStorage.setItem('spherex.tutorial.review-v1.seen', '1'));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === authOrigin) {
      if (url.pathname.endsWith('/otp')) return route.fulfill({ json: {} });
      if (url.pathname.endsWith('/verify') || url.pathname.endsWith('/token')) return route.fulfill({ json: authSession(userId) });
      if (url.pathname.endsWith('/user')) return route.fulfill({ json: authSession(userId).user });
      if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
      return route.fulfill({ status: 404 });
    }
    if (url.pathname.includes('/spherex_allsky_cube/')) {
      const headers = { 'access-control-allow-origin': '*' };
      if (url.pathname.endsWith('/properties')) return route.fulfill({ headers, contentType: 'text/plain', body: properties });
      if (/Allsky_\d+\.png$/.test(url.pathname)) return route.fulfill({ headers, contentType: 'image/png', body: overview });
      if (url.pathname.endsWith('.png')) return route.fulfill({ headers, contentType: 'image/png', body: fine });
      return route.fulfill({ headers, status: 404 });
    }
    if (url.pathname === '/cgi/AladinLiteLogger/log.py') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '' });
    if (url.origin !== origin) { externalBlocked.push(url.href); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ path: url.pathname, method: req.method() });
    if (url.pathname === '/api/catalogs/review') return route.fulfill({ json: catalogAt({ ra: Number(url.searchParams.get('ra')), dec: Number(url.searchParams.get('dec')), radiusArcsec: Number(url.searchParams.get('radiusArcsec')) }, listedCatalogs, url.searchParams.get('observedAtUtc')) });
    if (url.pathname === '/api/catalogs/nearby') return route.fulfill({ headers: { 'X-SPHEREx-Catalog-Mode': 'live' }, json: { sources: [] } });
    if (url.pathname === '/api/findings/auth/config') return route.fulfill({ json: { url: authOrigin, publishableKey: 'test-only-key' } });
    if (url.pathname === '/api/findings/points/review') {
      assert(req.headers().authorization, 'Point review must be signed in');
      if (outage) return route.fulfill({ status: 503, json: { code: 'catalogs_unavailable', message: 'Synthetic archive check unavailable.' } });
      const input = req.postDataJSON(); assert(!input.frame, 'Plain-map review must not invent a saved frame');
      review = { ...structuredClone(flow[mode]), ...input, observedAtUtc: null, frame: null, catalogReview: catalogAt(input, mode === 'known' || mode === 'duplicate') };
      review.reasons = review.reasons.map(reason => reason.replaceAll('30″', `${input.radiusArcsec}″`));
      if (mode === 'known' || mode === 'duplicate') {
        review.catalogReview = catalogAt(input, false);
        review.catalogReview.checks[0].status = 'candidates';
        review.catalogReview.checks[0].rows = [{ sourceId: '42', ra: input.ra, dec: input.dec }];
      }
      if (mode === 'known') review.identity = { catalog: 'Gaia DR3', name: '42', ra: input.ra, dec: input.dec, separationArcsec: 0 };
      if (mode === 'duplicate' && finding) review.duplicate = { ...flow.duplicate.duplicate, findingId: finding.id, title: finding.title };
      return route.fulfill({ status: 201, json: review });
    }
    if (url.pathname === '/api/findings' && req.method() === 'POST') {
      const input = req.postDataJSON();
      assert(req.headers().authorization); assert.equal(input.reviewId, review.id);
      assert.deepEqual(Object.keys(input).sort(), ['dec', 'note', 'ra', 'reviewId', 'title']);
      if (racing) return route.fulfill({ status: 409, json: { code: 'already_on_leaderboard', message: 'Another observer submitted this object.' } });
      posts++;
      finding = { ...input, id: '22222222-2222-4222-8222-222222222222', comparisonId: null, marks: [], replies: [], survey: 'spherex',
        authorDisplayName: 'Observer One', createdAtUtc: new Date().toISOString(), candidateReview: review };
      return route.fulfill({ status: 201, json: { id: finding.id } });
    }
    if (url.pathname.endsWith('/replies') && finding) {
      assert(req.headers().authorization);
      const reply = { id: 'reply-2', authorDisplayName: 'Observer Two', text: req.postDataJSON().text, createdAtUtc: new Date().toISOString() };
      finding.replies.push(reply); return route.fulfill({ status: 201, json: reply });
    }
    if (finding && url.pathname === `/api/findings/${finding.id}`) return route.fulfill({ json: finding });
    if (url.pathname === '/api/findings/leaderboard') return route.fulfill({ json: { board: url.searchParams.get('board'), placeholder: false,
      entries: finding ? [{ id: finding.id, findingId: finding.id, comparisonId: null, fovArcmin: null, survey: 'spherex', rank: 1, displayName: finding.authorDisplayName,
        title: finding.title, rarityScore: finding.candidateReview.score, tier: null, reasons: finding.candidateReview.reasons, ra: finding.ra, dec: finding.dec, enteredAtUtc: finding.createdAtUtc }] : [] } });
    if (url.pathname === '/api/findings') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ status: 404, json: { code: 'not_found', message: 'Not found.' } });
  });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push({ message: String(error), stack: error.stack ?? '' }));
  return { context, page };
}
const press = (page, name) => page.getByRole('button', { name, exact: true }).press('Enter');
async function signIn(page) {
  const pane = page.locator('#account-panel');
  await pane.getByLabel('Email', { exact: true }).fill('observer@example.test');
  await pane.getByRole('button', { name: 'Send sign-in email', exact: true }).press('Enter');
  await pane.getByLabel('Email code').fill('123456'); await pane.getByRole('button', { name: 'Verify code', exact: true }).press('Enter');
  await pane.waitFor({ state: 'hidden' });
}
async function compose(page, title) {
  const pane = page.locator('#review-panel');
  await pane.getByLabel('Title', { exact: true }).fill(title); await pane.getByLabel('Note', { exact: true }).fill('Please review this sky position.');
  await pane.getByRole('button', { name: 'Post finding', exact: true }).press('Enter');
}
try {
  const { page } = await newContext('33333333-3333-4333-8333-333333333333');
  await page.goto(origin);
  await page.locator('.aladin-host:not([data-hidden])').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Gaia', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Review candidate', exact: true }).count(), 0);
  await page.mouse.click(700, 400); await page.locator('#gaia-panel').waitFor();
  assert.equal(await page.locator('#point-check-panel').isVisible(), false);
  await press(page, 'Close Source inspector');
  await page.mouse.dblclick(700, 400); await page.locator('#point-check-panel').waitFor();
  await page.getByRole('img', { name: /^Marked point RA/ }).waitFor();
  const sources = page.locator('.point-check__gaia details');
  await sources.nth(5).getByRole('button', { name: 'Show on map', exact: true }).waitFor();
  assert.equal(await sources.count(), 6);
  for (let i = 0; i < 6; i++) {
    await sources.nth(i).getByRole('button', { name: 'Show on map', exact: true }).press('Enter');
    assert(await sources.nth(i).getByRole('button', { name: 'Hide', exact: true }).isVisible());
    if (i > 0) await page.getByLabel('Shown catalog positions').waitFor();
  }
  await page.locator('#point-check-panel .point-check__controls select').selectOption('120');
  await page.mouse.dblclick(900, 450);
  await page.waitForFunction(() => document.querySelector('#point-check-panel .point-check__controls select')?.value === '30');
  await page.locator('#point-check-panel .point-check__controls select').selectOption('120');
  checks.push('single-click inspection, double-click point mark, all six catalog map markers');
  await press(page, 'Submit to leaderboard');
  if (!demo) {
    await press(page, 'Sign in to submit'); assert.equal(requests.filter(r => r.path.endsWith('/points/review')).length, 0);
    assert.equal(new URL(page.url()).searchParams.get('reviewRadius'), '120'); assert(!new URL(page.url()).searchParams.has('comparison'));
    await signIn(page); await page.reload();
    outage = true; await press(page, 'Check and score this point'); await page.getByText('Synthetic archive check unavailable.', { exact: true }).waitFor();
    outage = false; await press(page, 'Check and score this point');
  } else await press(page, 'Run simulated catalog checks');
  await page.locator('#review-panel').getByRole('heading', { name: /^10 points/ }).waitFor();
  assert.equal(await page.locator('#review-panel .review-brightness').count(), 0, 'Known source skips brightness');
  await page.locator('#review-panel').screenshot({ path: `${output}/desktop-review.png` });
  const title = 'A reference-map point'; await compose(page, title);
  await page.locator('#leaderboard-panel').getByRole('heading', { name: title, exact: true }).waitFor();
  await page.locator('#leaderboard-panel').getByRole('button', { name: 'Point & discussion', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/desktop-discussion.png` });
  await press(page, 'Copy link'); const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(new URL(copied).searchParams.has('finding')); assert(!new URL(copied).searchParams.has('comparison')); assert(!copied.includes('reviewRa'));
  checks.push('no-frame submit, known-object brightness bypass, public discussion, refreshed ranking and finding-only link');
  if (demo) {
    await page.reload(); await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.getByLabel('Reply', { exact: true }).fill('Local discussion reply.'); await press(page, 'Reply'); await page.getByText('Local discussion reply.', { exact: true }).waitFor();
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem('spherex.local-demo.findings.v1'))[0]);
    await page.goto(`${origin}/?reviewRa=${local.ra}&reviewDec=${local.dec}&reviewRadius=30`);
    await press(page, 'Run simulated catalog checks'); await page.getByText(/Already on the leaderboard/).waitFor();
    assert.equal(requests.filter(r => r.path.startsWith('/api/findings')).length, 0, 'Demo must not write to findings');
    checks.push('demo local persistence/reply and same-object/nearby duplicate block, no findings requests');
  } else {
    assert.equal(posts, 1);
    const second = await newContext('44444444-4444-4444-8444-444444444444', true);
    await second.page.goto(copied); await second.page.getByText('Submitted point', { exact: true }).waitFor(); await second.page.getByRole('heading', { name: title, exact: true }).waitFor();
    await press(second.page, 'Show point on map');
    await second.page.getByLabel('Reply', { exact: true }).fill('Second observer can open this point without saved images.');
    await press(second.page, 'Sign in to reply'); await signIn(second.page); await press(second.page, 'Reply');
    await second.page.getByText('Second observer can open this point without saved images.', { exact: true }).waitFor();
    assert(await second.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await second.page.screenshot({ path: `${output}/mobile-discussion.png` });
    checks.push('fresh anonymous mobile finding-only replay, second-session sign-in/reply and no horizontal overflow');
    for (const state of ['uncatalogued', 'zero']) {
      mode = state; await page.goto(`${origin}/?reviewRa=133.8&reviewDec=-7.25&reviewRadius=30`); await press(page, 'Check and score this point');
      await page.locator('#review-panel').getByRole('heading', { name: new RegExp(`^${flow[state].score} points`) }).waitFor();
      await page.getByLabel('Title', { exact: true }).waitFor();
    }
    mode = 'known'; racing = true; await page.goto(`${origin}/?reviewRa=10&reviewDec=20&reviewRadius=30`); await press(page, 'Check and score this point');
    await compose(page, 'Draft kept after a race'); await page.getByText('Another observer submitted this object.', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Draft kept after a race');
    assert(await page.getByRole('button', { name: 'Post finding', exact: true }).isDisabled());
    mode = 'duplicate'; await press(page, 'Find existing entry'); await page.getByText(/Already on the leaderboard/).waitFor();
    await press(page, 'Open existing discussion'); await page.getByRole('heading', { name: title, exact: true }).waitFor();
    checks.push('20/0-point server reports without frames, racing 409 draft retention, duplicate discussion recovery');
  }
  assert.equal(requests.filter(r => r.path.startsWith('/api/comparisons') || r.path.startsWith('/api/wise/comparisons')).length, 0);
  await writeFile(`${output}/results.json`, JSON.stringify({ mode: demo ? 'local-demo' : 'intercepted-live-ui', checks, requests, errors, externalBlocked }, null, 2));
  assert.deepEqual(errors, []);
  console.log(`PASS (${demo ? 'local demo' : 'intercepted live UI'}): ${checks.join('; ')}.`);
} finally { await browser.close(); }
