/**
 * The representation a registration is made as, chosen inside its edit form.
 *
 * The registrant, signed in, picks among the identities they hold, and the
 * registration's email address follows that choice. Without their session (a
 * manage link opened elsewhere) the representation is shown read-only.
 */
import { useEffect, useState } from "preact/hooks";
import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import type { SessionActingIdentity } from "../../../shared/session-acting-identity";
import { getJson } from "../../shared/api-client";
import { RegistrationIdentityField } from "../RegistrationIdentitySelect";
import { ButtonLink } from "../../ui/Button";
import { Spinner } from "../Spinner";
import { RegistrationAffiliation } from "./RegistrationAffiliation";

type Session = ReturnType<typeof userAuthSessionResponseSchema.parse>;

/** Load picker choices only when the server allows representation changes. */
async function readRepresentationSession(data: RegistrationManageReadResponse): Promise<Session | null> {
  if (!data.canChangeIdentity) return null;
  return getJson("/api/v1/auth/session", userAuthSessionResponseSchema).catch(() => null);
}

export function RegistrationRepresentationField({
  data,
  onSelect,
  onUpdated,
}: {
  data: RegistrationManageReadResponse;
  onSelect: (identity: SessionActingIdentity | null) => void;
  onUpdated: () => void;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void readRepresentationSession(data).then((owner) => {
      if (active) setSession(owner);
    });
    return () => {
      active = false;
    };
  }, [data]);
  if (session === undefined) return <Spinner label="Loading your representations…" />;
  if (!session)
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
        preferred={session.actingIdentities.find((identity) => identity.id === data.identityId) ?? null}
        available={session.actingIdentities}
        userId={session.identity.id}
        onSelect={onSelect}
        onUpdated={onUpdated}
      />
      <p class="pk-muted pk-small">
        Saving a different representation updates the address used for registration emails.
      </p>
    </div>
  );
}
