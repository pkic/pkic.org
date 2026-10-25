import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import { useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { actingIdentityCatalog } from "../shared/acting-identity-catalog";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { getJson } from "../shared/api-client";
import { IdentityCreateDialog } from "./identities/IdentityCreateDialog";
import { IconPlus, IconPencil } from "./icons";
import { actingIdentityLabel } from "../shared/acting-identity-catalog";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { InputGroup } from "../ui/InputGroup";
import { ServerSearchSelect } from "./ServerSearchSelect";
import { Dialog } from "../ui/Dialog";
import { useDialogQueryState } from "../hooks/useDialogQueryState";

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
  presentation = "summary",
}: {
  preferred?: SessionActingIdentity | null;
  available?: readonly SessionActingIdentity[];
  userId?: string;
  onSelect?: (identity: SessionActingIdentity | null) => void;
  presentation?: "summary" | "picker";
}) {
  const [selected, setSelected] = useState<SessionActingIdentity | null>(preferred ?? null);
  const [identities, setIdentities] = useState(available);
  const [adding, showAdding, closeAdding] = useDialogQueryState("identity");
  const [choosing, showChoosing, closeChoosing] = useDialogQueryState("representation");
  const [draft, setDraft] = useState<SessionActingIdentity | null>(selected);
  const canChange = identities.some((identity) => identity.id !== selected?.id);
  const hidden = <input type="hidden" name="identityId" value={selected?.id ?? ""} />;
  if (presentation === "summary")
    return (
      <>
        <span class="pk-cluster pk-cluster--nowrap">
          <span>{selected ? identityLabel(selected) : "Participating as an individual"}</span>
          {(userId || canChange) && (
            <Button
              type="button"
              variant="ghost"
              icon
              aria-label="Change representation"
              title="Change representation"
              onClick={() => {
                setDraft(selected);
                showChoosing();
              }}
            >
              <IconPencil />
            </Button>
          )}
        </span>
        {hidden}
        {choosing &&
          createPortal(
            <Dialog
              open
              title="Change representation"
              closeLabel="Close change representation"
              confirmLabel="Use representation"
              confirmDisabled={!draft}
              onCancel={closeChoosing}
              onConfirm={() => {
                setSelected(draft);
                onSelect?.(draft);
                void closeChoosing();
              }}
            >
              <RegistrationIdentityField
                presentation="picker"
                preferred={draft}
                available={identities}
                userId={userId}
                onSelect={setDraft}
              />
            </Dialog>,
            document.body,
          )}
      </>
    );
  const add = userId ? (
    <Button type="button" variant="ghost" icon aria-label="Add identity" title="Add identity" onClick={showAdding}>
      <IconPlus />
    </Button>
  ) : null;
  return (
    <div class="pk-stack pk-stack--snug">
      <Field label="Representation">
        {(control) => (
          <InputGroup>
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
                onSelect?.(identity);
              }}
            />
            {add}
          </InputGroup>
        )}
      </Field>
      {hidden}
      {userId && (
        <IdentityCreateDialog
          open={adding}
          onClose={closeAdding}
          onCreated={async (identityId) => {
            const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
            const identity = session.actingIdentities.find((item) => item.id === identityId);
            if (!identity)
              throw new Error(
                "Your new identity is not available yet. Close this dialog and reopen registration to refresh it.",
              );
            setIdentities(session.actingIdentities);
            setSelected(identity);
            onSelect?.(identity);
          }}
        />
      )}
    </div>
  );
}
