const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin=process.env.VIEWER_TEST_URL ?? 'http://127.0.0.1:5176';
const fixtures=new URL('../../../fixtures/archive/',import.meta.url);
const json=async file=>JSON.parse(await readFile(new URL(file,fixtures),'utf8'));
const ready=await json('responses/ready.json');
const store=await json(`synthetic/evidence/manifests/${ready.comparison.id}.json`);
const unavailable=await json('responses/upstream_unavailable.json');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const context=await browser.newContext();const page=await context.newPage();
 const calls=[];let outage=false;
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  calls.push(u.pathname+u.search);
  if(u.pathname.includes('/assets/')) {
   const name=u.pathname.split('/').at(-1);const hash=store.assets[name];
   return hash?route.fulfill({contentType:'image/png',body:await readFile(new URL(`synthetic/evidence/blobs/${hash}`,fixtures))}):route.fulfill({status:404});
  }
  if(u.pathname==='/api/resolve')return route.fulfill({json:{name:'Contract field',...ready.comparison.field}});
  if(u.pathname.startsWith('/api/catalogs/nearby'))return route.fulfill({json:{sources:[]}});
  if(u.pathname==='/api/comparisons')return route.fulfill({json:outage?unavailable:ready});
  if(u.pathname===`/api/comparisons/${ready.comparison.id}`)return route.fulfill({json:ready});
  return route.fulfill({status:404,json:{code:'NOT_FOUND',message:'Unknown comparison ID'}});
 });
 // Fixture query flags cannot enable development adapters in the public build.
 await page.goto(origin+'/?fixtures=1');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 assert.equal(await page.getByLabel('Archive response').count(),0);assert.equal(calls.length,0);
 await page.getByLabel('Object name',{exact:true}).fill('Contract field');
 await page.getByRole('button',{name:'Resolve and compare'}).click();
 await page.getByRole('region',{name:'Comparison playback'}).waitFor();
 assert.equal(calls[0],'/api/resolve?name=Contract%20field');
 assert.equal(calls[1],'/api/comparisons?ra=10&dec=20&fovArcmin=6');
 const image=page.locator('.comparison-frame img');await image.evaluate(img=>img.decode());
 assert.equal(await image.getAttribute('src'),ready.comparison.frames[0].imageUrl);
 await image.evaluate(img=>{if(img.naturalWidth!==59||img.naturalHeight!==59)throw new Error('Wrong decoded grid');});
 await page.getByRole('button',{name:'Next',exact:true}).click();await image.evaluate(img=>img.decode());
 assert.equal(await image.getAttribute('src'),ready.comparison.frames[1].imageUrl);
 await page.getByRole('button',{name:'Inspect image. Press Enter to inspect its center.'}).focus();await page.keyboard.press('Enter');
 await page.getByText('No catalog source here',{exact:true}).waitFor();
 assert(calls.some(path=>path.startsWith('/api/catalogs/nearby?')));
 const before=calls.length;
 await page.goto(origin+`/?comparison=${ready.comparison.id}`);
 await page.getByRole('region',{name:'Comparison playback'}).waitFor();
 assert(!calls.slice(before).some(path=>path.startsWith('/api/comparisons?')));
 outage=true;
 await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('button',{name:'Compare coordinates'}).click();
 await page.getByText('Archive unavailable',{exact:true}).waitFor();
 assert.equal(await page.getByRole('region',{name:'Comparison playback'}).count(),0);
 await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
 await page.getByRole('button',{name:'Open saved real example',exact:true}).waitFor();
 console.log('PASS: production build excludes fixture controls; same-origin name→search, decoded archive fixture assets, stepping, inspector slot, saved-ID replay without search, outage and retry. All APIs mocked, no live services.');
}finally{await browser.close();}
