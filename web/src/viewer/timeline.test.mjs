import {test} from "node:test";
import assert from "node:assert/strict";
import {timeFraction,nearestFrame,boundPane} from "./timeline.ts";
test("timeline keeps real gaps and snaps to actual observations",()=>{
 const times=[0,10,100];assert.equal(timeFraction(times,1),0.1);
 assert.equal(nearestFrame(times,38),1);assert.equal(nearestFrame(times,90),2);
 assert.equal(nearestFrame(times,-20),0);assert.equal(nearestFrame(times,110),2);
});
test("coincident observation dates remain finite",()=>assert.equal(timeFraction([10,10],1),0.5));
test("windows stay reachable on small and resized viewports",()=>{
 assert.deepEqual(boundPane(-100,-200,300,400,390,844),{x:8,y:8});
 assert.deepEqual(boundPane(1000,1000,300,400,390,844),{x:82,y:436});
 assert.deepEqual(boundPane(1000,1000,1000,1000,390,844),{x:8,y:8});
});

test("tall panes leave the toolbar and close handle reachable",()=>assert.deepEqual(boundPane(1000,1000,300,1000,390,844,72),{x:82,y:72}));
