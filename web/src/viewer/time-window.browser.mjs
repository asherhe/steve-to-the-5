const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??"playwright");
import assert from "node:assert/strict";
const origin=process.env.VIEWER_TEST_URL??"http://127.0.0.1:5173";
const browser=await chromium.launch({channel:"chrome",headless:true});
// The first-run tour covers the page and intercepts clicks; mark it seen before each page loads.
const skipTour=()=>localStorage.setItem("spherex.tutorial.review-v1.seen","1");
for(const make of ["newContext","newPage"]){const original=browser[make].bind(browser);browser[make]=async(...args)=>{const made=await original(...args);await made.addInitScript(skipTour);return made;};}
async function date(page,expected){await page.waitForFunction(expected=>document.querySelector(".active-date time")?.getAttribute("datetime")===expected,expected);}
async function ready(page){await page.waitForFunction(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent==="Blink A ↔ B");return b&&!b.disabled;});}
try{
 const context=await browser.newContext({viewport:{width:1400,height:950},permissions:["clipboard-read","clipboard-write"]});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 await page.goto(origin+"/?fixtures=1&comparison=fixture-irregular-times");await ready(page);
 const time=page.getByRole("region",{name:"Blink",exact:true});
 assert.equal(await page.locator("#comparison-panel").count(),0); // merged into Blink
 const ticks=await page.locator(".time-ticks span").evaluateAll(elements=>elements.map(e=>parseFloat(e.style.left)));
 assert.equal(ticks[0],0);assert(ticks[1]>0&&ticks[1]<15);assert.equal(ticks[2],100);
 await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).click();
 await date(page,"2025-12-15T03:10:00Z");await date(page,"2025-06-15T04:20:00Z");
 const slider=page.getByRole("slider",{name:"Observation time"});await slider.focus();await slider.press("Home");await slider.press("ArrowRight");
 await date(page,"2025-07-01T03:10:00Z");await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).waitFor();
 await page.getByLabel("Blink A observation").selectOption("1");await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).click();
 await date(page,"2025-12-15T03:10:00Z");await date(page,"2025-07-01T03:10:00Z");await slider.focus();await slider.press("Home");
 const paneBeforeScrub=await time.boundingBox();const sliderBox=await slider.boundingBox();
 await page.mouse.move(sliderBox.x+sliderBox.width*0.02,sliderBox.y+sliderBox.height/2);await page.mouse.down();
 await page.mouse.move(sliderBox.x+sliderBox.width*0.8,sliderBox.y+sliderBox.height/2,{steps:8});await page.mouse.up();
 await date(page,"2025-12-15T03:10:00Z");assert.equal((await time.boundingBox()).x,paneBeforeScrub.x);
 await slider.focus();await slider.press("Home");
 // Frame evidence lives in the Blink window: source and release always visible, image and details on demand.
 const frame=time.getByRole("region",{name:"Frame details",exact:true});
 assert.match(await frame.locator(".frame-source").textContent(),/Synthetic comparison/);
 await frame.getByText("Frame image",{exact:true}).click();await frame.locator("img").evaluate(img=>img.decode());
 await frame.getByText("Frame details",{exact:true}).click();
 assert.equal(await frame.locator("dd time").getAttribute("datetime"),"2025-06-15T04:20:00Z");
 await time.getByRole("button",{name:"Copy comparison link",exact:true}).click();
 assert.equal(new URL(await page.evaluate(()=>navigator.clipboard.readText())).searchParams.get("comparison"),"fixture-irregular-times");
 // The source inspector is gone: no Compare details, no click-to-inspect.
 assert.equal(await page.getByRole("button",{name:/Compare details|Inspect image/}).count(),0);
 const handle=page.getByRole("button",{name:"Move Blink window"});let box=await handle.boundingBox();
 await page.mouse.move(box.x+40,box.y+20);await page.mouse.down();await page.mouse.move(80,100,{steps:10});await page.mouse.up();
 let moved=await time.boundingBox();assert(moved.x<100);assert(moved.y<150);
 await handle.focus();const before=await time.boundingBox();await handle.press("ArrowRight");assert(Math.abs((await time.boundingBox()).x-before.x-20)<1);
 await page.getByRole("button",{name:"Reset layout",exact:true}).click();assert((await time.boundingBox()).x>300);
 await page.getByRole("button",{name:"Collapse Blink",exact:true}).click();assert.equal(await slider.isVisible(),false);
 await page.getByRole("button",{name:"Expand Blink",exact:true}).click();await slider.waitFor();
 await page.getByRole("button",{name:"Close Blink",exact:true}).click();assert.equal(await time.isVisible(),false);
 await page.getByRole("button",{name:"Blink",exact:true}).click();await date(page,"2025-06-15T04:20:00Z");
 // Closing a playing window pauses and retains the active frame.
 await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).click();await page.getByRole("button",{name:"Close Blink",exact:true}).click();
 await page.getByRole("button",{name:"Blink",exact:true}).click();await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).waitFor();
 // Deep replay still carries both IDs and marks on recorded frames.
 await page.goto(origin+"/?fixtures=1&comparison=fixture-matched-pair&finding=fixture-finding");await ready(page);
 await page.getByRole("region",{name:"Fixture discussion"}).waitFor();
 assert.equal(await page.locator('[aria-label="Saved finding mark"]').count(),1);
 await page.getByRole("button",{name:"Copy link",exact:true}).click();
 const link=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(new URL(link).searchParams.get("finding"),"fixture-finding");
 const fresh=await browser.newPage();await fresh.goto(link);await fresh.getByRole("region",{name:"Fixture discussion"}).waitFor();
 assert.equal(await fresh.locator('[aria-label="Saved finding mark"]').count(),1);await fresh.close();
 // An image failure disables blinking, then an explicit retry recovers.
 const broken=await browser.newPage();let fail=true;
 await broken.route("**/epoch-two.png",route=>{if(fail){fail=false;return route.fulfill({status:503,body:"unavailable"});}return route.continue();});
 await broken.goto(origin+"/?fixtures=1&comparison=fixture-matched-pair");await broken.getByRole("button",{name:"Retry images",exact:true}).waitFor();
 assert(await broken.getByRole("button",{name:"Blink A ↔ B",exact:true}).isDisabled());await broken.getByRole("button",{name:"Retry images",exact:true}).click();await ready(broken);await broken.close();
 await page.goto(origin+"/?fixtures=1&comparison=fixture-single-epoch");await page.getByText("One dated image is available. Blink needs at least two.",{exact:true}).waitFor();
 assert(await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).isDisabled());
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const mobile=await mobileContext.newPage();
 await mobile.goto(origin+"/?fixtures=1&comparison=fixture-matched-pair");await ready(mobile);
 const mobileTime=mobile.getByRole("region",{name:"Blink",exact:true});box=await mobileTime.boundingBox();assert(box.x>=0&&box.x+box.width<=390&&box.y+box.height<=844);
 await mobile.getByRole("button",{name:"Collapse Blink",exact:true}).tap();const mh=await mobile.getByRole("button",{name:"Move Blink window"}).boundingBox();
 const cdp=await mobileContext.newCDPSession(mobile);
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:mh.x+40,y:mh.y+20}]});
 await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:60,y:100}]});await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
 assert((await mobileTime.boundingBox()).y<150);
 await mobile.setViewportSize({width:320,height:568});box=await mobileTime.boundingBox();assert(box.x>=0&&box.x+box.width<=320&&box.y+box.height<=568);
 console.log("PASS: proportional time gaps, A/B blink, keyboard scrub/step, frame details, source and copy link in Blink, no inspector, drag/keyboard/reset/collapse/close, saved evidence replay, broken-image retry, single epoch, touch and resize bounds.");
}finally{await browser.close();}
