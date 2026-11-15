// Run against the Vite development harness; all external traffic is blocked.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const origin = process.env.VIEWER_TEST_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({channel:"chrome",headless:true});
const targets = ["Barnard’s Star", "Epsilon Indi B", "WISE 0855", "RW Aurigae", "R Draconis"];
try {
 for (const mobile of [false,true]) {
  const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});
  await context.route("**/*",route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const page=await context.newPage();
  const errors=[]; page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin+"/?fixtures=1");
  const search=async()=>{if(!await page.locator("#search-panel").isVisible())await page.getByRole("button",{name:"Search",exact:true}).click();};
  const combo=page.getByRole("combobox",{name:"Object name"});
  const targetContext=page.getByRole("region",{name:"Requested target",exact:true});
  await search(); await combo.fill("HIP879");
  assert.equal(await page.getByRole("option").count(),1);
  await combo.press("Escape"); assert.equal(await page.getByRole("option").count(),0);
  assert.equal(await page.locator("#search-panel").isVisible(),true);
  await combo.fill("HIP879"); await combo.press("Enter");
  await page.getByRole("alert").getByText(/choose a matching target/i).waitFor();
  await combo.press("ArrowDown"); await combo.press("Enter");
  await targetContext.getByText("Barnard’s Star",{exact:true}).waitFor();
  for(const name of targets) {
   await search(); await page.getByRole("button",{name,exact:true}).click();
   await targetContext.getByText(name,{exact:true}).waitFor();
   await page.getByRole("region",{name:"Comparison playback"}).waitFor();
   assert.match(await targetContext.innerText(),/visible target detection are not established/);
   assert.match(await page.locator(".map-name-legend").innerText(),/field center, not a detection/);
  }
  await search(); await combo.fill("epsilon indi"); await combo.press("Enter");
  await page.getByRole("alert").getByText(/choose epsilon indi b/i).waitFor();
  await page.getByRole("option",{name:/Epsilon Indi B/}).click();
  await targetContext.getByText("Epsilon Indi B",{exact:true}).waitFor();
  for(const [name,text] of [["Fixture timeout",/name lookup timed out/i],["Fixture disabled",/external name lookup is disabled/i],["Fixture malformed",/invalid data/i],["Arbitrary missing",/object name not found/i]]) {
   await search(); await combo.fill(name); await combo.press("Enter");
   await page.locator("#comparison-panel").getByText(text).waitFor();
   assert.equal(await targetContext.count(),0);
  }
  await search(); await combo.fill("Fixture slow"); await combo.press("Enter");
  await search(); await combo.fill("R Dra"); await combo.press("ArrowDown"); await combo.press("Enter");
  await targetContext.getByText("R Draconis",{exact:true}).waitFor();
  await page.waitForTimeout(1400); // old fixture resolver intentionally ignores cancellation
  assert.equal(await targetContext.getByText("R Draconis",{exact:true}).count(),1);
  assert.equal(await page.getByText("Slow old response",{exact:true}).count(),0);
  await search(); await page.getByLabel("Right ascension").fill("400");
  await page.getByRole("button",{name:"Compare coordinates",exact:true}).click();
  await page.getByText(/enter ra from 0/i).waitFor();
  await page.getByLabel("Right ascension").fill("42");
  await page.getByLabel("Declination",{exact:true}).fill("-20");
  await page.getByRole("button",{name:"Compare coordinates",exact:true}).click();
  assert.equal(await targetContext.count(),0);
  await page.getByLabel("Archive response").selectOption("upstream_unavailable");
  await search(); await page.getByRole("button",{name:"WISE 0855",exact:true}).click();
  await targetContext.getByText("WISE 0855",{exact:true}).waitFor();
  await page.locator("#comparison-panel").getByRole("status").filter({hasText:/^Archive unavailable$/}).waitFor();
  assert.equal(await page.getByRole("region",{name:"Comparison playback"}).count(),0);
  await page.getByRole("button",{name:"Open saved fixture",exact:true}).first().click();
  await page.getByRole("region",{name:"Comparison playback"}).waitFor();
  assert.equal(await targetContext.count(),0);
  assert.equal(await page.locator(".target-readout").count(),0);
  assert.equal(await page.locator(".map-name-legend").count(),0);
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(geometry.scroll<=geometry.width,JSON.stringify(geometry));
  assert.deepEqual(errors,[]);
  await context.close();
 }
 // Production adapter and Aladin catalog boundary. The map API is mocked here;
 // this verifies label payloads, not real HiPS rendering or catalog measurements.
 const resolved=JSON.parse(await readFile(new URL("../../../../fixtures/catalogs/resolved-targets.json",import.meta.url),"utf8"));
 const source={sourceId:"4472832130942575872",ra:269.45,dec:4.74,refEpoch:2016,pmRaCosDecMasYr:-801,pmDecMasYr:10362,parallaxMas:null,gMag:8,separationArcsec:1,identity:resolved[0].identity};
 const tile=await readFile(new URL("./epoch-one.png",import.meta.url));
 const mapModule=`window.__nameCatalogs=[]; export default {
 init:Promise.resolve(),
 HiPS(url,options){const layer={setSliceNumber(){}};setTimeout(()=>options.successCallback(layer),0);return layer;},
 aladin(){return {gotoRaDec(){},setFoV(){},setProjection(){},on(){},getRaDec(){return [269.45,4.74]},getFoV(){return [.1,.1]},addCatalog(c){window.__nameCatalogs.push(c)}}},
 catalog(options){return {options,sources:[],clear(){this.sources=[]},addSources(s){this.sources.push(...s)}}},
 source(ra,dec,data){return {ra,dec,data}}
 };`;

 const context=await browser.newContext();
 let resolves=0,comparisons=0;
 await context.route("**/*",route=>{
  const url=route.request().url();
  if(/\/aladin-lite\.js(?:\?|$)/.test(url))return route.fulfill({contentType:"text/javascript",body:mapModule});
  if(url.includes("spherex_allsky_cube/properties"))return route.fulfill({body:"creator_did=ivo://IPAC/P/SPHEREx/DR1/cube"});
  if(url.includes("spherex_allsky_cube/Norder3/"))return route.fulfill({contentType:"image/png",body:tile});
  if(url.startsWith(origin+"/api/catalogs/nearby"))return route.fulfill({json:{sources:[source]}});
  if(url.startsWith(origin+"/api/catalogs/gaia/"))return route.fulfill({json:{...source,provenance:{catalog:"gaiadr3.gaia_source",dataRelease:"Gaia DR3"}}});
  if(url.startsWith(origin+"/api/resolve")){resolves++;return route.abort();}
  if(url.startsWith(origin+"/api/comparisons")){comparisons++;return route.fulfill({json:{status:"no_coverage",comparison:null}});}
  return url.startsWith(origin)?route.continue():route.abort();
 });
 const page=await context.newPage(); await page.goto(origin);
 await page.getByRole("button",{name:"Search",exact:true}).click();
 await page.getByRole("combobox",{name:"Object name"}).fill("GJ699");
 await page.getByRole("button",{name:"Resolve and compare",exact:true}).click();
 await page.getByRole("region",{name:"Requested target",exact:true}).getByText("Barnard’s Star",{exact:true}).waitFor();
 await page.locator("#comparison-panel").getByText("No coverage",{exact:true}).waitFor();
 assert.equal(resolves,0);assert.equal(comparisons,1);
 await page.waitForFunction(()=>window.__nameCatalogs?.some(c=>c.options.name==="Requested target field center"&&c.sources.length===1));
 const fieldLabel=await page.evaluate(()=>window.__nameCatalogs.find(c=>c.options.name==="Requested target field center"));
 assert.equal(fieldLabel.options.displayLabel,true);
 assert.equal(fieldLabel.options.shape,"cross");
 assert.equal(fieldLabel.sources[0].ra,resolved[0].ra);
 assert.match(fieldLabel.sources[0].data.label,/Barnard’s Star \(field center\)/);
 await page.getByRole("button",{name:"Inspect map center",exact:true}).click();
 await page.getByRole("button",{name:"Mark position",exact:true}).click();
 const marked=await page.evaluate(()=>window.__nameCatalogs.find(c=>c.options.name==="Marked Gaia position"));
 assert.equal(marked.options.shape,"circle");
 assert.match(marked.sources[0].data.label,/Barnard’s Star \(catalog epoch 2016\)/);
 assert.equal(await page.getByRole("region",{name:"Source inspector"}).getByText(source.sourceId,{exact:true}).count(),1);
 console.log("PASS: offline desktop/mobile names, aliases, keyboard/touch selection, component ambiguity, failures, stale responses, coordinate fallback, saved replay context reset, production local lookup and Aladin label payloads.");
} finally {await browser.close();}
