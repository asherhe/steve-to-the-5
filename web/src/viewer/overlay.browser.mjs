const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??"playwright");
import assert from "node:assert/strict";
const origin=process.env.VIEWER_TEST_URL??"http://127.0.0.1:5173";
const browser=await chromium.launch({channel:"chrome",headless:true});
// The first-run tour covers the page and intercepts clicks; mark it seen before each page loads.
const skipTour=()=>localStorage.setItem("spherex.tutorial.review-v1.seen","1");
for(const make of ["newContext","newPage"]){const original=browser[make].bind(browser);browser[make]=async(...args)=>{const made=await original(...args);await made.addInitScript(skipTour);return made;};}
try{
 const page=await browser.newPage({viewport:{width:1400,height:950}});
 const png=await page.evaluate(()=>{const canvas=document.createElement("canvas");canvas.width=320;canvas.height=240;const ctx=canvas.getContext("2d");
   for(const [x,y,color] of [[40,40,"rgb(224,32,16)"],[240,50,"rgb(30,200,70)"],[190,170,"rgb(60,120,200)"]]){ctx.fillStyle=color;ctx.fillRect(x,y,30,30);}return canvas.toDataURL("image/png").split(",")[1];});
 let searches=0;
 await page.route("**/*",route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==="/diagnostic-alpha.png")return route.fulfill({contentType:"image/png",body:Buffer.from(png,"base64")});
   if(url.pathname==="/api/comparisons")searches++;
   if(url.pathname==="/api/comparisons/overlay-diagnostic")return route.fulfill({json:{status:"single_epoch",comparison:{id:"overlay-diagnostic",field:{ra:120,dec:15,fovArcmin:8},wavelengthRangeUm:[2.19,2.21],stretch:{lower:0,upper:255,unit:"diagnostic"},frames:[{id:"diagnostic",observedAtUtc:"2025-06-15T04:20:00Z",wavelengthUm:2.2,release:"Synthetic",imageUrl:"/diagnostic-alpha.png",sourceUrl:null,qualityFlags:{}}],grid:{width:320,height:240,projection:"TAN",coordinateFrame:"ICRS",rowOrigin:"top",fitsHeader:{CTYPE1:"RA---TAN",CTYPE2:"DEC--TAN",CUNIT1:"deg",CUNIT2:"deg",CRPIX1:160.5,CRPIX2:120.5,CRVAL1:120,CRVAL2:15,CDELT1:-8/60/320,CDELT2:8/60/320}}}}});
   return route.continue();
 });
 await page.goto(origin+"/?comparison=overlay-diagnostic");await page.locator(".dated-footprint").waitFor();
 await page.waitForFunction(()=>!document.querySelector(".dated-overlay-status"));
 await page.getByRole("button",{name:"Close Blink",exact:true}).click();
 async function footprint(){return page.locator(".dated-footprint").evaluate(canvas=>{
   const image=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height);let left=canvas.width,top=canvas.height,right=0,bottom=0;
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(image.data[(y*canvas.width+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
   return {left:left/devicePixelRatio,top:top/devicePixelRatio,right:right/devicePixelRatio,bottom:bottom/devicePixelRatio};
 });}
 const box=await footprint();assert(box.right>box.left&&box.bottom>box.top);
 const screenshot=await page.screenshot();
 const colors=await page.evaluate(async({base64,box})=>{
   const image=new Image();image.src="data:image/png;base64,"+base64;await image.decode();
   const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);
   const sample=(x,y)=>[...ctx.getImageData(Math.round(x),Math.round(y),1,1).data].slice(0,3);
   const mapped=(x,y)=>sample(box.left+(box.right-box.left)*x/320,box.top+(box.bottom-box.top)*y/240);
   return {red:mapped(55,55),green:mapped(255,65),blue:mapped(205,185),transparent:mapped(50,120),background:sample(box.left-20,(box.top+box.bottom)/2)};
 },{base64:screenshot.toString("base64"),box});
 assert.deepEqual(colors.red,[224,32,16]);assert.deepEqual(colors.green,[30,200,70]);assert.deepEqual(colors.blue,[60,120,200]);
 assert.deepEqual(colors.transparent,colors.background);
 const before=await page.locator(".sky-readout").innerText();
 await page.getByRole("button",{name:"Zoom in",exact:true}).click();
 await page.waitForFunction(before=>document.querySelector(".sky-readout").textContent!==before,before);
 // The readout updates before the overlay redraws; wait for the footprint to grow.
 let zoomed=await footprint();for(let i=0;i<30&&!(zoomed.right-zoomed.left>(box.right-box.left)*1.8);i++){await page.waitForTimeout(100);zoomed=await footprint();}
 assert(zoomed.right-zoomed.left>(box.right-box.left)*1.8,JSON.stringify({box,zoomed}));
 await page.mouse.move(300,150);await page.mouse.down();await page.mouse.move(350,190,{steps:10});await page.mouse.up();
 await page.getByRole("button",{name:"More map options",exact:true}).click();await page.getByRole("button",{name:"All-sky view",exact:true}).click();
 assert.equal(searches,0);await page.getByText(/Dated SPHEREx · 2025-06-15/).waitFor();
 console.log("PASS: native sky raster orientation matches WCS footprint; RGB values and transparency preserved; zoom/pan/projection retain the dated overlay without comparison searches.");
}finally{await browser.close();}
