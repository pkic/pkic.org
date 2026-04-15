import { useCallback, useRef, useState } from "preact/hooks";
import { IconCheckmark, IconExternalLink, IconInfoCircle } from "./icons";
import type { RequiredTerm } from "../shared/types";

function termLabel(term: RequiredTerm): string {
  const display = term.displayText?.trim();
  return display && display.length > 0 ? display : term.termKey.replace(/[-_]/g, " ");
}

interface ConsentCardProps {
  term: RequiredTerm;
}

export function ConsentCard({ term }: ConsentCardProps) {
  const [checked, setChecked] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const id = `consent-${term.termKey}-${term.version}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const label = termLabel(term);
  const featured = Boolean(term.helpText?.trim());

  const syncValidation = useCallback(() => {
    const form = inputRef.current?.closest("form");
    if (form?.classList.contains("was-validated") && term.required) {
      setInvalid(!inputRef.current!.checked);
    }
  }, [term.required]);

  const toggle = useCallback(() => {
    const next = !checked;
    setChecked(next);
    setInvalid(term.required ? !next : false);
    // Dispatch change on the native input so external readers (readConsentValues) stay in sync
    if (inputRef.current) {
      inputRef.current.checked = next;
      inputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    syncValidation();
  }, [checked, term.required, syncValidation]);

  const handleCardClick = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("a, label")) return;
      toggle();
    },
    [toggle],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  const cardClass = [
    "event-flow-consent-card",
    featured ? "event-flow-consent-card--featured" : "",
    checked ? "is-checked" : "",
    invalid ? "is-invalid" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const indicator = (
    <span class="event-flow-consent-indicator" aria-hidden="true">
      <IconCheckmark />
    </span>
  );

  const optionalBadge = !term.required ? <span class="event-flow-consent-optional-badge">Optional</span> : null;

  const readLink = term.contentRef ? (
    <a
      href={term.contentRef}
      class="event-flow-consent-read-link"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Read: ${label}`}
    >
      <IconExternalLink /> Read
    </a>
  ) : null;

  const hiddenInput = (
    <input
      ref={inputRef}
      type="checkbox"
      name="consents"
      value={`${term.termKey}:${term.version}`}
      required={term.required}
      class="event-flow-consent-native-check visually-hidden"
      id={id}
      checked={checked}
      onChange={() => {
        /* handled by card click */
      }}
    />
  );

  if (featured) {
    return (
      <div
        class={cardClass}
        data-term-key={term.termKey}
        data-term-version={term.version}
        data-term-required={String(Boolean(term.required))}
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
      >
        <div class="event-flow-consent-card-context">
          <span class="event-flow-consent-card-icon" aria-hidden="true">
            <IconInfoCircle />
          </span>
          <p class="event-flow-consent-card-context-text">{term.helpText!.trim()}</p>
        </div>
        <div class="event-flow-consent-card-action">
          {hiddenInput}
          {indicator}
          <label class="event-flow-consent-card-label" htmlFor={id}>
            {label}
          </label>
          {optionalBadge}
          {readLink}
        </div>
      </div>
    );
  }

  return (
    <div
      class={cardClass}
      data-term-key={term.termKey}
      data-term-version={term.version}
      data-term-required={String(Boolean(term.required))}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
    >
      {hiddenInput}
      {indicator}
      <label class="event-flow-consent-card-label" htmlFor={id}>
        {label}
      </label>
      {optionalBadge}
      {readLink}
    </div>
  );
}

interface ConsentListProps {
  terms: RequiredTerm[];
}

export function ConsentList({ terms }: ConsentListProps) {
  if (terms.length === 0) {
    return <p>No required consents for this flow.</p>;
  }
  return (
    <div class="event-flow-consents">
      {terms.map((term) => (
        <ConsentCard key={`${term.termKey}:${term.version}`} term={term} />
      ))}
    </div>
  );
}
