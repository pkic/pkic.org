import type { ActingIdentity } from "../../shared/schemas/identity";
import { useEffect, useState } from "preact/hooks";
import { actingIdentityCatalog, actingIdentityLabel } from "../shared/acting-identity-catalog";
import { Field } from "../ui/Field";
import { ServerSearchSelect } from "./ServerSearchSelect";

/** Choosing no organization is explicit; opening this control makes no choice. */
export function SpeakerIdentitySelect({
  endpoint,
  value,
  selectedLabel,
  onChange,
  errorSlot = "actingIdentityId",
  activeOnly = false,
}: {
  endpoint: string;
  value: string | null | undefined;
  selectedLabel?: string;
  onChange: (identity: ActingIdentity | null) => void;
  errorSlot?: string;
  activeOnly?: boolean;
}) {
  const [choice, setChoice] = useState(value);
  const [label, setLabel] = useState(selectedLabel);
  useEffect(() => {
    setChoice(value);
    setLabel(selectedLabel);
  }, [value, selectedLabel]);
  return (
    <Field
      label="Speaker identity"
      errorSlot={errorSlot}
      help="Choose your identity for this proposal, or participate as an individual without an organization."
    >
      {(control) => (
        <div class="pk-control-stack">
          <ServerSearchSelect
            {...control}
            catalog={actingIdentityCatalog(endpoint, actingIdentityLabel, activeOnly ? { active: "true" } : {})}
            searchLabel="Your identities"
            value={choice ?? null}
            selectedLabel={label}
            placeholder="Participate as an individual"
            onChange={(identity) => {
              setChoice(identity?.id ?? null);
              setLabel(identity ? actingIdentityLabel(identity) : undefined);
              onChange(identity);
            }}
          />
          {choice === undefined && (
            <p class="pk-muted pk-small">
              Representation needs review. Choose your identity or participation as an individual.
            </p>
          )}
          {choice === null && <p class="pk-muted pk-small">You are participating as an individual.</p>}
        </div>
      )}
    </Field>
  );
}
