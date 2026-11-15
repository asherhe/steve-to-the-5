const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {cutoutWcs} from "./cutoutWcs.ts";
import {predictAtObservation} from "../inspector/propagate.ts";
const origin=process.env.VIEWER_TEST_URL ?? "http://127.0.0.1:5177";
const id=process.env.COMPARISON_ID;
if(!id)throw new Error("Set COMPARISON_ID to a real saved comparison on this origin.");
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL ?? "chrome",headless:true});
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
 await page.getByRole("button",{name:"Compare details",exact:true}).press("Enter");
 const playback=page.getByRole("region",{name:"Comparison playback"});await playback.waitFor();
 const image=page.locator(".comparison-frame img");
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
 await playback.locator("figcaption time").filter({hasText:frames[1].observedAtUtc}).waitFor();
 await page.getByRole("button",{name:"Pause sequence",exact:true}).press("Enter");
 checks.push("real_archive_images_decoded_stepped_and_played");
 await previous.press("Enter");await image.evaluate(img=>img.decode());
 await page.getByRole("button",{name:"Inspect image. Press Enter to inspect its center."}).focus();
 const nearbyPromise=page.waitForResponse(r=>r.url().includes("/api/catalogs/nearby?"));
 await page.keyboard.press("Enter");
 const nearbyResponse=await nearbyPromise;const nearby=await nearbyResponse.json();assert.equal(nearbyResponse.status(),200);
 await page.locator("#gaia-panel").getByText(frames[0].observedAtUtc,{exact:true}).waitFor();
 if(nearby.sources.length){
   await page.locator(".si-state--ambiguous,.si-detail").first().waitFor();
   if(await page.locator(".si-candidate").count())await page.locator(".si-candidate").first().press("Enter");
   await page.locator(".si-detail").waitFor();
   await page.locator(".si-detail__source-link").waitFor();
   const sourceId=await page.locator(".si-detail__id").textContent();
   const source=nearby.sources.find(candidate=>candidate.sourceId===sourceId);
   assert(source);
   const catalogRequests=[];
   page.on("request",r=>{if(new URL(r.url()).pathname.startsWith("/api/catalogs/"))catalogRequests.push(r.url());});
   await page.getByRole("button",{name:"Mark predicted position",exact:true}).press("Enter");
   const marker=playback.getByRole("img",{name:"Predicted Gaia position",exact:true});
   const wcs=cutoutWcs(comparison.grid);
   assert(wcs);
   for(const [index,frame] of frames.slice(0,2).entries()){
     if(index===1)await next.press("Enter");
     await playback.locator("figcaption time").filter({hasText:frame.observedAtUtc}).waitFor();
     const prediction=predictAtObservation(source,frame.observedAtUtc);
     assert(prediction);
     const point=wcs.toImage(prediction);
     if(point && point.x>=-0.5 && point.x<dimensions[0]-0.5 && point.y>=-0.5 && point.y<dimensions[1]-0.5){
       const position=await marker.evaluate(el=>[parseFloat(el.style.left),parseFloat(el.style.top)]);
       assert(Math.abs(position[0]-(point.x+0.5)/dimensions[0]*100)<1e-3);
       assert(Math.abs(position[1]-(point.y+0.5)/dimensions[1]*100)<1e-3);
     }else{
       await marker.waitFor({state:"detached"});
     }
   }
   assert.deepEqual(catalogRequests,[]);
   checks.push("live_gaia_inspector_and_prediction_at_current_frame_time");
 }else{await page.getByText("No catalog source here",{exact:true}).waitFor();checks.push("live_gaia_inspector_valid_empty_result");}
 const fresh=await browser.newContext();const replayPage=await fresh.newPage();
 const searches=[];replayPage.on("request",r=>{if(new URL(r.url()).pathname==="/api/comparisons")searches.push(r.url());});
 await replayPage.goto(`${origin}/?comparison=${encodeURIComponent(id)}`);
 await replayPage.getByRole("button",{name:"Compare details",exact:true}).press("Enter");
 await replayPage.getByRole("region",{name:"Comparison playback"}).waitFor();
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
