const { chromium }=await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const origin=process.env.VIEWER_TEST_URL ?? "http://127.0.0.1:5177";
const browser=await chromium.launch({channel:"chrome",headless:true});
// The first-run tour covers the page and intercepts clicks; mark it seen before each page loads.
const skipTour=()=>localStorage.setItem("spherex.tutorial.review-v1.seen","1");
for(const make of ["newContext","newPage"]){const original=browser[make].bind(browser);browser[make]=async(...args)=>{const made=await original(...args);await made.addInitScript(skipTour);return made;};}
try{
 const page=await browser.newPage();page.setDefaultTimeout(45000);
 await page.goto(origin);
 await page.getByRole("button",{name:"More map options",exact:true}).click();await page.getByRole("button",{name:"Advanced search",exact:true}).click();
 await page.getByRole("textbox",{name:/^Right ascension/}).fill("133.79512916666664");
 await page.getByRole("textbox",{name:/^Declination/}).fill("-7.245147222222222");
 const result=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/comparisons");
 await page.getByRole("button",{name:"Compare coordinates"}).click();
 const body=await (await result).json();assert.equal(body.status,"upstream_unavailable");
 await page.getByText("Archive unavailable",{exact:true}).waitFor();
 assert.equal(await page.getByRole("region",{name:"Frame details"}).count(),0);
 await page.getByRole("button",{name:"Retry",exact:true}).waitFor();
 await page.getByRole("button",{name:"Open saved real example",exact:true}).click();
 const frame=page.getByRole("region",{name:"Frame details"});
 await frame.getByText(/^Saved real SPHEREx example/).waitFor();
 await frame.locator(".comparison-frame img").evaluate(img=>img.decode());
 const report={kind:"executed_local_upstream_outage",origin,status:body.status,diagnosticCode:body.diagnostics.code,checks:["archive_upstream_failure_reaches_viewer_without_browser_mocks","no_unrelated_frames_on_failure","retry_available","saved_real_example_replays_during_upstream_outage"],simulation:"Isolated archive process uses an unreachable local HTTPS proxy; TLS verification stays enabled."};
 if(process.env.REPORT_FILE)await writeFile(process.env.REPORT_FILE,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
