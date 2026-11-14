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
 *
 * Someone who represents no organization yet says how they are joining: for
 * their organization, or as an individual. That answer is the explicit
 * individual capacity; it is never read from their address.
 */
import { useState } from "preact/hooks";
import { EMAIL_FIRST_COPY } from "../../shared/email-first-copy";
import { ChoiceCard, ChoiceCards } from "../ui/ChoiceCard";
import { StateIcon } from "../ui/Field";
import { IconOrganization } from "../components/icons";
import { IconPerson } from "../components/icons/app-navigation";
import { getJson, patchJson } from "../shared/api-client";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { myProfileSchema, myProfileUpdateSchema } from "../../shared/schemas/me";
import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import {
  INDIVIDUAL_ALREADY_MEMBER_MESSAGE,
  individualWhileRepresentingMessage,
} from "../../shared/membership-application-refusals";
import { RegistrationIdentityField } from "../components/RegistrationIdentitySelect";
import { ButtonLink } from "../ui/Button";
import { PersonDetailsSummary } from "../components/PersonDetailsSummary";

/** How a person who represents no organization yet is joining. */
export type JoinPath = "organization" | "individual";

export interface SignedInApplicant {
  userId: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  identities: SessionActingIdentity[];
  preferred: SessionActingIdentity;
}

/** The signed-in person who can apply as one of their identities, or null when nobody is signed in. */
export async function readSignedInApplicant(): Promise<SignedInApplicant | null> {
  const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema).catch(() => null);
  if (!session || session.actingIdentities.length === 0) return null;
  const profile = await getJson("/api/v1/users/current", myProfileSchema).catch(() => null);
  if (!profile) return null;
  const identities = session.actingIdentities;
  return {
    userId: session.identity.id,
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
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

/** The two ways in for someone who represents no organization yet, each with what it means. */
function JoinPathChoice({ path, onChoose }: { path: JoinPath | null; onChoose: (path: JoinPath) => void }) {
  return (
    <ChoiceCards legend="How are you joining?">
      <ChoiceCard
        name="joinPath"
        value="organization"
        checked={path === "organization"}
        onChange={() => onChoose("organization")}
        icon={<IconOrganization />}
        title="For my organization"
        description="I work for or own the organization that is joining."
        points={EMAIL_FIRST_COPY.join.work.points}
      />
      <ChoiceCard
        name="joinPath"
        value="individual"
        checked={path === "individual"}
        onChange={() => onChoose("individual")}
        icon={<IconPerson />}
        iconMark={<StateIcon state="advisory" />}
        title="As an individual"
        description={EMAIL_FIRST_COPY.join.personal.description}
        points={EMAIL_FIRST_COPY.join.personal.points}
        pointTone="cost"
      />
    </ChoiceCards>
  );
}

/**
 * Name, email and representation of the signed-in applicant, the refusal for the chosen identity, if any,
 * and, for an identity without an organization, the choice of how they are joining. A new account has
 * no name yet, and the application needs one, so the name is edited in place.
 */
export function JoinSignedInApplicant({
  applicant,
  initialPath = null,
  onChange,
  onNamesSaved,
}: {
  applicant: SignedInApplicant;
  /** The applicant with the name they just saved to their profile. */
  onNamesSaved?: (applicant: SignedInApplicant) => void;
  /** The path kept from earlier in this tab. */
  initialPath?: JoinPath | null;
  onChange: (identity: SessionActingIdentity, refusal: JoinRefusal | null, path: JoinPath | null) => void;
}) {
  const [identity, setIdentity] = useState(applicant.preferred);
  const [identities, setIdentities] = useState(applicant.identities);
  const [path, setPath] = useState<JoinPath | null>(initialPath);
  const [names, setNames] = useState({ firstName: applicant.firstName, lastName: applicant.lastName });
  const refusal = joinRefusalFor(identity, identities);
  const choose = (next: SessionActingIdentity, roster: readonly SessionActingIdentity[] = identities) => {
    setIdentity(next);
    onChange(next, joinRefusalFor(next, roster), path);
  };
  return (
    <div class="pk-stack">
      <PersonDetailsSummary
        email={applicant.email}
        firstName={names.firstName}
        lastName={names.lastName}
        saveNames={async (patch) => {
          const saved = await patchJson("/api/v1/users/current", myProfileUpdateSchema.parse(patch), myProfileSchema);
          const next = { firstName: saved.firstName ?? "", lastName: saved.lastName ?? "" };
          setNames(next);
          onNamesSaved?.({ ...applicant, ...next, name: [next.firstName, next.lastName].filter(Boolean).join(" ") });
        }}
        representation={
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
        }
      />
      {refusal && <Refusal refusal={refusal} />}
      {!refusal && !identity.organizationId && (
        <JoinPathChoice
          path={path}
          onChoose={(next) => {
            setPath(next);
            onChange(identity, null, next);
          }}
        />
      )}
    </div>
  );
}
