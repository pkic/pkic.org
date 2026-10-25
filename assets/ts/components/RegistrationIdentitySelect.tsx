import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import { useState } from "preact/hooks";
import { REGISTRATION_IDENTITY_COPY as copy } from "../../shared/email-first-copy";
import { actingIdentityCatalog } from "../shared/acting-identity-catalog";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { ServerSearchSelect } from "./ServerSearchSelect";

const identityLabel = (identity: SessionActingIdentity) => identity.organizationName ?? "My individual membership";
const catalog = actingIdentityCatalog("/api/v1/users/current/identities", identityLabel);

/**
 * The identity a registration is made as. An identity under the address the
 * person continued with is shown read-only — its organization comes from the
 * identity, never from a typed answer — with a way to choose another one they
 * already hold; without one, the registration shows their current affiliation.
 */
export function RegistrationIdentityField({
  preferred,
  onSelect,
}: {
  preferred?: SessionActingIdentity | null;
  onSelect?: (identity: SessionActingIdentity | null) => void;
}) {
  const [selected, setSelected] = useState<SessionActingIdentity | null>(preferred ?? null);
  const [choosing, setChoosing] = useState(!preferred);
  const hidden = <input type="hidden" name="identityId" value={selected?.id ?? ""} />;
  if (!choosing && selected)
    return (
      <div class="pk-stack pk-stack--snug">
        <p>
          {selected.organizationName ? copy.representing(selected.organizationName) : "Participating as an individual"}
        </p>
        <div>
          <Button type="button" variant="link" onClick={() => setChoosing(true)}>
            {copy.chooseOther}
          </Button>
        </div>
        {hidden}
      </div>
    );
  return (
    <Field
      label="Event identity"
      help="Optional. Your registration shows the organization and job title of the identity you choose; without one it shows your current affiliation."
    >
      {(control) => (
        <>
          <ServerSearchSelect
            {...control}
            catalog={catalog}
            searchLabel="Your identities"
            value={selected?.id ?? null}
            selectedLabel={selected ? identityLabel(selected) : undefined}
            placeholder="Use my current affiliation"
            onChange={(identity) => {
              setSelected(identity);
              onSelect?.(identity);
            }}
          />
          {hidden}
        </>
      )}
    </Field>
  );
}
