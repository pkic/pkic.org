/**
 * A required term, agreed to or not.
 *
 * The version this replaces drew its own checkbox: a `role="checkbox"` div
 * with a click handler, a key handler, a hand-painted tick, and a real input
 * hidden behind `visually-hidden` so the form still had something to submit.
 * Three separate modules then reached into that markup after a failed
 * validation to add and remove Bootstrap's `is-invalid` on the card.
 *
 * All of it is now the design system's `Checkbox`: one real, `required`
 * checkbox input with a real label, which brings its own semantics, its own
 * keyboard behaviour and — the point of the rewrite — its own validity. `form.checkValidity()`, which both
 * the submit path and the step-navigation path already call, fires an
 * `invalid` event on every control that fails, so the card learns it is
 * required-and-unagreed from the platform instead of from a script poking at
 * its class list.
 */

import { useCallback, useState } from "preact/hooks";

import { Badge } from "../ui/Badge";
import { Checkbox } from "../ui/Checkbox";
import { StateIcon } from "../ui/Field";
import { IconExternalLink, IconInfoCircle } from "./icons";
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

  const id = `consent-${term.termKey}-${term.version}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const helpId = `${id}-help`;
  const messageId = `${id}-message`;
  const label = termLabel(term);
  const help = term.helpText?.trim();

  const handleChange = useCallback(
    (event: Event) => {
      const next = (event.currentTarget as HTMLInputElement).checked;
      setChecked(next);
      setInvalid(Boolean(term.required) && !next);
    },
    [term.required],
  );

  const describedBy = [help ? helpId : null, invalid ? messageId : null].filter(Boolean).join(" ");

  return (
    // `pk-field` is the label/control/message column the system already
    // defines, and `pk-field--invalid` is what puts the danger tone on the
    // message below it. The data attributes are the flow's own record of which
    // term this is, and stay exactly as they were.
    <div
      class={["pk-field", invalid ? "pk-field--invalid" : null].filter(Boolean).join(" ")}
      data-term-key={term.termKey}
      data-term-version={term.version}
      data-term-required={String(Boolean(term.required))}
    >
      {help && (
        <p class="pk-small pk-muted" id={helpId}>
          <IconInfoCircle aria-hidden="true" width="14" height="14" /> {help}
        </p>
      )}

      <div class="pk-cluster">
        <Checkbox
          // `data-consent-input` is how the vanilla event-flow modules find
          // the consent inputs in a form they did not render. Removing it
          // would silently drop consents out of every public submission. It
          // is an attribute rather than a class so that no stylesheet can
          // reach these controls by reaching for the hook.
          data-consent-input
          id={id}
          name="consents"
          value={`${term.termKey}:${term.version}`}
          required={term.required}
          checked={checked}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy || undefined}
          // `form.checkValidity()` fires `invalid` at every control that
          // fails, so the card learns it is required-and-unagreed from the
          // platform rather than from a script poking at its class list.
          onInvalid={() => setInvalid(true)}
          onChange={handleChange}
          label={label}
        />

        {/* "Optional" was a colour-free pill before and stays one, now as the
            system's neutral Badge rather than a bespoke chip. */}
        {!term.required && <Badge tone="neutral">Optional</Badge>}

        {term.contentRef && (
          <a
            class="pk-small"
            href={term.contentRef}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Read: ${label}`}
          >
            <IconExternalLink /> Read
          </a>
        )}
      </div>

      {invalid && (
        <p class="pk-field__message" id={messageId} role="alert">
          <StateIcon state="invalid" class="pk-field__message-icon" />
          You need to agree to this to continue.
        </p>
      )}
    </div>
  );
}

interface ConsentListProps {
  terms: RequiredTerm[];
}

export function ConsentList({ terms }: ConsentListProps) {
  // The list is the standalone region here — it is rendered into a container
  // on a page that has not adopted the system — so the `.pk` root goes on it
  // once, rather than on every card inside it.
  if (terms.length === 0) {
    return (
      <div class="pk">
        <p>No required consents for this flow.</p>
      </div>
    );
  }
  return (
    <div class="pk pk-stack pk-stack--snug">
      {terms.map((term) => (
        <ConsentCard key={`${term.termKey}:${term.version}`} term={term} />
      ))}
    </div>
  );
}
