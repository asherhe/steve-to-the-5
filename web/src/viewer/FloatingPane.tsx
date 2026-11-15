import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { boundPane } from "./timeline";
let topLayer = 5;
export function FloatingPane({ id, title, open = true, onClose, anchor = "right", reset = 0, defaultCollapsed = false, badge, size = "normal", children }: {
  id: string; title: string; open?: boolean; onClose?: () => void; anchor?: "left" | "right" | "time" | "map";
  size?: "normal" | "wide" | "large"; reset?: number; defaultCollapsed?: boolean; badge?: ReactNode; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{x:number;y:number} | null>(null);
  const positionRef = useRef(position);
  const manuallyMoved = useRef(false);
  positionRef.current = position;
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [layer, setLayer] = useState(5);
  const dragging = useRef<{x:number;y:number;left:number;top:number} | null>(null);
  function clamp(x: number, y: number) {
    const box = ref.current!.getBoundingClientRect();
    const next = boundPane(x,y,box.width,box.height,innerWidth,innerHeight,72);
    positionRef.current = next;
    setPosition(old => old?.x === next.x && old?.y === next.y ? old : next);
  }
  useLayoutEffect(() => {
    if(open){setLayer(++topLayer);ref.current?.querySelector<HTMLButtonElement>(".pane-drag")?.focus({preventScroll:true});}
  },[open]);
  const lastReset = useRef(reset);
  useLayoutEffect(() => {
    if (lastReset.current !== reset) {
      lastReset.current = reset; positionRef.current = null; manuallyMoved.current = false; setCollapsed(defaultCollapsed);
    }
    if (!open || !ref.current) return;
    function fit() {
      const box = ref.current!.getBoundingClientRect();
      if (manuallyMoved.current && positionRef.current) clamp(positionRef.current.x,positionRef.current.y);
      else {
        const mobile = innerWidth < 672;
        // The header bar and spectral dock publish their heights on the workspace; stay clear of both.
        const style = getComputedStyle(ref.current!.closest(".sky-workspace") ?? document.documentElement);
        const header = parseFloat(style.getPropertyValue("--header-height")) || 60;
        const dock = parseFloat(style.getPropertyValue("--dock-height")) || 144;
        // Keep the time controls away from the comparison centre on wider screens.
        const x = anchor === "time" ? (mobile ? (innerWidth-box.width)/2 : 16) : anchor === "left" || anchor === "map" ? 16 : innerWidth-box.width-16;
        const top = 14 + header + 14;
        const y = anchor === "map" ? innerHeight-box.height-16 : anchor === "time" ? (mobile ? top : innerHeight-dock-box.height-28) : top;
        clamp(x,y);
      }
    }
    fit(); const observer = new ResizeObserver(fit); observer.observe(ref.current!);
    const workspace = ref.current!.closest(".sky-workspace");
    for (const element of workspace?.querySelectorAll(".instrument-bar, .sky-dock") ?? []) observer.observe(element);
    window.addEventListener("resize",fit);
    return () => { observer.disconnect(); window.removeEventListener("resize",fit); };
  }, [open, anchor, collapsed, reset]);
  return <section ref={ref} id={id} role="region" aria-label={title} hidden={!open}
    className={`floating-pane pane-${anchor} pane-size-${size}`} style={{left:position?.x,top:position?.y,zIndex:layer}}
    onPointerDownCapture={() => setLayer(++topLayer)}
    onFocusCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setLayer(++topLayer); }}
    onKeyDown={event => { if(event.key === "Escape" && !event.defaultPrevented && onClose){event.stopPropagation();onClose();} }}>
    <header className="pane-heading">
      <button type="button" className="pane-drag" aria-label={`Move ${title} window`} title="Drag to move; arrow keys move the window"
        onPointerDown={event => {
          if(event.button !== 0)return;
          const box=ref.current!.getBoundingClientRect();
          manuallyMoved.current = true;
          dragging.current={x:event.clientX,y:event.clientY,left:box.left,top:box.top};
          event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
        }} onPointerMove={event => {const drag=dragging.current;if(drag)clamp(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);}}
        onPointerUp={event => {dragging.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
        onPointerCancel={() => {dragging.current=null;}}
        onLostPointerCapture={() => {dragging.current=null;}}
        onKeyDown={event => {
          const delta: Record<string,[number,number]>={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};
          if(delta[event.key]){manuallyMoved.current = true;event.preventDefault();const box=ref.current!.getBoundingClientRect();clamp(box.left+delta[event.key][0],box.top+delta[event.key][1]);}
        }}><span aria-hidden="true">⠿</span> {title}</button>
      {badge && <span className="pane-badge">{badge}</span>}
      <button type="button" aria-label={`${collapsed?"Expand":"Collapse"} ${title}`} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed?"＋":"−"}</button>
      {onClose && <button type="button" aria-label={`Close ${title}`} onClick={onClose}>×</button>}
    </header>
    <div className="pane-body" hidden={collapsed}>{children}</div>
  </section>;
}
