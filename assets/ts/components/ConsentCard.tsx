/** Consent terms compose the shared Panel, Checkbox, Badge, and Button primitives. */
import { useState } from "preact/hooks";
import { Badge } from "../ui/Badge";
import { Checkbox } from "../ui/Checkbox";
import { ButtonLink } from "../ui/Button";
import { Panel, PanelBody } from "../ui/Panel";
import { StateIcon } from "../ui/Field";
import { IconExternalLink, IconInfoCircle } from "./icons";
import type { RequiredTerm } from "../shared/types";

export function ConsentCard({ term }: { term: RequiredTerm }) {
  const [checked, setChecked] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const id = `consent-${term.termKey}-${term.version}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const helpId = `${id}-help`;
  const messageId = `${id}-message`;
  const label = term.displayText?.trim() || term.termKey.replace(/[-_]/g, " ");
  const help = term.helpText?.trim();
  const describedBy = [help ? helpId : null, invalid ? messageId : null].filter(Boolean).join(" ");

  return (
    <Panel data-term-key={term.termKey} data-term-version={term.version} data-term-required={String(term.required)}>
      {help && (
        <PanelBody tone="warn">
          <p class="pk-cluster pk-cluster--nowrap pk-small" id={helpId}>
            <IconInfoCircle aria-hidden="true" />
            <span>{help}</span>
          </p>
        </PanelBody>
      )}
      <PanelBody
        tone={checked ? "ok" : undefined}
        class={`pk-stack pk-stack--snug${invalid ? " pk-field--invalid" : ""}`}
      >
        <div class="pk-cluster pk-cluster--nowrap">
          <Checkbox
            fill
            data-consent-input
            id={id}
            name="consents"
            value={`${term.termKey}:${term.version}`}
            required={term.required}
            checked={checked}
            label={label}
            aria-invalid={invalid ? "true" : undefined}
            aria-describedby={describedBy || undefined}
            onInvalid={() => setInvalid(true)}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              setChecked(next);
              setInvalid(term.required && !next);
            }}
          />
          {!term.required && <Badge tone="neutral">Optional</Badge>}
          {term.contentRef && (
            <ButtonLink
              variant="link"
              size="sm"
              href={term.contentRef}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Read: ${label}`}
            >
              <IconExternalLink />
              Read
            </ButtonLink>
          )}
        </div>
        {invalid && (
          <p class="pk-field__message" id={messageId} role="alert">
            <StateIcon state="invalid" class="pk-field__message-icon" />
            You need to agree to this to continue.
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}

export function ConsentList({ terms }: { terms: RequiredTerm[] }) {
  return (
    <div class="pk pk-stack pk-stack--snug">
      {terms.length ? (
        terms.map((term) => <ConsentCard key={`${term.termKey}:${term.version}`} term={term} />)
      ) : (
        <p>No required consents for this flow.</p>
      )}
    </div>
  );
}
