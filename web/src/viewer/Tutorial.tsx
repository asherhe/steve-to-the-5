import { useEffect, useRef, useState } from "react";

/** First-run walkthrough that introduces the viewer in plain language.
 *
 *  It explains what the tool shows and how to use it, without making any scientific claim:
 *  every step mirrors wording already in the brief (matched monochrome playback, honest
 *  coverage, catalog context as evidence, findings as reproducible observations or
 *  questions). The overlay is a modal dialog, keyboard accessible, and dismissible. */

interface Step {
  title: string;
  body: React.ReactNode;
}

const steps: Step[] = [
  {
    title: "Welcome to the SPHEREx viewer",
    body: (
      <>
        <p>
          SPHEREx is a NASA space telescope that maps the whole sky in infrared light. This tool
          lets anyone look up a patch of sky and watch how it changed between the dates SPHEREx
          observed it, with no files to download.
        </p>
        <p>
          You do not need an astronomy background. This quick tour shows what each part does.
        </p>
      </>
    ),
  },
  {
    title: "1. Point at a patch of sky",
    body: (
      <>
        <p>
          Open <strong>Search</strong> (top right) to choose where to look. You can:
        </p>
        <ul>
          <li>Pick a bundled target such as Barnard&rsquo;s Star with one tap, or</li>
          <li>
            type sky coordinates (right ascension and declination, like an address on the sky), or
          </li>
          <li>type an object&rsquo;s name and let the tool look up its coordinates.</li>
        </ul>
        <p>
          You can also drag and zoom the map, then use <strong>Compare this field</strong> at the
          bottom to look up whatever is on screen.
        </p>
      </>
    ),
  },
  {
    title: "2. Watch time move",
    body: (
      <>
        <p>
          The <strong>Comparison</strong> panel fetches the real dated images for that patch and
          lines them up on the same grid and the same brightness scale. Press{" "}
          <strong>Play</strong> and the images blink one after another.
        </p>
        <p>
          Anything that moved or changed brightness between the dates appears to jump or flicker,
          while the fixed background stays still. Each frame shows its real observation date and
          the infrared wavelength you are viewing.
        </p>
      </>
    ),
  },
  {
    title: "3. Check what you clicked",
    body: (
      <>
        <p>
          Click any point on an image (or the map) to open the <strong>Gaia</strong> inspector. It
          shows whether a known catalogued star sits there, along with its measured position,
          motion, and brightness.
        </p>
        <p>
          This is context to help you understand a point, not a verdict. When a catalog position is
          projected onto a SPHEREx date, it is clearly labelled a <em>prediction</em>, kept
          separate from the actual image.
        </p>
      </>
    ),
  },
  {
    title: "4. Share what you saw",
    body: (
      <>
        <p>
          Think you spotted something? Copy a <strong>comparison link</strong>. It reopens the exact
          same frames, dates, and settings for anyone, so another person can check it. Signed-in
          users can post a short note as a <em>finding</em>.
        </p>
        <p>
          A finding is a reproducible observation or a question, never a claim of a discovery. The
          point is to let others verify what you saw.
        </p>
      </>
    ),
  },
  {
    title: "The tool is honest about gaps",
    body: (
      <>
        <p>
          Sometimes there is only one image for a spot, no overlapping coverage, or the archive is
          briefly unreachable. When that happens the viewer says so plainly instead of pretending to
          compare. That honesty is the point.
        </p>
        <p>
          Look for the <span className="info-tip-inline">?</span> help buttons next to unfamiliar
          terms, and reopen this tour any time with the <strong>How this works</strong> button.
        </p>
      </>
    ),
  },
];

const STORAGE_KEY = "spherex.tutorial.seen";

function wasSeen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useTutorial() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!wasSeen()) setOpen(true);
  }, []);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* storage may be unavailable; the tour simply reopens next time */
    }
  }

  return { open, openTutorial: () => setOpen(true), close };
}

export function Tutorial({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      closeButton.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const current = steps[step];
  const first = step === 0;
  const last = step === steps.length - 1;

  return (
    <div className="tutorial-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="tutorial-dialog" role="dialog" aria-modal="true"
        aria-labelledby="tutorial-title" ref={dialog}>
        <div className="panel-heading">
          <h2 id="tutorial-title">{current.title}</h2>
          <button type="button" ref={closeButton} onClick={onClose}
            aria-label="Close tour">Skip</button>
        </div>
        <div className="tutorial-body">{current.body}</div>
        <ol className="tutorial-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((item, index) => (
            <li key={item.title} aria-current={index === step ? "step" : undefined}
              className={index === step ? "is-current" : undefined} />
          ))}
        </ol>
        <div className="controls tutorial-controls">
          <button type="button" onClick={() => setStep(step - 1)} disabled={first}>Back</button>
          {last ? (
            <button type="button" className="tutorial-primary" onClick={onClose}>Start exploring</button>
          ) : (
            <button type="button" className="tutorial-primary" onClick={() => setStep(step + 1)}>Next</button>
          )}
        </div>
      </div>
    </div>
  );
}
