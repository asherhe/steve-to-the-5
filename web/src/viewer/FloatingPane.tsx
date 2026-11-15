import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { boundPane } from "./timeline";
let topLayer = 5;
export function FloatingPane({ id, title, open = true, onClose, anchor = "right", reset = 0, defaultCollapsed = false, children }: {
  id: string; title: string; open?: boolean; onClose?: () => void; anchor?: "left" | "right" | "time" | "map";
  reset?: number; defaultCollapsed?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{x:number;y:number} | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [layer, setLayer] = useState(5);
  const dragging = useRef<{x:number;y:number;left:number;top:number} | null>(null);
  function clamp(x: number, y: number) {
    const box = ref.current!.getBoundingClientRect();
    const next = boundPane(x,y,box.width,box.height,innerWidth,innerHeight);
    setPosition(old => old?.x === next.x && old?.y === next.y ? old : next);
  }
  const lastReset = useRef(reset);
  useLayoutEffect(() => {
    if (lastReset.current !== reset) {
      lastReset.current = reset; setPosition(null); setCollapsed(defaultCollapsed); return;
    }
    if (!open || !ref.current) return;
    function fit() {
      const box = ref.current!.getBoundingClientRect();
      if (position) clamp(position.x,position.y);
      else {
        const mobile = innerWidth < 672;
        const x = anchor === "time" ? (innerWidth-box.width)/2 : anchor === "left" || anchor === "map" ? 16 : innerWidth-box.width-16;
        const mapHeight = document.querySelector(".pane-map")?.getBoundingClientRect().height ?? 100;
        const y = anchor === "map" ? innerHeight-box.height-16 : anchor === "time" ? innerHeight-box.height-mapHeight-28 : mobile ? 80 : 76;
        clamp(x,y);
      }
    }
    fit(); const observer = new ResizeObserver(fit); observer.observe(ref.current!);
    window.addEventListener("resize",fit);
    return () => { observer.disconnect(); window.removeEventListener("resize",fit); };
  }, [open, position, anchor, collapsed, reset]);
  return <section ref={ref} id={id} role="region" aria-label={title} hidden={!open}
    className={`floating-pane pane-${anchor}`} style={{left:position?.x,top:position?.y,zIndex:layer}}
    onPointerDownCapture={() => setLayer(++topLayer)}
    onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setLayer(++topLayer); }}
    onKeyDown={event => { if(event.key === "Escape" && !event.defaultPrevented && onClose){event.stopPropagation();onClose();} }}>
    <header className="pane-heading">
      <button type="button" className="pane-drag" aria-label={`Move ${title} window`} title="Drag to move; arrow keys move the window"
        onPointerDown={event => {
          if(event.button !== 0)return;
          const box=ref.current!.getBoundingClientRect();
          dragging.current={x:event.clientX,y:event.clientY,left:box.left,top:box.top};
          event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
        }} onPointerMove={event => {const drag=dragging.current;if(drag)clamp(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);}}
        onPointerUp={event => {dragging.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
        onPointerCancel={() => {dragging.current=null;}}
        onKeyDown={event => {
          const delta: Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};
          if(delta[event.key]){event.preventDefault();const box=ref.current!.getBoundingClientRect();clamp(box.left+delta[event.key][0],box.top+delta[event.key][1]);}
        }}><span aria-hidden="true">⠿</span> {title}</button>
      <button type="button" aria-label={`${collapsed?"Expand":"Collapse"} ${title}`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed?"＋":"−"}</button>
      {onClose && <button type="button" aria-label={`Close ${title}`} onClick={onClose}>×</button>}
    </header>
    <div className="pane-body" hidden={collapsed}>{children}</div>
  </section>;
}
