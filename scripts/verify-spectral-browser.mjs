/** Real browser, synthetic API transport. No live scoring or hosted writes. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const origin = process.env.VIEWER_TEST_URL ?? 'http://127.0.0.1:5192';
const fixture = JSON.parse(await readFile(new URL('../services/findings/fixtures/spectral-flow.json', import.meta.url)));
const wise = JSON.parse(await readFile(new URL('../fixtures/wise/real-wise0855/evidence/manifests/69b16206d33440bb0cda45fc473b46d926c7cddd0e586aea646a0059712eed9a.json', import.meta.url))).response;
const output = new URL('../.local-test-temp/spectral-browser/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
const blank = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
const [overview,tile] = (await page.evaluate(() => {
  const c=document.createElement('canvas'); c.width=1728;c.height=1856;
  let ctx=c.getContext('2d');ctx.fillStyle='#111827';ctx.fillRect(0,0,c.width,c.height);
  const large=c.toDataURL().split(',')[1];c.width=c.height=512;
  ctx=c.getContext('2d');ctx.fillStyle='#111827';ctx.fillRect(0,0,512,512);
  return [large,c.toDataURL().split(',')[1]];
})).map(s=>Buffer.from(s,'base64'));
const properties=['creator_did = ivo://IPAC/P/SPHEREx/DR1/cube','hips_frame = equatorial','hips_order = 5','hips_order_min = 0','hips_tile_width = 512','hips_tile_format = png','moc_sky_fraction = 1','dataproduct_type = cube','hips_cube_depth = 102','hips_cube_firstframe = 1','em_min = 7.43e-7','em_max = 5.009e-6'].join('\n');
let blinkRequests = 0, scoreRequests = 0;
const report = structuredClone(fixture.review);
report.wiseComparisonId = wise.comparison.id; report.wiseVariability.comparisonId = wise.comparison.id;
const authOrigin = 'http://127.0.0.1:18999';
const user = { id:'33333333-3333-4333-8333-333333333333',aud:'authenticated',role:'authenticated',email:'synthetic@example.test',user_metadata:{display_name:'Synthetic observer'} };
function session() {
  const payload = Buffer.from(JSON.stringify({ sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated' })).toString('base64url');
  return {access_token:`eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,token_type:'bearer',refresh_token:'fixture-refresh',expires_in:3600,user};
}
await page.addInitScript(() => localStorage.setItem('spherex.tutorial.review-v1.seen','1'));
await page.route('**/*', async route => {
  const req=route.request(), url=new URL(req.url());
  if(url.origin===authOrigin) return route.fulfill({json:url.pathname.endsWith('/user')?user:url.pathname.endsWith('/otp')?{}:session()});
  const headers={'access-control-allow-origin':'*'};
  if(url.pathname.endsWith('/properties')) return route.fulfill({headers,contentType:'text/plain',body:properties});
  if(url.origin!==origin && /Allsky(?:_\d+)?\.png$/.test(url.pathname)) return route.fulfill({headers,contentType:'image/png',body:overview});
  if(url.origin!==origin && url.pathname.endsWith('.png')) return route.fulfill({headers,contentType:'image/png',body:tile});
  if(url.pathname.endsWith('/log.py')) return route.fulfill({headers,status:200,body:''});
  if(url.origin!==origin) return route.abort();
  if(!url.pathname.startsWith('/api/')) return route.continue();
  if(url.pathname==='/api/findings/auth/config') return route.fulfill({json:{url:authOrigin,publishableKey:'test-only'}});
  if(url.pathname==='/api/wise/comparisons') { blinkRequests++; return route.fulfill({json:wise}); }
  if(url.pathname===`/api/wise/comparisons/${wise.comparison.id}`) return route.fulfill({json:wise});
  if(url.pathname.endsWith('.png')) return route.fulfill({contentType:'image/png',body:blank});
  if(url.pathname==='/api/findings/points/review') {
    const body=req.postDataJSON(); assert.equal(body.wiseComparisonId,wise.comparison.id); assert(req.headers().authorization);
    scoreRequests++; return route.fulfill({status:201,json:report});
  }
  if(url.pathname==='/api/findings/leaderboard') return route.fulfill({json:{board:'daily',placeholder:false,entries:[]}});
  if(url.pathname==='/api/catalogs/nearby') return route.fulfill({headers:{'X-SPHEREx-Catalog-Mode':'live'},json:{sources:[]}});
  return route.fulfill({status:404,json:{code:'not_found',message:'Synthetic route unavailable'}});
});
try {
  await page.goto(`${origin}/?reviewRa=${fixture.request.ra}&reviewDec=${fixture.request.dec}&reviewRadius=30`);
  const pane=page.locator('#review-panel');
  await pane.getByRole('button',{name:'Get WISE blink',exact:true}).waitFor();
  assert(await pane.getByRole('button',{name:'Sign in to submit',exact:true}).isDisabled());
  await pane.getByRole('button',{name:'Get WISE blink',exact:true}).press('Enter');
  await pane.getByText('WISE blink ready. Its saved first and last visits will be measured.',{exact:true}).waitFor();
  assert.equal(blinkRequests,1); assert.equal(scoreRequests,0);
  await pane.getByRole('button',{name:'Sign in to submit',exact:true}).press('Enter');
  const auth=page.locator('#account-panel');
  await auth.getByLabel('Email',{exact:true}).fill('synthetic@example.test');
  await auth.getByRole('button',{name:'Send sign-in email',exact:true}).press('Enter');
  await auth.getByLabel('Email code').fill('123456');
  await auth.getByRole('button',{name:'Verify code',exact:true}).press('Enter');
  await auth.waitFor({state:'hidden'});
  assert.equal(new URL(page.url()).searchParams.get('reviewWise'),wise.comparison.id);
  await page.reload();
  await pane.getByText('WISE blink ready. Its saved first and last visits will be measured.',{exact:true}).waitFor();
  await pane.getByRole('button',{name:'Check and score this point',exact:true}).press('Enter');
  await pane.getByRole('heading',{name:/^30 points/}).waitFor();
  await pane.getByText(/Possibly contains water/).waitFor();
  assert.equal(scoreRequests,1);
  await pane.screenshot({path:new URL('desktop.png',output).pathname.replace(/^\/(?=[A-Z]:)/,'')});
  await page.setViewportSize({width:390,height:844});
  await pane.screenshot({path:new URL('mobile.png',output).pathname.replace(/^\/(?=[A-Z]:)/,'')});
  await pane.getByRole('heading',{name:'SPHEREx wavelength measurements',exact:true}).scrollIntoViewIfNeeded();
  await pane.screenshot({path:new URL('mobile-evidence.png',output).pathname.replace(/^\/(?=[A-Z]:)/,'')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  assert.deepEqual(errors,[]);
  await writeFile(new URL('result.json',output),JSON.stringify({kind:'synthetic_browser',checks:['WISE prerequisite blocks scoring','WISE blink loads','sign-in preserves blink and point','saved blink restored after reload','spectral and variability evidence render','mobile has no page overflow'],blinkRequests,scoreRequests,errors},null,2));
  console.log('Browser passed: WISE prerequisite, sign-in/reload, score and evidence, desktop/mobile.');
} finally { await browser.close(); }
