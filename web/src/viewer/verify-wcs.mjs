import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cutoutWcs } from "./cutoutWcs.ts";

if (!process.env.RESPONSE_FILE) throw new Error("Set RESPONSE_FILE to a saved archive response JSON.");
const { comparison } = JSON.parse(await readFile(process.env.RESPONSE_FILE, "utf8"));
const { grid } = comparison;
const points = [{x:0,y:0},{x:(grid.width-1)/2,y:(grid.height-1)/2},{x:grid.width-1,y:grid.height-1},{x:grid.width*0.25,y:grid.height*0.75}];
const python = process.env.ARCHIVE_PYTHON ?? fileURLToPath(new URL("../../../services/archive/.venv/bin/python", import.meta.url));
const result = spawnSync(python, ["-c", `
import json,sys
from astropy.wcs import WCS
v=json.load(sys.stdin)
w=WCS(v['grid']['fitsHeader'])
print(json.dumps([dict(zip(['ra','dec'],map(float,w.all_pix2world(p['x'],v['grid']['height']-1-p['y'],0)))) for p in v['points']]))
`], {input:JSON.stringify({grid,points}),encoding:"utf8"});
if(result.status!==0) throw new Error(result.stderr);
const expected=JSON.parse(result.stdout);
const wcs=cutoutWcs(grid);assert(wcs,"Viewer must support this archive grid");
let maxSkyErrorDeg=0,maxPixelError=0;
for(let i=0;i<points.length;i++){
  const sky=wcs.toSky(points[i]);
  const raError=Math.abs(((sky.ra-expected[i].ra+540)%360)-180);
  const skyError=Math.max(raError,Math.abs(sky.dec-expected[i].dec));
  const pixel=wcs.toImage(expected[i]);assert(pixel);
  const pixelError=Math.max(Math.abs(pixel.x-points[i].x),Math.abs(pixel.y-points[i].y));
  maxSkyErrorDeg=Math.max(maxSkyErrorDeg,skyError);maxPixelError=Math.max(maxPixelError,pixelError);
  assert(skyError<1e-8);assert(pixelError<1e-6);
}
console.log(JSON.stringify({comparisonId:comparison.id,points:points.length,maxSkyErrorDeg,maxPixelError,skyToleranceDeg:1e-8,pixelTolerance:1e-6}));
