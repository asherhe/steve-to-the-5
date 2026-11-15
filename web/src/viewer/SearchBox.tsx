import { useState, type FormEvent, type Ref } from "react";
import type { Field } from "./comparison";
import { isDecimalPair, parseSkyPosition } from "./coordinates";

import { nameIssue, partialNameIssue } from "./targetNames";
import { TargetNameInput } from "./TargetNameInput";

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
  const [dismissKey, setDismissKey] = useState(0);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    setError("");
    const position = parseSkyPosition(text);
    if (position) {
      setDismissKey(key => key + 1);
      onSearch({ ra: position.ra, dec: position.dec, fovArcmin });
    } else if (isDecimalPair(text)) {
      setError("Enter RA from 0° up to 360° and Dec from −90° to +90°.");
    } else {
      const issue = nameIssue(text) ?? partialNameIssue(text);
      if (issue) { setError(issue.message); return; }
      setDismissKey(key => key + 1);
      onResolve(text, fovArcmin);
    }
  }

  return (
    <form role="search" className="search-box" onSubmit={submit} noValidate>
      <TargetNameInput id="compact-target" label="Object name or coordinates" showLabel={false}
        value={query} inputRef={inputRef} dismissKey={dismissKey} placeholder="Object name or RA, Dec"
        suggestionsEnabled={!parseSkyPosition(query) && !isDecimalPair(query)}
        onChange={value => { setQuery(value); setError(""); }}
        onChoose={name => { setQuery(name); setError(""); setDismissKey(key => key + 1); onResolve(name, fovArcmin); }}
        error={error} describedBy={error ? "search-box-error" : undefined} />
      <button type="submit" aria-label="Search" disabled={!query.trim()}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      </button>
      {error && <p id="search-box-error" className="search-box-error" role="alert">{error}</p>}
    </form>
  );
}
