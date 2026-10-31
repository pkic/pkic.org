import { EMAIL_FIRST_COPY, WORK_EMAIL_STEER, PERSONAL_ADDRESS_WAITLIST } from "../../shared/email-first-copy";
import { StateIcon } from "../ui/Field";
import "./RegistrationIdentitySelect.css";
import { sessionActingIdentitySchema, type SessionActingIdentity } from "../../shared/session-acting-identity";
import { useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { RepresentationSelect } from "./identities/RepresentationSelect";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { getJson } from "../shared/api-client";
import { IdentityCreateDialog } from "./identities/IdentityCreateDialog";
import { OwnIdentityProfileEditor } from "./identities/OwnIdentityProfileEditor";
import { Alert } from "../ui/Alert";
import { friendlyErrorMessage } from "./ErrorAlert";
import { IconPencil } from "./icons";
import { actingIdentityLabel } from "../shared/acting-identity-catalog";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { useDialogQueryState } from "../hooks/useDialogQueryState";

const personalNotice = `${EMAIL_FIRST_COPY.registration.personal.points[0]}. ${WORK_EMAIL_STEER} ${PERSONAL_ADDRESS_WAITLIST}`;

const identityLabel = (identity: SessionActingIdentity) =>
  actingIdentityLabel({ organizationName: identity.organizationName, jobTitle: identity.jobTitle });

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
  onUpdated,
  personalAdvisory = true,
}: {
  /** The registration waiting-list advisory on a personal identity; off where no waiting list applies. */
  personalAdvisory?: boolean;
  preferred?: SessionActingIdentity | null;
  available?: readonly SessionActingIdentity[];
  userId?: string;
  onSelect?: (identity: SessionActingIdentity | null) => void;
  presentation?: "summary" | "picker";
  onUpdated?: (identity: SessionActingIdentity) => void;
}) {
  const [selected, setSelected] = useState<SessionActingIdentity | null>(preferred ?? null);
  const [identities, setIdentities] = useState(available);
  const [editing, showEditing, closeEditing] = useDialogQueryState("identity-profile");
  const [refreshError, setRefreshError] = useState("");
  const [adding, showAdding, closeAdding] = useDialogQueryState("identity");
  const [choosing, showChoosing, closeChoosing] = useDialogQueryState("representation");
  const [draft, setDraft] = useState<SessionActingIdentity | null>(selected);
  const canChange = identities.some((identity) => identity.id !== selected?.id);
  async function refreshIdentity(identityId: string) {
    const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
    const identity = session.actingIdentities.find((item) => item.id === identityId);
    if (!identity)
      throw new Error("Your representation is not available. Close this dialog and reopen registration to refresh it.");
    setIdentities(session.actingIdentities);
    setSelected(identity);
    onSelect?.(identity);
    return identity;
  }

  const hidden = (
    <>
      <input type="hidden" name="identityId" value={selected?.id ?? ""} />
      <input type="hidden" name="representationLabel" value={selected ? identityLabel(selected) : "Personal"} />
    </>
  );
  if (presentation === "summary")
    return (
      <>
        <span class="pk-cluster pk-cluster--nowrap">
          <span>{selected ? identityLabel(selected) : "Participating as an individual"}</span>
          {personalAdvisory && selected?.organizationId == null && (
            <span
              class="pk-representation-warning"
              role="img"
              tabIndex={0}
              aria-label={personalNotice}
              title={personalNotice}
            >
              <StateIcon state="advisory" />
            </span>
          )}
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
                onUpdated={(identity) => {
                  setIdentities((current) => current.map((item) => (item.id === identity.id ? identity : item)));
                  if (selected?.id === identity.id) {
                    setSelected(identity);
                    onSelect?.(identity);
                  }
                  onUpdated?.(identity);
                }}
              />
            </Dialog>,
            document.body,
          )}
      </>
    );
  return (
    <div class="pk-stack pk-stack--snug">
      <RepresentationSelect
        value={selected}
        onAdd={userId ? showAdding : undefined}
        onEdit={
          userId && selected
            ? () => {
                setRefreshError("");
                showEditing();
              }
            : undefined
        }
        onSelect={(identity) => {
          const selectedIdentity = sessionActingIdentitySchema.parse(identity);
          setSelected(selectedIdentity);
          onSelect?.(selectedIdentity);
        }}
      />
      {hidden}
      {userId &&
        selected &&
        editing &&
        createPortal(
          <Dialog
            open
            viewer
            title="Edit representation"
            closeLabel="Close edit representation"
            confirmLabel="Close"
            onConfirm={closeEditing}
            onCancel={closeEditing}
          >
            <div class="pk-stack" onSubmit={(event) => event.stopPropagation()}>
              {refreshError && <Alert tone="danger">{refreshError}</Alert>}
              <OwnIdentityProfileEditor
                identityId={selected.id}
                onCancel={closeEditing}
                onSaved={async () => {
                  try {
                    const identity = await refreshIdentity(selected.id);
                    onUpdated?.(identity);
                    await closeEditing();
                  } catch (cause) {
                    setRefreshError(
                      friendlyErrorMessage(
                        cause instanceof Error ? cause.message : "Could not refresh your representation.",
                      ),
                    );
                  }
                }}
              />
            </div>
          </Dialog>,
          document.body,
        )}
      {userId && (
        <IdentityCreateDialog
          open={adding}
          onClose={closeAdding}
          onCreated={async (identityId) => {
            await refreshIdentity(identityId);
          }}
        />
      )}
    </div>
  );
}
