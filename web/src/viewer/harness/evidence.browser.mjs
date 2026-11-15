const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless:true});
const origin=process.env.VIEWER_TEST_URL ?? 'http://127.0.0.1:5173';
const contexts=[];
async function session(mobile=false) {
 const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']}); contexts.push(c);
 await c.route('**/*', r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 const page=await c.newPage();page.setDefaultTimeout(10000);
 return [c,page];
}
try {
 const [c,p]=await session();
 await p.goto(origin+'/?fixtures=1&comparison=fixture-matched-pair&finding=fixture-finding');
 const discussion=p.getByRole('region',{name:'Fixture discussion'});
 await discussion.waitFor();
 async function evidence(page){await page.locator('.comparison-frame img').evaluate(img => img.decode()); return page.getByRole('region',{name:'Comparison playback'}).evaluate(el=>({width:el.querySelector('img').getAttribute('width'),height:el.querySelector('img').getAttribute('height'),text:el.textContent,src:el.querySelector('img').getAttribute('src'),mark:[...el.querySelectorAll('[aria-label="Saved finding mark"]')].map(m=>m.getAttribute('style'))}));}
 const first=await evidence(p);
 assert.match(first.text,/2025-06-15T04:20:00Z/);assert.equal(first.mark.length,1);
 await p.locator('#time-window .pane-drag').focus();
 await p.getByRole('button',{name:'Next observation',exact:true}).click();
 const second=await evidence(p);assert.match(second.text,/2025-12-15T03:10:00Z/);assert.notEqual(first.src,second.src);assert.notDeepEqual(first.mark,second.mark);
 await p.getByRole('button',{name:'Show evidence',exact:true}).click();await p.getByRole("region",{name:"Comparison playback"}).getByText("2025-06-15T04:20:00Z",{exact:true}).waitFor();
 assert.deepEqual(await evidence(p),first);
 await p.getByRole('button',{name:'Copy link',exact:true}).click();
 const link=await p.evaluate(()=>navigator.clipboard.readText());
 assert.equal(new URL(link).searchParams.get('finding'),'fixture-finding');
 await p.getByRole('button',{name:'More map options',exact:true}).press('Enter');await p.getByRole('button',{name:'Advanced search',exact:true}).press('Enter');
 await p.getByLabel('Right ascension').fill('42');await p.getByLabel('Declination',{exact:true}).fill('-20');await p.getByLabel('Field width (arcmin)').fill('12');
 await p.getByRole('button',{name:'Compare coordinates'}).click();
 await p.locator('#time-window .pane-drag').focus();
 await p.getByText('Development fixtures',{exact:true}).click();
 await p.getByLabel('Archive response').selectOption('single_epoch');
 await p.getByText('Observation 1 of 2',{exact:false}).waitFor({state:'hidden'});
 const [,fresh]=await session();await fresh.goto(link);await fresh.getByRole('region',{name:'Fixture discussion'}).waitFor();assert.deepEqual(await evidence(fresh),first);
 await fresh.locator('#time-window .pane-drag').focus();
 await fresh.getByRole('button',{name:'Next observation',exact:true}).click();assert.deepEqual(await evidence(fresh),second);
 await fresh.locator('#comparison-panel .pane-drag').focus();
 await fresh.getByRole('button',{name:'Copy comparison link',exact:true}).click();const plain=await fresh.evaluate(()=>navigator.clipboard.readText());assert.equal(new URL(plain).searchParams.has('finding'),false);
 await fresh.locator('#time-window .pane-drag').focus();
 await fresh.getByText('Development fixtures',{exact:true}).click();
 for(const [button,message] of [['Try missing ID','Saved comparison not found'],['Try missing finding','Saved finding not found. Check the finding ID.'],['Try mismatched evidence','This finding belongs to a different comparison. Open its own evidence link.']]){
  await fresh.getByRole('button',{name:button,exact:true}).click();await fresh.getByText(message,{exact:true}).waitFor();assert.equal(await fresh.getByRole('region',{name:'Comparison playback'}).count(),0);
 }
 await fresh.goto(origin+'/?fixtures=1&finding=fixture-finding');await fresh.getByRole('region',{name:'Fixture discussion'}).waitFor();assert.deepEqual(await evidence(fresh),first);
 const [,mobile]=await session(true);await mobile.goto(link);await mobile.getByRole('region',{name:'Fixture discussion'}).waitFor();assert.deepEqual(await evidence(mobile),first);await mobile.locator('#time-window .pane-drag').focus();await mobile.getByRole('button',{name:'Next observation',exact:true}).click();assert.deepEqual(await evidence(mobile),second);
 console.log('PASS: offline desktop/mobile replay, frame-specific marks, Show evidence reset, clipboard links, fresh-session replay after changed search/scenario, missing comparison/finding, mismatched IDs, finding-only links.');
} finally {await browser.close();}
