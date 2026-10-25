import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import { useState } from "preact/hooks";
import { REGISTRATION_IDENTITY_COPY as copy } from "../../shared/email-first-copy";
import { actingIdentityCatalog } from "../shared/acting-identity-catalog";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { getJson } from "../shared/api-client";
import { IdentityCreateDialog } from "./identities/IdentityCreateDialog";
import { IconPlus } from "./icons";
import { actingIdentityLabel } from "../shared/acting-identity-catalog";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { ServerSearchSelect } from "./ServerSearchSelect";

const identityLabel = (identity: SessionActingIdentity) =>
  actingIdentityLabel({ organizationName: identity.organizationName, jobTitle: identity.jobTitle });
const catalog = actingIdentityCatalog("/api/v1/users/current/identities", identityLabel);

/**
 * The identity a registration is made as. An identity under the address the
 * person continued with is shown read-only — its organization comes from the
 * identity, never from a typed answer — with a way to choose another one they
 * already hold; without one, the registration shows their current affiliation.
 */
export function RegistrationIdentityField({
  preferred,
  available = preferred ? [preferred] : [],
  userId,
  onSelect,
}: {
  preferred?: SessionActingIdentity | null;
  available?: readonly SessionActingIdentity[];
  userId?: string;
  onSelect?: (identity: SessionActingIdentity | null) => void;
}) {
  const [selected, setSelected] = useState<SessionActingIdentity | null>(preferred ?? null);
  const [choosing, setChoosing] = useState(!preferred);
  const [identities, setIdentities] = useState(available);
  const [adding, setAdding] = useState(false);
  const canChange = identities.some((identity) => identity.id !== selected?.id);
  const hidden = <input type="hidden" name="identityId" value={selected?.id ?? ""} />;
  return (
    <div class="pk-stack pk-stack--snug">
      {selected && (
        <p>
          {selected.organizationName ? copy.representing(selected.organizationName) : "Participating as an individual"}
        </p>
      )}
      <div class="pk-cluster">
        {canChange && (
          <Button type="button" variant="link" onClick={() => setChoosing(!choosing)}>
            {choosing ? "Keep this identity" : copy.chooseOther}
          </Button>
        )}
        {userId && (
          <Button
            type="button"
            variant="ghost"
            icon
            aria-label="Add identity"
            title="Add identity"
            onClick={() => setAdding(true)}
          >
            <IconPlus />
          </Button>
        )}
      </div>
      {choosing && canChange && (
        <Field
          label="Event identity"
          help="Your registration uses the organization and job title of the identity you choose."
        >
          {(control) => (
            <>
              <ServerSearchSelect
                {...control}
                catalog={catalog}
                searchable={false}
                allowEmpty={false}
                searchLabel="Your identities"
                value={selected?.id ?? null}
                selectedLabel={selected ? identityLabel(selected) : undefined}
                placeholder="Choose an existing identity"
                onChange={(identity) => {
                  if (!identity) return;
                  setSelected(identity);
                  setChoosing(false);
                  onSelect?.(identity);
                }}
              />
            </>
          )}
        </Field>
      )}
      {hidden}
      {userId && (
        <IdentityCreateDialog
          open={adding}
          userId={userId}
          onClose={() => setAdding(false)}
          onCreated={async (identityId) => {
            const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
            const identity = session.actingIdentities.find((item) => item.id === identityId);
            if (!identity)
              throw new Error(
                "Your new identity is not available yet. Close this dialog and reopen registration to refresh it.",
              );
            setIdentities(session.actingIdentities);
            setSelected(identity);
            setChoosing(false);
            onSelect?.(identity);
          }}
        />
      )}
    </div>
  );
}
