/**
 * The representation a registration is made as, chosen inside its edit form.
 *
 * The registrant, signed in, picks among the identities they hold, and the
 * registration's email address follows that choice. Without their session (a
 * manage link opened elsewhere) the representation is shown read-only.
 */
import { useEffect, useState } from "preact/hooks";
import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import {
  registrationIdentityChangeSchema,
  registrationIdentityChangeResponseSchema,
} from "../../../shared/schemas/registration-identity";
import { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import type { SessionActingIdentity } from "../../../shared/session-acting-identity";
import { getJson, putJson } from "../../shared/api-client";
import { RegistrationIdentityField } from "../RegistrationIdentitySelect";
import { Spinner } from "../Spinner";
import { RegistrationAffiliation } from "./RegistrationAffiliation";

type Session = ReturnType<typeof userAuthSessionResponseSchema.parse>;

/** The signed-in session when it belongs to the registrant, else null. */
async function readOwnerSession(data: RegistrationManageReadResponse): Promise<Session | null> {
  const current = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema).catch(() => null);
  if (!current) return null;
  const owns =
    current.actingIdentities.some((identity) => identity.id === data.identityId) ||
    (data.identityId === null && current.identity.email.toLowerCase() === data.user.email.toLowerCase());
  return owns ? current : null;
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

/** Moves a registration to another identity the registrant holds; refused when it changed meanwhile. */
export async function saveRegistrationIdentity(
  registrationId: string,
  identityId: string,
  expectedIdentityId: string | null,
): Promise<void> {
  await putJson(
    `/api/v1/registrations/${encodeURIComponent(registrationId)}/identity`,
    registrationIdentityChangeSchema.parse({ identityId, expectedIdentityId }),
    registrationIdentityChangeResponseSchema,
  );
}
