const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin=process.env.VIEWER_TEST_URL ?? 'http://127.0.0.1:5176';
const fixtures=new URL('../../../fixtures/archive/',import.meta.url);
const json=async file=>JSON.parse(await readFile(new URL(file,fixtures),'utf8'));
const ready=await json('responses/ready.json');
const store=await json(`synthetic/evidence/manifests/${ready.comparison.id}.json`);
const unavailable=await json('responses/upstream_unavailable.json');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',headless:true});
// The first-run tour covers the page and intercepts clicks; mark it seen before each page loads.
const skipTour=()=>localStorage.setItem("spherex.tutorial.review-v1.seen","1");
for(const make of ["newContext","newPage"]){const original=browser[make].bind(browser);browser[make]=async(...args)=>{const made=await original(...args);await made.addInitScript(skipTour);return made;};}
const nameReference=JSON.parse(await readFile(new URL("../../../fixtures/catalogs/resolved-targets.json",import.meta.url),"utf8"))[0].identity;
const source={
 identity:nameReference,sourceId:nameReference.catalogIds.find(ref=>ref.catalog==="Gaia"&&ref.dataRelease==="DR3").id,ra:10,dec:20,refEpoch:2016,
 pmRaCosDecMasYr:0,pmDecMasYr:3600,parallaxMas:null,gMag:10,separationArcsec:0,
};
try {
 const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();
 page.setDefaultTimeout(10000);
 const button=name=>page.getByRole('button',{name,exact:true});
 async function openAdvancedSearch(){
  await button('More map options').press('Enter');
  await button('Advanced search').press('Enter');
 }
 const calls=[];let outage=false;let failedImage=null;let searchResult=ready;let catalogSource=source;
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith('/api/'))return route.continue();
  calls.push(u.pathname+u.search);
  if(u.pathname.includes('/assets/')) {
   if(u.pathname===failedImage)return route.fulfill({status:404});
   const name=u.pathname.split('/').at(-1);const hash=store.assets[name];
   return hash?route.fulfill({contentType:'image/png',body:await readFile(new URL(`synthetic/evidence/blobs/${hash}`,fixtures))}):route.fulfill({status:404});
  }
  if(u.pathname==='/api/resolve')return route.fulfill({json:{name:'Contract field',...ready.comparison.field}});
  if(u.pathname==='/api/catalogs/nearby')return route.fulfill({
   headers:{'X-SPHEREx-Catalog-Mode':'live'},json:{sources:[catalogSource]},
  });
  if(u.pathname===`/api/catalogs/gaia/${source.sourceId}`)return route.fulfill({json:{
   ...catalogSource,provenance:{dataRelease:'Gaia DR3',sourceDetailUrl:'https://example.invalid/gaia'},
  }});
  if(u.pathname==='/api/comparisons')return route.fulfill({json:outage?unavailable:searchResult});
  if(u.pathname===`/api/comparisons/${ready.comparison.id}`)return route.fulfill({json:ready});
  return route.fulfill({status:404,json:{code:'NOT_FOUND',message:'Unknown comparison ID'}});
 });
 // Fixture query flags cannot enable development adapters in the public build.
 await page.goto(origin+'/?fixtures=1');
 await openAdvancedSearch();
 assert.equal(await page.getByLabel('Archive response').count(),0);assert.equal(calls.length,0);
 await page.getByLabel('Object name',{exact:true}).fill('Contract field');
 await page.getByRole('button',{name:'Resolve and compare'}).press('Enter');
 // The Blink window holds the frame evidence that used to be in a separate comparison panel.
 const blink=page.getByRole('region',{name:'Blink',exact:true});
 const frame=blink.getByRole('region',{name:'Frame details'});
 await frame.waitFor();
 // The name is resolved first, then the field is searched. (The app currently resolves the name twice; known, harmless.)
 assert.equal(calls[0],'/api/resolve?name=Contract%20field');
 const searches=calls.filter(path=>path.startsWith('/api/comparisons?'));
 assert.deepEqual(searches,['/api/comparisons?ra=10&dec=20&fovArcmin=6']);
 assert(calls.indexOf(searches[0])>calls.lastIndexOf('/api/resolve?name=Contract%20field'));
 assert.equal(await page.locator('#comparison-panel').count(),0);
 const image=frame.locator('.comparison-frame img');await image.evaluate(img=>img.decode());
 assert.equal(await image.getAttribute('src'),ready.comparison.frames[0].imageUrl);
 await image.evaluate(img=>{if(img.naturalWidth!==59||img.naturalHeight!==59)throw new Error('Wrong decoded grid');});
 // Source and release attribution stays visible; the rest opens on demand.
 assert.match(await frame.locator('.frame-source').textContent(),new RegExp(ready.comparison.frames[0].release.toUpperCase()));
 await frame.getByText('Frame details',{exact:true}).click();
 const [firstFrame,secondFrame]=ready.comparison.frames;
 async function showing(frameMeta){
  await page.waitForFunction(at=>document.querySelector('.active-date time')?.getAttribute('datetime')===at,frameMeta.observedAtUtc);
  // Frame details may be collapsed; the evidence is still rendered for the shown frame.
  await frame.locator(`dd time[datetime="${frameMeta.observedAtUtc}"]`).waitFor({state:'attached'});
 }
 await showing(firstFrame);
 await button('Next observation').press('Enter');await showing(secondFrame);
 await button('Previous observation').press('Enter');await showing(firstFrame);
 await button('Playback settings').press('Enter');
 await button('Play all observations').press('Enter');await showing(secondFrame);
 await button('Pause sequence').press('Enter');
 await button('Blink A ↔ B').press('Enter');await showing(firstFrame);await showing(secondFrame);
 await button('Pause blink').press('Enter');
 // The Gaia source inspector is gone: no click-to-inspect image, no inspector panel.
 assert.equal(await page.getByRole('button',{name:/Inspect image|Compare details/}).count(),0);
 assert.equal(await page.locator('#gaia-panel').count(),0);
 assert.equal(calls.filter(path=>path.startsWith('/api/catalogs/')).length,0);
 // Saved-ID replay restores the stored comparison without a new search; a failed frame offers a retry.
 const before=calls.length;
 failedImage=secondFrame.imageUrl;
 await page.goto(origin+`/?comparison=${ready.comparison.id}`);
 await frame.waitFor();
 assert(!calls.slice(before).some(path=>path.startsWith('/api/comparisons?')));
 await showing(firstFrame);
 await button('Next observation').press('Enter');
 await blink.locator('.time-controls').getByText('This frame could not be loaded.',{exact:false}).waitFor();
 await button('Previous observation').press('Enter');await showing(firstFrame);
 failedImage=null;
 // A new search replaces the comparison and its share link.
 searchResult={...ready,comparison:{...ready.comparison,id:'1'.repeat(64)}};
 await openAdvancedSearch();
 await page.getByRole('button',{name:'Compare coordinates'}).press('Enter');
 await blink.getByRole('link',{name:'Saved comparison link'}).and(page.locator(`[href*="${'1'.repeat(64)}"]`)).waitFor();
 outage=true;
 await openAdvancedSearch();await button('Compare coordinates').press('Enter');
 await page.getByText('Archive unavailable',{exact:true}).waitFor();
 assert.equal(await page.getByRole('region',{name:'Frame details'}).count(),0);
 await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
 await page.getByRole('button',{name:'Open saved real example',exact:true}).waitFor();
 console.log('PASS: production search, decoded archive fixture assets in Blink, frame details during step/play/blink, no source inspector, failed image, saved-ID replay, comparison switch, outage and retry. All APIs mocked, no live services.');
}finally{await browser.close();}
