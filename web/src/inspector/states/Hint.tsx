import { useId, useState } from "react";

/** A "?" toggle that reveals a one-line definition. Works by keyboard and touch. */
export function Hint({ term, children }: { term: string; children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        className="si-hint"
        aria-label={`What is ${term}?`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        ?
      </button>
      <span id={id} className="si-hint__text" hidden={!open}>
        {children}
      </span>
    </>
  );
}
