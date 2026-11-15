import { useState } from "react";
import type { Comparison } from "./comparison";
import type { Playback } from "./usePlayback";
import { frameTimes, nearestFrame, timeFraction } from "./timeline";
export const shortDate = (date: string) => new Date(date).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric",timeZone:"UTC"});
export function TimeControls({ comparison, playback: p, onDetails }: {comparison: Comparison;playback:Playback;onDetails:()=>void}) {
  const [settings,setSettings]=useState(false);
  const times=frameTimes(p.frames);const first=times[0];const last=times[times.length-1];
  const state=p.assets[p.frame.id]?.state ?? "loading";
  return <div className="time-controls">
    <div className="active-date"><time dateTime={p.frame.observedAtUtc}>{shortDate(p.frame.observedAtUtc)}</time><span>UTC · {p.index+1} / {p.frames.length}</span></div>
    <p className="time-field">RA {comparison.field.ra.toFixed(4)}° · Dec {comparison.field.dec.toFixed(4)}° · {comparison.field.fovArcmin} arcmin</p>
    <div className="time-axis">
      <div className="time-ticks" aria-hidden="true">{p.frames.map((f,i)=><span key={f.id} style={{left:`${timeFraction(times,i)*100}%`}} />)}</div>
      <input aria-label="Observation time" type="range" min={first} max={last>first?last:first+1} step="any" value={times[p.index]}
        disabled={p.frames.length<2} aria-valuetext={p.frame.observedAtUtc}
        onChange={event=>p.select(nearestFrame(times,Number(event.target.value)))}
        onKeyDown={event=>{if(["ArrowLeft","ArrowDown","ArrowRight","ArrowUp","Home","End"].includes(event.key)){
          event.preventDefault();p.select(event.key==="Home"?0:event.key==="End"?p.frames.length-1:p.index+(["ArrowLeft","ArrowDown"].includes(event.key)?-1:1));
        }}} />
      <div className="time-end-dates"><span>{shortDate(p.frames[0].observedAtUtc)}</span><span>{shortDate(p.frames.at(-1)!.observedAtUtc)}</span></div>
    </div>
    <div className="time-transport">
      <button type="button" aria-label="Previous observation" disabled={p.index===0} onClick={()=>p.select(p.index-1)}>◀</button>
      <button type="button" className="blink-button" disabled={!p.canBlink && p.mode!=="blink"} onClick={p.blink}>{p.mode==="blink"?"Pause blink":"Blink A ↔ B"}</button>
      <button type="button" aria-label="Next observation" disabled={p.index===p.frames.length-1} onClick={()=>p.select(p.index+1)}>▶</button>
    </div>
    {p.frames.length>1?<div className="blink-endpoints">{(["a","b"] as const).map(which=><label key={which}>{which.toUpperCase()}
      <select aria-label={`Blink ${which.toUpperCase()} observation`} value={p[which]} onChange={event=>p.setEndpoint(which,Number(event.target.value))}>
        {p.frames.map((f,i)=><option key={f.id} value={i} disabled={i===p[which==="a"?"b":"a"]}>{shortDate(f.observedAtUtc)} · {i+1}</option>)}
      </select></label>)}</div>:<p>One dated image is available. Blink needs at least two.</p>}
    {state==="failed"?<p role="status">This frame could not be loaded. <button onClick={p.retry}>Retry frame</button></p>:state==="loading"?<p role="status">Loading dated image…</p>:null}
    {p.frames.some(f=>p.assets[f.id]?.state==="failed") && state!=="failed" && <p role="status">An observation failed to load. <button onClick={p.retry}>Retry images</button></p>}
    <p className="time-science">{comparison.wavelengthRangeUm.map(v=>v.toFixed(3)).join("–")} µm · one shared brightness scale</p>
    <div className="time-actions"><button type="button" onClick={onDetails}>Compare details</button><button type="button" aria-label="Playback settings" aria-expanded={settings} onClick={()=>setSettings(!settings)}>⚙</button></div>
    {settings&&<div className="playback-settings"><label>Switches per second<select value={p.speed} onChange={e=>p.setSpeed(Number(e.target.value))}><option value={0.5}>0.5</option><option value={1}>1</option><option value={2}>2</option></select></label>
      <button type="button" disabled={p.frames.length<2 || state!=="ready"} onClick={p.play}>{p.mode==="play"?"Pause sequence":"Play all observations"}</button></div>}
  </div>;
}
