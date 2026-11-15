import { useEffect, useRef, useState } from "react";
import type { AladinImage, AladinView } from "aladin-lite";
import type { Comparison, ComparisonFrame, SkyPosition } from "./comparison";
import type { Asset } from "./usePlayback";
import { cutoutWcs } from "./cutoutWcs";

type AladinModule = typeof import("aladin-lite").default;
export interface DatedLayer {
  comparison: Comparison; frame: ComparisonFrame; assets: Record<string, Asset>; attempt: number;
  selected: SkyPosition | null;
  marks: readonly (SkyPosition & { frameId: string })[];
  predictedMark: SkyPosition | null;
  predictedLabel?: string;
}
// Raster layers use the already-rendered PNGs and their saved FITS WCS. The
// transparent canvas adds only the footprint and annotations, never a new stretch.
export function DatedSkyOverlay({ sky, aladin, dated, redraw }: {sky: AladinView; aladin: AladinModule; dated:DatedLayer;redraw:unknown}) {
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const layers=useRef(new Map<string,{id:string;image:AladinImage;ready:boolean}>());
  const canvas=useRef<HTMLCanvasElement>(null);
  const active=useRef(dated.frame.id);active.current=dated.frame.id;
  const [ready,setReady]=useState<Record<string,boolean>>({});
  const [failure,setFailure]=useState(false);
  const [label,setLabel]=useState<{x:number;y:number}|null>(null);
  const wcs=cutoutWcs(dated.comparison.grid);
  const predictedMark = ready[dated.frame.id] ? dated.predictedMark : null;
  useEffect(()=>{
    if (!wcs) return;
    const entries=layers.current;
    for(const frame of dated.comparison.frames){
      if(dated.assets[frame.id]?.state!=="ready" || entries.has(frame.id))continue;
      const id=`dated-${dated.comparison.id}-${frame.id}-${dated.attempt}`;
      const image=aladin.image(frame.imageUrl,{
        name:`Dated SPHEREx ${frame.observedAtUtc}`,imgFormat:"png",opacity:0,
        wcs:{...dated.comparison.grid.fitsHeader,NAXIS:2,NAXIS1:dated.comparison.grid.width,NAXIS2:dated.comparison.grid.height},
        successCallback:(_ra,_dec,_fov,added)=>{
          if(!entries.has(frame.id)){sky.removeImageLayer(id);return;}
          entries.get(frame.id)!.ready=true;
          added.setOpacity(active.current===frame.id?1:0);
          setReady(old=>({...old,[frame.id]:true}));
        },
        errorCallback:()=>{if(mounted.current)setFailure(true);},
      });
      entries.set(frame.id,{id,image,ready:false});sky.setOverlayImageLayer(image,id);
    }
  },[dated.assets,dated.comparison,dated.attempt,sky,aladin]);
  useEffect(()=>{
    for(const [frameId,entry] of layers.current)if(entry.ready)entry.image.setOpacity(frameId===dated.frame.id && dated.assets[frameId]?.state==="ready"?1:0);
  },[dated.frame.id,dated.assets,ready]);
  useEffect(()=>{
    const entries=layers.current;
    return ()=>{for(const entry of entries.values())sky.removeImageLayer(entry.id);entries.clear();};
  },[sky]);
  useEffect(()=>{
    const task=requestAnimationFrame(()=>{
      const element=canvas.current;if(!element || !wcs)return;
      const box=element.getBoundingClientRect();const scale=devicePixelRatio || 1;
      element.width=Math.round(box.width*scale);element.height=Math.round(box.height*scale);
      const context=element.getContext("2d")!;context.scale(scale,scale);
      const grid=dated.comparison.grid;
      const skyPoint=(x:number,y:number)=>{const pos=wcs.toSky({x,y});return sky.world2pix(pos.ra,pos.dec);};
      const points:([number,number]|undefined)[]=[];
      for(let i=0;i<=16;i++)points.push(skyPoint(-0.5+i*grid.width/16,-0.5));
      for(let i=1;i<=16;i++)points.push(skyPoint(grid.width-0.5,-0.5+i*grid.height/16));
      for(let i=1;i<=16;i++)points.push(skyPoint(grid.width-0.5-i*grid.width/16,grid.height-0.5));
      for(let i=1;i<=16;i++)points.push(skyPoint(-0.5,grid.height-0.5-i*grid.height/16));
      context.strokeStyle="#8ce5ff";context.lineWidth=1.5;context.setLineDash([5,4]);context.beginPath();
      let previous:[number,number]|undefined;
      for(const point of points){
        if(point && point.every(Number.isFinite)){
          if(previous && Math.hypot(previous[0]-point[0],previous[1]-point[1])<box.width/2)context.lineTo(...point);
          else context.moveTo(...point);
          previous=point;
        }else previous=undefined;
      }
      context.stroke();context.setLineDash([]);
      const corner=points.find(point=>point && point[0]>=0 && point[0]<=box.width && point[1]>=0 && point[1]<=box.height);
      setLabel(corner?{x:Math.max(8,Math.min(box.width-240,corner[0])),y:Math.max(70,Math.min(box.height-30,corner[1]))}:null);
      function mark(position:SkyPosition,color:string){const point=sky.world2pix(position.ra,position.dec);if(!point || !point.every(Number.isFinite))return;context.strokeStyle=color;context.beginPath();context.arc(...point,7,0,2*Math.PI);context.stroke();}
      if(dated.selected)mark(dated.selected,"#8ce5ff");
      for(const saved of dated.marks)if(saved.frameId===dated.frame.id)mark(saved,"#8ce5ff");
      if(predictedMark) {
        mark(predictedMark,"#ffd08e");
        const point=sky.world2pix(predictedMark.ra,predictedMark.dec);
        if(point && point.every(Number.isFinite) && dated.predictedLabel) {
          context.fillStyle="#ffd08e"; context.font="12px sans-serif";
          context.fillText(`${dated.predictedLabel} (predicted)`,point[0]+10,point[1]-10);
        }
      }
    });
    return ()=>cancelAnimationFrame(task);
  },[sky,dated,redraw,predictedMark]);
  return <>
    <canvas ref={canvas} className="dated-footprint"
      aria-label={predictedMark ? "Dated-image footprint, frame marks and predicted Gaia position" : "Dated-image footprint and frame marks"} />
    {label&&<p className="dated-label" style={{left:label.x,top:label.y}}>Dated SPHEREx · {dated.frame.observedAtUtc.slice(0,10)}{dated.frame.release==="Synthetic"?" · synthetic":""}</p>}
    {(!wcs || failure)&&<p className="dated-overlay-status" role="status">Sky overlay unavailable for this grid. Open Compare details to inspect the saved image.</p>}
    {wcs && !ready[dated.frame.id] && dated.assets[dated.frame.id]?.state==="ready" && <p className="dated-overlay-status" role="status">Placing dated image on the sky…</p>}
  </>;
}
