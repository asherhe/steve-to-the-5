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
 await page.getByRole('button',{name:'Compare details',exact:true}).press('Enter');
 const playback=page.getByRole('region',{name:'Comparison playback'});
 await playback.waitFor();
 assert.equal(calls[0],'/api/resolve?name=Contract%20field');
 assert.equal(calls[1],'/api/comparisons?ra=10&dec=20&fovArcmin=6');
 const image=page.locator('.comparison-frame img');await image.evaluate(img=>img.decode());
 assert.equal(await image.getAttribute('src'),ready.comparison.frames[0].imageUrl);
 await image.evaluate(img=>{if(img.naturalWidth!==59||img.naturalHeight!==59)throw new Error('Wrong decoded grid');});
 await page.getByRole('button',{name:'Inspect image. Press Enter to inspect its center.'}).focus();await page.keyboard.press('Enter');
 await page.locator('.si-detail__source-link').waitFor();
 await page.getByRole('button',{name:'Mark predicted position',exact:true}).press('Enter');
 const [firstFrame,secondFrame]=ready.comparison.frames;
 const marker=playback.getByRole('img',{name:'Predicted Gaia position',exact:true});
 const mapMarker=page.getByLabel('Dated-image footprint, frame marks and predicted Gaia position',{exact:true});
 async function markerAt(frame) {
  await playback.locator('figcaption time').filter({hasText:frame.observedAtUtc}).waitFor();
  await page.locator('#gaia-panel time').filter({hasText:frame.observedAtUtc}).waitFor();
  await marker.waitFor();
  return marker.evaluate(element=>parseFloat(element.style.top));
 }
 const catalogCalls=()=>calls.filter(path=>path.startsWith('/api/catalogs/'));
 const initialCatalogCalls=catalogCalls();
 assert.equal(initialCatalogCalls.length,2);
 const sourceName=page.locator("#gaia-panel .si-detail__header").getByText(nameReference.displayName,{exact:true});
 await sourceName.waitFor();
 const firstTop=await markerAt(firstFrame);
 await mapMarker.waitFor();
 await page.getByRole('button',{name:'Next observation',exact:true}).press('Enter');
 const secondTop=await markerAt(secondFrame);
 assert.equal(await sourceName.count(),1,"The verified name must follow the same source during playback");
 await mapMarker.waitFor();
 assert(secondTop<firstTop,'Northward proper motion should move the marker up');
 await page.getByRole('button',{name:'Previous observation',exact:true}).press('Enter');
 assert.equal(await markerAt(firstFrame),firstTop);
 await page.getByRole('button',{name:'Playback settings',exact:true}).press('Enter');
 await page.getByRole('button',{name:'Play all observations',exact:true}).press('Enter');
 assert.equal(await markerAt(secondFrame),secondTop);
 await page.getByRole('button',{name:'Pause sequence',exact:true}).press('Enter');
 await page.getByRole('button',{name:'Blink A ↔ B',exact:true}).press('Enter');
 assert.equal(await markerAt(firstFrame),firstTop);
 assert.equal(await markerAt(secondFrame),secondTop);
 await page.getByRole('button',{name:'Pause blink',exact:true}).press('Enter');
 assert.deepEqual(catalogCalls(),initialCatalogCalls);
 await page.getByRole('button',{name:'Clear mark',exact:true}).press('Enter');
 await marker.waitFor({state:'detached'});
 await mapMarker.waitFor({state:'detached'});
 if(await page.getByRole('button',{name:'Previous observation',exact:true}).isEnabled()){
  await page.getByRole('button',{name:'Previous observation',exact:true}).press('Enter');
 }
 await marker.waitFor({state:'detached'});
 const before=calls.length;
 failedImage=secondFrame.imageUrl;
 await page.goto(origin+`/?comparison=${ready.comparison.id}`);
 await page.getByRole('button',{name:'Compare details',exact:true}).press('Enter');
 await playback.waitFor();
 assert(!calls.slice(before).some(path=>path.startsWith('/api/comparisons?')));
 await playback.getByRole('button',{name:/Inspect image/}).focus();
 await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Mark predicted position',exact:true}).press('Enter');
 assert.equal(await markerAt(firstFrame),firstTop);
 await page.getByRole('button',{name:'Next observation',exact:true}).press('Enter');
 await playback.getByText('This frame could not be loaded.',{exact:false}).waitFor();
 await marker.waitFor({state:'detached'});
 await page.getByRole('button',{name:'Previous observation',exact:true}).press('Enter');
 assert.equal(await markerAt(firstFrame),firstTop);
 failedImage=null;
 catalogSource={...source,dec:20.001,pmDecMasYr:18000};
 searchResult={...ready,comparison:{...ready.comparison,id:'1'.repeat(64)}};
 await openAdvancedSearch();
 await page.getByRole('button',{name:'Compare coordinates'}).press('Enter');
 await page.getByRole('button',{name:'Compare details',exact:true}).press('Enter');
 await playback.getByRole('button',{name:/Inspect image/}).waitFor();
 await marker.waitFor({state:'detached'});
 await playback.getByRole('button',{name:/Inspect image/}).press('Enter');
 await button('Mark predicted position').press('Enter');
 await markerAt(firstFrame);
 await button('Next observation').press('Enter');
 await playback.locator('figcaption time').filter({hasText:secondFrame.observedAtUtc}).waitFor();
 await marker.waitFor({state:'detached'});
 await mapMarker.waitFor({state:'detached'});
 outage=true;
 await openAdvancedSearch();await button('Compare coordinates').press('Enter');
 await page.getByText('Archive unavailable',{exact:true}).waitFor();
 assert.equal(await page.getByRole('region',{name:'Comparison playback'}).count(),0);
 await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
 await page.getByRole('button',{name:'Open saved real example',exact:true}).waitFor();
 console.log('PASS: production search, decoded archive fixture assets, Gaia marker during step/play/blink without refetch, clear, failed image, comparison switch, out-of-cutout hiding, saved-ID replay, outage and retry. All APIs mocked, no live services.');
}finally{await browser.close();}
