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
import { Spinner } from "../Spinner";
import { RegistrationAffiliation } from "./RegistrationAffiliation";

type Session = ReturnType<typeof userAuthSessionResponseSchema.parse>;

/** The signed-in session when it belongs to the registrant, else null. */
async function readOwnerSession(data: RegistrationManageReadResponse): Promise<Session | null> {
  if (!data.canChangeIdentity) return null;
  const current = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema).catch(() => null);
  if (!current) return null;
  return current;
}

export function RegistrationRepresentationField({
  data,
  onSelect,
}: {
  data: RegistrationManageReadResponse;
  onSelect: (identity: SessionActingIdentity | null) => void;
}) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void readOwnerSession(data).then((owner) => {
      if (active) setSession(owner);
    });
    return () => {
      active = false;
    };
  }, [data]);
  if (session === undefined) return <Spinner label="Loading your representations…" />;
  if (!session)
    return (
      <RegistrationAffiliation
        organizationName={data.user.organization_name}
        jobTitle={data.user.job_title}
        pendingOrganizationName={data.pendingOrganizationName}
      />
    );
  return (
    <RegistrationIdentityField
      presentation="picker"
      personalAdvisory={false}
      preferred={session.actingIdentities.find((identity) => identity.id === data.identityId) ?? null}
      available={session.actingIdentities}
      userId={session.identity.id}
      onSelect={onSelect}
    />
  );
}
