const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??"playwright");
import assert from "node:assert/strict";
const origin=process.env.VIEWER_TEST_URL??"http://127.0.0.1:5173";
const browser=await chromium.launch({channel:"chrome",headless:true});
async function date(page,expected){await page.waitForFunction(expected=>document.querySelector(".active-date time")?.getAttribute("datetime")===expected,expected);}
async function ready(page){await page.waitForFunction(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent==="Blink A ↔ B");return b&&!b.disabled;});}
try{
 const context=await browser.newContext({viewport:{width:1400,height:950},permissions:["clipboard-read","clipboard-write"]});
 await context.addInitScript(()=>localStorage.setItem("spherex.tutorial.review-v1.seen","1"));
 const page=await context.newPage();page.setDefaultTimeout(15000);
 await page.goto(origin+"/?fixtures=1&comparison=fixture-irregular-times");await ready(page);
 const time=page.getByRole("region",{name:"Time",exact:true});
 assert.equal(await page.getByRole("region",{name:"Compare details",exact:true}).isVisible(),false);
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
 await page.getByRole("button",{name:"Compare details",exact:true}).click();
 const details=page.getByRole("region",{name:"Compare details",exact:true});await details.waitFor();
 await details.locator("img").evaluate(img=>img.decode());
 assert.equal(await details.locator("figcaption time").getAttribute("datetime"),"2025-06-15T04:20:00Z");
 await details.getByRole("button",{name:"Inspect image. Press Enter to inspect its center."}).focus();await page.keyboard.press("Enter");
 await page.locator("#gaia-panel").waitFor();assert(await time.isVisible());assert(await details.isVisible());
 await page.getByRole("button",{name:"Close Source inspector"}).click();await page.getByRole("button",{name:"Close Compare details"}).click();
 const handle=page.getByRole("button",{name:"Move Time window"});let box=await handle.boundingBox();
 await page.mouse.move(box.x+40,box.y+20);await page.mouse.down();await page.mouse.move(80,100,{steps:10});await page.mouse.up();
 let moved=await time.boundingBox();assert(moved.x<100);assert(moved.y<150);
 await handle.focus();const before=await time.boundingBox();await handle.press("ArrowRight");assert(Math.abs((await time.boundingBox()).x-before.x-20)<1);
 await page.getByRole("button",{name:"Reset layout",exact:true}).click();assert.equal((await time.boundingBox()).x,16);
 await page.getByRole("button",{name:"Collapse Time",exact:true}).click();assert.equal(await slider.isVisible(),false);
 await page.getByRole("button",{name:"Expand Time",exact:true}).click();await slider.waitFor();
 await page.getByRole("button",{name:"Close Time",exact:true}).click();assert.equal(await time.isVisible(),false);
 await page.getByRole("button",{name:"Time",exact:true}).click();await date(page,"2025-06-15T04:20:00Z");
 // Closing a playing window pauses and retains the active frame.
 await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).click();await page.getByRole("button",{name:"Close Time",exact:true}).click();
 await page.getByRole("button",{name:"Time",exact:true}).click();await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).waitFor();
 // Deep replay still carries both IDs and marks on recorded frames.
 await page.goto(origin+"/?fixtures=1&comparison=fixture-matched-pair&finding=fixture-finding");await ready(page);
 await page.getByRole("region",{name:"Fixture discussion"}).waitFor();
 assert.equal(await page.locator('[aria-label="Saved finding mark"]').count(),1);
 await page.getByRole("button",{name:"Copy link",exact:true}).click();
 const link=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(new URL(link).searchParams.get("finding"),"fixture-finding");
 const fresh=await context.newPage();await fresh.goto(link);await fresh.getByRole("region",{name:"Fixture discussion"}).waitFor();
 assert.equal(await fresh.locator('[aria-label="Saved finding mark"]').count(),1);await fresh.close();
 // An image failure disables blinking, then an explicit retry recovers.
 const broken=await context.newPage();let fail=true;
 await broken.route("**/epoch-two.png",route=>{if(fail){fail=false;return route.fulfill({status:503,body:"unavailable"});}return route.continue();});
 await broken.goto(origin+"/?fixtures=1&comparison=fixture-matched-pair");await broken.getByRole("button",{name:"Retry images",exact:true}).waitFor();
 assert(await broken.getByRole("button",{name:"Blink A ↔ B",exact:true}).isDisabled());await broken.getByRole("button",{name:"Retry images",exact:true}).click();await ready(broken);await broken.close();
 await page.goto(origin+"/?fixtures=1&comparison=fixture-single-epoch");await page.getByText("One dated image is available. Blink needs at least two.",{exact:true}).waitFor();
 assert(await page.getByRole("button",{name:"Blink A ↔ B",exact:true}).isDisabled());
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const mobile=await mobileContext.newPage();
 await mobileContext.addInitScript(()=>localStorage.setItem("spherex.tutorial.review-v1.seen","1"));
 await mobile.goto(origin+"/?fixtures=1&comparison=fixture-matched-pair");await ready(mobile);
 const mobileTime=mobile.getByRole("region",{name:"Time",exact:true});box=await mobileTime.boundingBox();assert(box.x>=0&&box.x+box.width<=390&&box.y+box.height<=844);
 await mobile.getByRole("button",{name:"Collapse Time",exact:true}).tap();const mh=await mobile.getByRole("button",{name:"Move Time window"}).boundingBox();
 const cdp=await mobileContext.newCDPSession(mobile);
 await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:mh.x+40,y:mh.y+20}]});
 await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:60,y:100}]});await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
 assert((await mobileTime.boundingBox()).y<150);
 await mobile.setViewportSize({width:320,height:568});box=await mobileTime.boundingBox();assert(box.x>=0&&box.x+box.width<=320&&box.y+box.height<=568);
 console.log("PASS: proportional time gaps, A/B blink, keyboard scrub/step, shared inspector/details state, drag/keyboard/reset/collapse/close, saved evidence replay, broken-image retry, single epoch, touch and resize bounds.");
}finally{await browser.close();}
