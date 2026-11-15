const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
const origin=process.env.VIEWER_TEST_URL ?? "http://127.0.0.1:5177";
const id=process.env.COMPARISON_ID;
if(!id)throw new Error("Set COMPARISON_ID to a real saved comparison on this origin.");
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL ?? "chrome",headless:true});
// The first-run tour covers the page and intercepts clicks; mark it seen before each page loads.
const skipTour=()=>localStorage.setItem("spherex.tutorial.review-v1.seen","1");
for(const make of ["newContext","newPage"]){const original=browser[make].bind(browser);browser[make]=async(...args)=>{const made=await original(...args);await made.addInitScript(skipTour);return made;};}
const checks=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const page=await context.newPage();page.setDefaultTimeout(45000);
 const response=await context.request.get(`${origin}/api/comparisons/${encodeURIComponent(id)}`);
 assert.equal(response.status(),200);const saved=await response.json();const comparison=saved.comparison;
 assert.equal(comparison.provenance.evidenceKind,"real_archive");assert(comparison.frames.length>=2);
 const frames=[...comparison.frames].sort((a,b)=>Date.parse(a.observedAtUtc)-Date.parse(b.observedAtUtc));
 const hashes=[];
 for(const frame of frames){const asset=await context.request.get(new URL(frame.imageUrl,origin).href);assert.equal(asset.status(),200);hashes.push(createHash("sha256").update(await asset.body()).digest("hex"));}
 await page.goto(`${origin}/?comparison=${encodeURIComponent(id)}`);
 // Frame evidence and the saved image live in the Blink window.
 const playback=page.getByRole("region",{name:"Frame details"});await playback.waitFor();
 const image=playback.locator(".comparison-frame img");
 await image.evaluate(img=>img.decode());
 assert.equal(await image.getAttribute("src"),frames[0].imageUrl);
 const dimensions=await image.evaluate(img=>[img.naturalWidth,img.naturalHeight]);
 assert.deepEqual(dimensions,[comparison.grid.width,comparison.grid.height]);
 const next=page.getByRole("button",{name:"Next observation",exact:true});
 const previous=page.getByRole("button",{name:"Previous observation",exact:true});
 await next.press("Enter");await image.evaluate(img=>img.decode());
 assert.equal(await image.getAttribute("src"),frames[1].imageUrl);
 await previous.press("Enter");
 await page.getByRole("button",{name:"Playback settings",exact:true}).press("Enter");
 await page.getByRole("button",{name:"Play all observations",exact:true}).press("Enter");
 await page.waitForFunction(at=>document.querySelector(".active-date time")?.getAttribute("datetime")===at,frames[1].observedAtUtc);
 await page.getByRole("button",{name:"Pause sequence",exact:true}).press("Enter");
 checks.push("real_archive_images_decoded_stepped_and_played");
 // The Gaia source inspector was removed: the image is display only and opens no catalog lookup.
 const catalogRequests=[];page.on("request",r=>{if(new URL(r.url()).pathname.startsWith("/api/catalogs/"))catalogRequests.push(r.url());});
 assert.equal(await page.getByRole("button",{name:/Inspect image|Compare details/}).count(),0);
 assert.equal(await page.locator("#gaia-panel").count(),0);
 assert.match(await playback.locator(".frame-source").textContent(),new RegExp(frames[0].release.toUpperCase()));
 assert.deepEqual(catalogRequests,[]);
 checks.push("frame_source_and_release_shown_without_source_inspector");
 const fresh=await browser.newContext();const replayPage=await fresh.newPage();
 const searches=[];replayPage.on("request",r=>{if(new URL(r.url()).pathname==="/api/comparisons")searches.push(r.url());});
 await replayPage.goto(`${origin}/?comparison=${encodeURIComponent(id)}`);
 await replayPage.getByRole("region",{name:"Frame details"}).waitFor();
 assert.equal(searches.length,0);
 const replay=await (await fresh.request.get(`${origin}/api/comparisons/${encodeURIComponent(id)}`)).json();
 assert.deepEqual(replay,saved);
 for(let i=0;i<frames.length;i++){
   const asset=await fresh.request.get(new URL(frames[i].imageUrl,origin).href);
   assert.equal(createHash("sha256").update(await asset.body()).digest("hex"),hashes[i]);
 }
 checks.push("fresh_anonymous_session_replays_identical_manifest_and_image_bytes_without_search");
 const report={kind:"executed_local_real_services",origin,comparisonId:id,evidenceKind:comparison.provenance.evidenceKind,dimensions,wavelengthRangeUm:comparison.wavelengthRangeUm,stretch:comparison.stretch,frames:frames.map((f,i)=>({id:f.id,observedAtUtc:f.observedAtUtc,alignment:f.alignment,imageSha256:hashes[i]})),gaiaSourcesNearSelectedCutout:nearby.sources.length,checks,limitations:["Findings/auth are outside this playback verification.","No claim of a significant motion or variability detection.","Local origin only; not deployed."]};
 if(process.env.REPORT_FILE)await writeFile(process.env.REPORT_FILE,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
