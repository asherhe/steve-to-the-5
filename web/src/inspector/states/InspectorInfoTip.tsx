import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A "?" disclosure that explains a catalog term in plain language.
 *
 *  Self-contained to the inspector slice so it carries no cross-slice styling or dependency.
 *  It explains what a label means; it never adds data or makes a claim. Keyboard accessible,
 *  closes on Escape or an outside click. */
export function InspectorInfoTip({ term, children }: { term: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <span className="si-info" ref={wrapper}>
      <button type="button" className="si-info__button" aria-expanded={open}
        aria-controls={open ? bubbleId : undefined}
        aria-label={`What does "${term}" mean?`} onClick={() => setOpen(!open)}>?</button>
      {open && (
        <span id={bubbleId} role="note" className="si-info__bubble">
          <span className="si-info__term">{term}</span>
          {children}
        </span>
      )}
    </span>
  );
}
