import { useState, type FormEvent } from "react";
import type { Field, SkyPosition } from "./comparison";
import { nameIssue, partialNameIssue } from "./targetNames";
import { TargetNameInput } from "./TargetNameInput";
import { parseAngle, targetPresets } from "./coordinates";

export interface FieldLimits {
  min: number;
  max: number;
}

export function inFieldRange(size: number, limits: FieldLimits) {
  return Number.isFinite(size) && size >= limits.min && size <= limits.max;
}

export function FieldSearch({
  field,
  limits,
  onSearch,
  onResolve,
}: {
  field: Field;
  limits: FieldLimits;
  onSearch: (field: Field) => void;
  onResolve: (name: string, fovArcmin: number) => void;
}) {
  const [raInput, setRa] = useState(String(field.ra));
  const [decInput, setDec] = useState(String(field.dec));
  const [size, setSize] = useState(String(field.fovArcmin));
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [dismissKey, setDismissKey] = useState(0);
  function chooseName(value: string) {
    setName(value);
    setDismissKey(key => key + 1);
    setNameError("");
    setChecked(current => ({ ...current, size: true }));
    if (validSize) onResolve(value, fovArcmin);
  }
  const [checked, setChecked] = useState({ coordinates: false, size: false });
  const ra = parseAngle(raInput, "ra");
  const dec = parseAngle(decInput, "dec");
  const fovArcmin = size.trim() ? Number(size) : NaN;
  const validSize = inFieldRange(fovArcmin, limits);

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked({ coordinates: true, size: true });
    if (ra !== null && dec !== null && validSize) onSearch({ ra, dec, fovArcmin });
  }

  function pickTarget(position: SkyPosition & { name: string }) {
    setRa(String(position.ra));
    setDec(String(position.dec));
    setChecked({ coordinates: false, size: true });
    chooseName(position.name);
  }

  function resolve(event: FormEvent) {
    event.preventDefault();
    setChecked((current) => ({ ...current, size: true }));
    const issue = nameIssue(name) ?? partialNameIssue(name);
    if (issue) { setNameError(issue.message); return; }
    if (validSize && name.trim()) chooseName(name.trim());
  }

  return (
    <div>
      <form className="field-form" onSubmit={submit} noValidate>
        <label>
          Right ascension
          <input value={raInput} onChange={(event) => setRa(event.target.value)}
            placeholder="269.4521 or 17:57:48" aria-invalid={checked.coordinates && ra === null}
            aria-describedby={checked.coordinates && ra === null ? "ra-error" : undefined} />
          {checked.coordinates && ra === null && (
            <small id="ra-error">Enter RA from 0° up to 360°, or hours:minutes:seconds below 24h.</small>
          )}
        </label>
        <label>
          Declination
          <input value={decInput} onChange={(event) => setDec(event.target.value)}
            placeholder="+4.6934 or +04:41:36" aria-invalid={checked.coordinates && dec === null}
            aria-describedby={checked.coordinates && dec === null ? "dec-error" : undefined} />
          {checked.coordinates && dec === null && (
            <small id="dec-error">Enter declination from −90° to +90°, in decimal or sexagesimal form.</small>
          )}
        </label>
        <label>
          Field width (arcmin)
          <input type="number" step="any" min={limits.min} max={limits.max} value={size}
            onChange={(event) => setSize(event.target.value)} aria-invalid={checked.size && !validSize}
            aria-describedby="size-hint" />
          <small id="size-hint" className={checked.size && !validSize ? "invalid" : undefined}>
            {limits.min}–{limits.max} arcmin
          </small>
        </label>
        <button type="submit">Compare coordinates</button>
      </form>
      <div className="presets" role="group" aria-label="Challenge target presets">
        {targetPresets.map(({ name: target, ra, dec }) => (
          <button type="button" key={target} onClick={() => pickTarget({ name: target, ra, dec })}>{target}</button>
        ))}
      </div>
      <form className="controls name-form" onSubmit={resolve}>
        <TargetNameInput id="advanced-target" label="Object name" value={name}
          onChange={value => { setName(value); setNameError(""); }} onChoose={chooseName}
          error={nameError} dismissKey={dismissKey} describedBy="name-search-hint" />
        <button type="submit" disabled={!name.trim()}>Resolve and compare</button>
      </form>
      <small id="name-search-hint">Suggestions filter the five challenge targets and their aliases. Other full identifiers use optional external lookup.</small>
      {nameError && <p role="alert">{nameError}</p>}
    </div>
  );
}
