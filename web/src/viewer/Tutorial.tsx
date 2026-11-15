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
  { title: "Explore nearby cold-object candidates", body: <>
    <p>Explore real infrared images for possible nearby brown dwarfs and other cold substellar objects. Known stars are useful controls. Selecting a point does not tell us its nature, distance or whether it is new.</p>
    <p>The map stays your workspace; floating windows let you explore time, inspect sources and discuss evidence.</p>
  </> },
  { title: "1. Choose a field", body: <>
    <p>Use the search bar for a name or sky coordinates. Advanced search has field width and all five challenge targets: Barnard’s Star, Epsilon Indi B, WISE 0855, RW Aurigae and R Draconis.</p>
    <p>Browsing the map does not fetch dated images. Press <strong>Compare this field</strong> when ready. A resolved name is not proof that the target is visible.</p>
  </> },
  { title: "2. Explore wavelengths and context", body: <>
    <p>Try roughly 4–5 µm as a starting hint for cold-object exploration. The wavelength slider changes an all-sky reference mosaic combining many observations; it is not a dated spectrum.</p>
    <p>Switch to <strong>WISE</strong> for longer infrared history and optionally DSS for optical context. A cold object may be optically faint. Neither DSS/WISE detection nor Gaia absence is required.</p>
    <p>Display brightness cannot establish molecules, elements or physical temperature.</p>
  </> },
  { title: "3. Blink actual dates", body: <>
    <p>After images load, use <strong>Blink</strong> to scrub observations or <strong>Blink A ↔ B</strong>. The dated overlay covers only its outlined footprint. Surrounding reference imagery stays unchanged.</p>
    <p>The same window lists each frame's source observation and release. <strong>Frame details</strong> holds the actual dates, shared brightness scale, wavelength and quality flags, and <strong>Frame image</strong> shows the saved image itself. A visual change needs further checking; artifacts can also flicker.</p>
    <p>A saved real example is a labelled teaching field. Zooming in cannot add detail to its original pixels.</p>
  </> },
  { title: "4. Review a point", body: <>
    <p><strong>Double-click</strong> a point, on a dated image or anywhere on the map. A box with an X marks it and six catalogs are checked at once, no sign-in needed. Use <strong>Show on map</strong> for sources from any catalog. Gaia can be predicted for the displayed date; other positions stay at their published epoch. A single click opens the full Gaia source inspector.</p>
    <p>Choose <strong>Submit to leaderboard</strong> for any marked point, including the plain map. Sign in, score the point, then add a title and note. No loaded images are needed. The local demo checks catalogs when available, skips brightness measurements and stores posts only in this browser. With a configured service, six catalog checks cover Gaia DR3, SIMBAD, CatWISE2020, UltracoolSheet, SkyBoT and VizieR AllWISE.</p>
    <p>These are independent cone searches, not identity verdicts. Different epochs, motion and sensitivity matter. Gaia, SIMBAD and CatWISE use the marked frame date when proper motion is available. Other positions remain as published. No result does not mean a new object; unavailable checks stay visible.</p>
  </> },
  { title: "5. Share and discuss", body: <>
    <p>Add a title and a question or observation. Posting puts the sky point on the <strong>Participation leaderboard</strong> with a public discussion. If the same catalog object or a point within 15″ is already listed, open its discussion instead.</p>
    <p>Points: 10 if a catalog already lists a source at the point. 20 if no catalog returns a match, at most two catalogs are unavailable, and the server measures the point at least 5σ above its surroundings in any two of SPHEREx, WISE, DSS and NEOSSat; the server fetches these images itself. Otherwise 0, and you can still post it. Points are not a discovery.</p>
    <p>Point-only entries reopen the map without fetching a comparison. Saved image evidence still reopens with the same frames, dates, wavelength, stretch and marks. Local demo replies stay in this browser.</p>
  </> },
  { title: "Gaps stay visible", body: <>
    <p>Single epochs, missing coverage, incompatible images and archive outages have separate states. A failed catalog check never becomes “no object.” All five challenge targets have recorded outcomes; a lookup or a pair of images alone does not prove a visible target or observed change.</p>
    <p>Reopen this tour with <strong>How this works</strong>. The map and saved-image replay remain usable when sign-in is unavailable.</p>
  </> },
];

const STORAGE_KEY = "spherex.tutorial.review-v1.seen";

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
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    setStep(0);
    closeButton.current?.focus();
    return () => element?.close();
  }, [open]);

  if (!open) return null;

  const current = steps[step];
  const first = step === 0;
  const last = step === steps.length - 1;

  return (
    <dialog ref={dialog} className="tutorial-backdrop" aria-labelledby="tutorial-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="tutorial-dialog">
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
    </dialog>
  );
}
