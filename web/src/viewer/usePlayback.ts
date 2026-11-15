import { useEffect, useMemo, useState } from "react";
import type { Comparison } from "./comparison";
export type Asset = { state: "loading" | "ready" | "failed"; image?: HTMLImageElement };
type Mode = "paused" | "blink" | "play";
export function usePlayback(comparison: Comparison | null, enabled: boolean) {
  const frames = useMemo(() => [...(comparison?.frames ?? [])].sort((a,b) => Date.parse(a.observedAtUtc)-Date.parse(b.observedAtUtc)), [comparison]);
  const initial = { id: comparison?.id, index: 0, a: 0, b: Math.max(0, frames.length-1), mode: "paused" as Mode, speed: 1 };
  const [stored, setStored] = useState(initial);
  const state = stored.id === comparison?.id ? stored : initial;
  const [assets, setAssets] = useState<{ id?: string; values: Record<string, Asset> }>({ values: {} });
  const [attempt, setAttempt] = useState(0);
  const currentAssets = assets.id === comparison?.id ? assets.values : {};
  const frame = frames[state.index];
  function update(patch: Partial<typeof initial>) { setStored({ ...state, ...patch }); }
  useEffect(() => {
    let cancelled = false;
    const values: Record<string, Asset> = {};
    const images = frames.map(frame => {
      const image = new Image(); values[frame.id] = { state: "loading" };
      image.onload = () => {
        void image.decode().then(() => {
          if (cancelled) return;
          values[frame.id] = image.naturalWidth === comparison?.grid.width && image.naturalHeight === comparison?.grid.height
            ? { state: "ready", image } : { state: "failed" };
          setAssets({ id: comparison?.id, values: { ...values } });
        }).catch(() => image.onerror?.(new Event("error")));
      };
      image.onerror = () => { if (!cancelled) { values[frame.id] = { state: "failed" }; setAssets({ id: comparison?.id, values: { ...values } }); } };
      image.src = frame.imageUrl;
      return image;
    });
    setAssets({ id: comparison?.id, values: { ...values } });
    return () => { cancelled = true; images.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [comparison, frames, attempt]);
  const ready = (index: number) => currentAssets[frames[index]?.id]?.state === "ready";
  useEffect(() => {
    if (!enabled || (frame && currentAssets[frame.id]?.state === "failed")) {
      setStored(previous => ({ ...(previous.id === comparison?.id ? previous : initial), mode: "paused" }));
    }
  }, [enabled, comparison?.id, frame?.id, currentAssets[frame?.id]?.state]);
  useEffect(() => {
    function pause() { if (document.hidden) setStored(s => ({ ...s, mode: "paused" })); }
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  useEffect(() => {
    if (!enabled || state.mode === "paused" || !ready(state.index) || frames.length < 2) return;
    const next = state.mode === "blink" ? (state.index === state.a ? state.b : state.a) : (state.index+1)%frames.length;
    if (!ready(next)) return;
    const timer = setTimeout(() => setStored({ ...state, index: next }), 1000/state.speed);
    return () => clearTimeout(timer);
  }, [enabled, state, frames, currentAssets]);
  return {
    ...state, frames, frame, assets: currentAssets, attempt,
    select(index: number) { update({ index: Math.max(0, Math.min(frames.length-1,index)), mode: "paused" }); },
    pause() { update({ mode: "paused" }); },
    blink() { update(state.mode === "blink" ? { mode: "paused" } : { index: state.a, mode: "blink" }); },
    play() { update({ mode: state.mode === "play" ? "paused" : "play" }); },
    setEndpoint(which: "a" | "b", index: number) { update({ [which]: index, mode: "paused" }); },
    setSpeed(speed: number) { update({ speed }); },
    retry() { update({ mode: "paused" }); setAttempt(a => a+1); },
    fail() { if (frame) setAssets(a => ({ ...a, values: { ...a.values, [frame.id]: { state: "failed" } } })); },
    canBlink: frames.length > 1 && state.a !== state.b && ready(state.a) && ready(state.b),
  };
}
export type Playback = ReturnType<typeof usePlayback>;
