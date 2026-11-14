import { useState, type FormEvent, type Ref } from "react";
import type { Field } from "./comparison";
import { isDecimalPair, parseSkyPosition, targetPresets } from "./coordinates";

const normalizeName = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "'");

/**
 * One-line search: a challenge target, an RA/Dec pair, or an object name for the resolver.
 * Every search uses `fovArcmin` as the comparison width; the advanced form sets it explicitly.
 */
export function SearchBox({
  fovArcmin,
  onSearch,
  onResolve,
  inputRef,
}: {
  fovArcmin: number;
  onSearch: (field: Field) => void;
  onResolve: (name: string, fovArcmin: number) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    setError("");
    const preset = targetPresets.find(({ name }) => normalizeName(name) === normalizeName(text));
    const position = preset ?? parseSkyPosition(text);
    if (position) {
      onSearch({ ra: position.ra, dec: position.dec, fovArcmin });
    } else if (isDecimalPair(text)) {
      setError("Enter RA from 0° up to 360° and Dec from −90° to +90°.");
    } else {
      onResolve(text, fovArcmin);
    }
  }

  return (
    <form role="search" className="search-box" onSubmit={submit} noValidate>
      <input ref={inputRef} type="search" value={query} list="target-presets"
        placeholder="Object name or RA, Dec" aria-label="Object name or coordinates"
        aria-invalid={Boolean(error)} aria-describedby={error ? "search-box-error" : undefined}
        onChange={(event) => { setQuery(event.target.value); setError(""); }} />
      <datalist id="target-presets">
        {targetPresets.map(({ name }) => <option key={name} value={name} />)}
      </datalist>
      <button type="submit" aria-label="Search" disabled={!query.trim()}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      </button>
      {error && <p id="search-box-error" className="search-box-error" role="alert">{error}</p>}
    </form>
  );
}
