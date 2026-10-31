/**
 * The signed-in applicant on the membership application form.
 *
 * A signed-in person applies as one of the identities they hold, the way they
 * register for an event: their name, email and representation are shown, not
 * typed again, and profile changes go through the representation dialog. The
 * server copies the identity's details into the application when it is
 * submitted. Refusals the session already shows (an existing membership, or an
 * individual application while representing an organization) replace the form
 * before anyone fills it in; the server refuses them again on submit.
 */
import { useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { myProfileSchema } from "../../shared/schemas/me";
import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import {
  INDIVIDUAL_ALREADY_MEMBER_MESSAGE,
  individualWhileRepresentingMessage,
} from "../../shared/membership-application-refusals";
import { RegistrationIdentityField } from "../components/RegistrationIdentitySelect";
import { DescriptionList } from "../ui/DescriptionList";
import { ButtonLink } from "../ui/Button";

export interface SignedInApplicant {
  userId: string;
  name: string;
  email: string;
  identities: SessionActingIdentity[];
  preferred: SessionActingIdentity;
}

/** The signed-in person who can apply as one of their identities, or null to use the verified-email path. */
export async function readSignedInApplicant(): Promise<SignedInApplicant | null> {
  const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema).catch(() => null);
  if (!session || session.actingIdentities.length === 0) return null;
  const profile = await getJson("/api/v1/users/current", myProfileSchema).catch(() => null);
  if (!profile) return null;
  const identities = session.actingIdentities;
  return {
    userId: session.identity.id,
    name: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
    email: profile.email || session.identity.email,
    identities,
    preferred: identities.find((identity) => identity.id === session.actingIdentityId) ?? identities[0],
  };
}

export type JoinRefusal =
  | { kind: "organization_member"; organizationName: string; href: string }
  | { kind: "individual_member"; href: string }
  | { kind: "representing"; organizationName: string };

/** What the session already shows would refuse an application as this identity. */
export function joinRefusalFor(
  identity: SessionActingIdentity,
  identities: readonly SessionActingIdentity[],
): JoinRefusal | null {
  if (identity.organizationId && identity.membershipCategory)
    return {
      kind: "organization_member",
      organizationName: identity.organizationName ?? "This organization",
      href: `/portal/#/organizations/${encodeURIComponent(identity.organizationId)}`,
    };
  if (identity.organizationId) return null;
  if (identity.membershipCategory) return { kind: "individual_member", href: "/portal/#/home" };
  const representation = identities.find((candidate) => candidate.organizationId);
  if (representation)
    return { kind: "representing", organizationName: representation.organizationName ?? "an organization" };
  return null;
}

function Refusal({ refusal }: { refusal: JoinRefusal }) {
  if (refusal.kind === "organization_member")
    return (
      <section data-join-refusal={refusal.kind}>
        <h2>{refusal.organizationName} is already a member</h2>
        <p>
          You represent {refusal.organizationName}, so no new application is needed. Manage its membership in the member
          portal.
        </p>
        <ButtonLink variant="primary" href={refusal.href}>
          Manage membership
        </ButtonLink>
      </section>
    );
  if (refusal.kind === "individual_member")
    return (
      <section data-join-refusal={refusal.kind}>
        <h2>You are already a member</h2>
        <p>{INDIVIDUAL_ALREADY_MEMBER_MESSAGE}</p>
        <ButtonLink variant="primary" href={refusal.href}>
          Go to the member portal
        </ButtonLink>
      </section>
    );
  return (
    <section data-join-refusal={refusal.kind}>
      <h2>Apply for your organization instead</h2>
      <p>
        {individualWhileRepresentingMessage(refusal.organizationName)} To apply for the organization, change the
        representation above.
      </p>
    </section>
  );
}

/** Name, email and representation of the signed-in applicant, and the refusal for the chosen identity, if any. */
export function JoinSignedInApplicant({
  applicant,
  onIdentityChange,
}: {
  applicant: SignedInApplicant;
  onIdentityChange: (identity: SessionActingIdentity, refusal: JoinRefusal | null) => void;
}) {
  const [identity, setIdentity] = useState(applicant.preferred);
  const [identities, setIdentities] = useState(applicant.identities);
  const refusal = joinRefusalFor(identity, identities);
  const choose = (next: SessionActingIdentity, roster: readonly SessionActingIdentity[] = identities) => {
    setIdentity(next);
    onIdentityChange(next, joinRefusalFor(next, roster));
  };
  return (
    <div class="pk-stack">
      <DescriptionList
        align="baseline"
        items={[
          ...(applicant.name ? [{ term: "Name", value: applicant.name }] : []),
          { term: "Email", value: <span class="pk-break">{applicant.email}</span> },
          {
            term: "Representation",
            value: (
              <RegistrationIdentityField
                preferred={applicant.preferred}
                available={applicant.identities}
                userId={applicant.userId}
                personalAdvisory={false}
                onSelect={(next) => {
                  if (!next) return;
                  // A representation added in the dialog joins the roster the refusal reads.
                  const roster = identities.some((item) => item.id === next.id) ? identities : [...identities, next];
                  setIdentities(roster);
                  choose(next, roster);
                }}
                onUpdated={(updated) => {
                  const roster = identities.map((item) => (item.id === updated.id ? updated : item));
                  setIdentities(roster);
                  if (updated.id === identity.id) choose(updated, roster);
                }}
              />
            ),
          },
        ]}
      />
      {refusal && <Refusal refusal={refusal} />}
    </div>
  );
}
