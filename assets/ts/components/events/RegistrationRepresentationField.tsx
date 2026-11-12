/**
 * The representation a registration is made as, chosen inside its edit form.
 *
 * The registrant, signed in, picks among the identities they hold, and the
 * registration's email address follows that choice. Without their session (a
 * manage link opened elsewhere) the representation is shown read-only.
 */
import { useState } from "preact/hooks";
import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import type { SessionActingIdentity } from "../../../shared/session-acting-identity";
import { getJson } from "../../shared/api-client";
import { RegistrationIdentityField } from "../RegistrationIdentitySelect";
import { useData } from "../../hooks/useData";
import { friendlyErrorMessage } from "../ErrorAlert";
import { Alert } from "../../ui/Alert";
import { Button, ButtonLink } from "../../ui/Button";
import { Spinner } from "../Spinner";
import { RegistrationAffiliation } from "./RegistrationAffiliation";

export function RegistrationRepresentationField({
  data,
  onSelect,
  onUpdated,
}: {
  data: RegistrationManageReadResponse;
  onSelect: (identity: SessionActingIdentity | null) => void;
  onUpdated: () => Promise<void>;
}) {
  const session = useData(
    () =>
      data.canChangeIdentity ? getJson("/api/v1/auth/session", userAuthSessionResponseSchema) : Promise.resolve(null),
    [data.canChangeIdentity, data.registration.id],
  );
  const [refreshError, setRefreshError] = useState<string | null>(null);
  async function refreshProfile() {
    setRefreshError(null);
    try {
      await onUpdated();
    } catch (error) {
      setRefreshError(
        friendlyErrorMessage(error instanceof Error ? error.message : "Could not refresh your registration."),
      );
    }
  }
  if (session.loading) return <Spinner label="Loading your representations…" />;
  if (session.error)
    return (
      <div class="pk-stack pk-stack--snug">
        <Alert tone="danger">Could not load your representations. Try again.</Alert>
        <Button variant="secondary" onClick={() => void session.reload()}>
          Retry
        </Button>
      </div>
    );
  if (!session.data)
    return (
      <div class="pk-stack pk-stack--snug">
        <RegistrationAffiliation
          organizationName={data.user.organization_name}
          jobTitle={data.user.job_title}
          pendingOrganizationName={data.pendingOrganizationName}
        />
        <p class="pk-muted pk-small">
          To choose or add a representation, sign in as the registrant and open your own registration link.
        </p>
        <ButtonLink href="/portal/" external>
          Sign in
        </ButtonLink>
      </div>
    );
  return (
    <div class="pk-stack pk-stack--snug">
      <RegistrationIdentityField
        presentation="picker"
        personalAdvisory={false}
        preferred={session.data.actingIdentities.find((identity) => identity.id === data.identityId) ?? null}
        available={session.data.actingIdentities}
        userId={session.data.identity.id}
        onSelect={onSelect}
        onUpdated={() => void refreshProfile()}
      />
      {refreshError && <Alert tone="danger">{refreshError}</Alert>}
      {refreshError && (
        <Button variant="secondary" onClick={() => void refreshProfile()}>
          Retry refresh
        </Button>
      )}
      <p class="pk-muted pk-small">
        Saving a different representation updates the address used for registration emails.
      </p>
    </div>
  );
}
