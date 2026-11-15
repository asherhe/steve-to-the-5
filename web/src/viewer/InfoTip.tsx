import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A small "?" button that reveals a plain-language explanation of a term.
 *
 *  Beginner-facing help for astronomy jargon a casual visitor would not know. It is a
 *  disclosure, not a claim: the content explains what a label means, it does not add data.
 *  The popover is keyboard accessible, closes on Escape or an outside click, and is
 *  announced to assistive tech through the describing region. */
export function InfoTip({ term, children }: { term: string; children: ReactNode }) {
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
    <span className="info-tip" ref={wrapper}>
      <button type="button" className="info-tip-button" aria-expanded={open}
        aria-controls={open ? bubbleId : undefined}
        aria-label={`What does "${term}" mean?`} onClick={() => setOpen(!open)}>?</button>
      {open && (
        <span id={bubbleId} role="note" className="info-tip-bubble">
          <span className="info-tip-term">{term}</span>
          {children}
        </span>
      )}
    </span>
  );
}
