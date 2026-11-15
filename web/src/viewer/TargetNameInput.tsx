import { useEffect, useState, type Ref } from "react";
import { targetSuggestions } from "./targetNames";

/** Shared accessible target picker. Coordinates are handled by the compact form. */
export function TargetNameInput({ id, label, value, onChange, onChoose, inputRef, placeholder,
  showLabel = true, suggestionsEnabled = true, error, describedBy, dismissKey = 0 }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  onChoose: (name: string) => void; inputRef?: Ref<HTMLInputElement>; placeholder?: string;
  showLabel?: boolean; suggestionsEnabled?: boolean; error?: string; describedBy?: string; dismissKey?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);
  useEffect(() => { setExpanded(false); setActive(-1); }, [dismissKey]);
  const matches = suggestionsEnabled ? targetSuggestions(value) : [];
  useEffect(() => { if (error) { setExpanded(true); setActive(-1); } }, [error]);
  const open = expanded && matches.length > 0;
  function choose(name: string) { setExpanded(false); setActive(-1); onChoose(name); }
  return <div className={`target-name-control${showLabel ? "" : " compact-name-control"}`}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false); }}>
    {showLabel && <label htmlFor={id}>{label}</label>}
    <input ref={inputRef} id={id} role="combobox" aria-label={label} aria-autocomplete="list"
      aria-expanded={open} aria-controls={open ? `${id}-suggestions` : undefined}
      aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-option-${active}` : undefined}
      aria-invalid={Boolean(error)} aria-describedby={describedBy} maxLength={256}
      value={value} placeholder={placeholder}
      onChange={event => { onChange(event.target.value); setExpanded(true); setActive(-1); }}
      onKeyDown={event => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault(); event.stopPropagation(); setExpanded(false); setActive(-1);
        }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
          event.preventDefault(); setExpanded(true);
          setActive(index => event.key === "ArrowDown" ? (index + 1) % matches.length : (index <= 0 ? matches.length - 1 : index - 1));
        }
        if (event.key === "Enter" && open && active >= 0 && matches[active]) {
          event.preventDefault(); choose(matches[active].target.identity!.displayName);
        }
      }} />
    {open && <ul id={`${id}-suggestions`} role="listbox" aria-label="Matching challenge targets" className="target-suggestions">
      {matches.map(({ target, matchedAlias }, index) => <li key={target.identity!.objectId} role="none">
        <button type="button" role="option" id={`${id}-option-${index}`} aria-selected={active === index}
          onClick={() => choose(target.identity!.displayName)}>
          <strong>{target.identity!.displayName}</strong>
          <span>{target.identity!.canonicalDesignation} · {target.identity!.component}</span>
          <small>Matches {matchedAlias}</small>
        </button>
      </li>)}
    </ul>}
  </div>;
}
