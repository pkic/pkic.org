import type { PersonalNamePatch } from "./ParticipationPersonalDetails";
import { PersonDetailsSummary } from "./PersonDetailsSummary";
import { useCallback, useEffect, useState } from "preact/hooks";
import type { ComponentChildren, RefObject } from "preact";
import { createPortal } from "preact/compat";
import type { z } from "zod";
import type { FieldPresentation } from "../hooks/useContractForm";
import { emailDomainOf, emailDomainResponseSchema, emailDomainUrl } from "../../shared/schemas/email-domains";
import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { myProfileSchema, myProfileUpdateSchema } from "../../shared/schemas/me";
import type { WorkEmailStep } from "../../shared/schemas/work-email";
import { getJson, patchJson } from "../shared/api-client";
import { Alert } from "../ui/Alert";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { SignInCard } from "./sign-in/SignInCard";
import { RegistrationIdentityField } from "./RegistrationIdentitySelect";

/** The signed-in person's saved details; names may still be missing. */
interface KnownPerson {
  firstName: string;
  lastName: string;
  identity: SessionActingIdentity | null;
  identities: SessionActingIdentity[];
  userId: string;
}

type Stage =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  /** No session in this browser: the person signs in or starts an account, then returns here. */
  | { kind: "signed-out" }
  /** Signed in: the account's address is verified already, and registration continues with saved details. */
  | { kind: "known"; step: WorkEmailStep; person: KnownPerson; workEmail: boolean };

type Session = z.infer<typeof userAuthSessionResponseSchema>;

/** The signed-in person, or null when this browser has no session. */
async function readSession(): Promise<Session | null> {
  // Signed out (401) or unreadable alike: the person signs in to continue.
  return getJson("/api/v1/auth/session", userAuthSessionResponseSchema).catch(() => null);
}

async function readKnownPerson(session: Session): Promise<KnownPerson> {
  const detail = await getJson("/api/v1/users/current", myProfileSchema);
  return {
    firstName: detail.firstName ?? "",
    lastName: detail.lastName ?? "",
    identities: session.actingIdentities,
    userId: session.identity.id,
    identity: session.actingIdentities.find((identity) => identity.id === session.actingIdentityId) ?? null,
  };
}

/** Where the session stands: signed out, or the details registration continues with. */
async function readStage(): Promise<Stage> {
  const session = await readSession();
  if (!session) return { kind: "signed-out" };
  const [person, domain] = await Promise.all([
    readKnownPerson(session),
    getJson(emailDomainUrl(emailDomainOf(session.identity.email)), emailDomainResponseSchema).catch(() => null),
  ]);
  return {
    kind: "known",
    person,
    workEmail: domain?.kind === "work",
    step: { email: session.identity.email, unaffiliatedAttestation: person.identity?.organizationId === null },
  };
}

/** Saved names are shown, not asked again; a missing one is asked for. */
function NameFields({
  firstName = "",
  lastName = "",
  presentationOf,
}: {
  firstName?: string | null;
  lastName?: string | null;
  presentationOf?: (name: string) => FieldPresentation;
}) {
  if (firstName && lastName)
    return (
      <>
        <input type="hidden" name="firstName" value={firstName} />
        <input type="hidden" name="lastName" value={lastName} />
      </>
    );
  return (
    <div class="pk-split">
      <Field
        id="registration-first-name"
        label="First name"
        errorSlot="firstName"
        required
        {...presentationOf?.("firstName")}
      >
        {(control) => (
          <TextInput {...control} name="firstName" required autoComplete="given-name" defaultValue={firstName ?? ""} />
        )}
      </Field>
      <Field
        id="registration-last-name"
        label="Last name"
        errorSlot="lastName"
        required
        {...presentationOf?.("lastName")}
      >
        {(control) => (
          <TextInput {...control} name="lastName" required autoComplete="family-name" defaultValue={lastName ?? ""} />
        )}
      </Field>
    </div>
  );
}

function AddressFields({ step }: { step: WorkEmailStep }) {
  return (
    <>
      <input type="hidden" name="email" value={step.email} />
      <input type="hidden" name="unaffiliatedAttestation" value={step.unaffiliatedAttestation ? "true" : ""} />
    </>
  );
}

function Details({
  email,
  firstName,
  lastName,
  representation,
  saveNames,
  presentationOf,
}: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  representation?: ComponentChildren;
  saveNames?: (names: PersonalNamePatch) => Promise<void>;
  presentationOf?: (name: string) => FieldPresentation;
}) {
  const refusal = presentationOf?.("firstName").message ?? presentationOf?.("lastName").message;
  return (
    <>
      <PersonDetailsSummary
        email={email}
        firstName={firstName}
        lastName={lastName}
        representation={representation}
        saveNames={saveNames}
        refusal={refusal}
      />
      {saveNames ? (
        <>
          <input type="hidden" name="firstName" value={firstName ?? ""} />
          <input type="hidden" name="lastName" value={lastName ?? ""} />
        </>
      ) : (
        <NameFields firstName={firstName} lastName={lastName} presentationOf={presentationOf} />
      )}
    </>
  );
}

/**
 * The registration's first step: who is registering. A signed-in person
 * continues with their saved details and chooses the identity they register
 * as. Without a session the shared sign-in card takes this step: the person
 * signs in or starts an account, and comes back to this form signed in.
 */
export function RegistrationContactStep({
  signInSlot,
  onReadyChange,
  onSignInChange,
  presentationOf,
}: {
  /** Where the sign-in card renders: outside the registration form, because the card has a form of its own. */
  signInSlot: RefObject<HTMLElement>;
  onReadyChange: (ready: boolean) => void;
  /** Tells the flow whether the sign-in card stands in for the form. */
  onSignInChange?: (signingIn: boolean) => void;
  presentationOf?: (name: string) => FieldPresentation;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  useEffect(() => onReadyChange(stage.kind === "known"), [stage.kind, onReadyChange]);
  useEffect(() => onSignInChange?.(stage.kind === "signed-out"), [stage.kind, onSignInChange]);

  const load = useCallback(async () => {
    try {
      setStage(await readStage());
    } catch {
      setStage({ kind: "unavailable", message: "We could not load your details. Reload this page to try again." });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (stage.kind === "loading") return <p role="status">Loading your saved details…</p>;
  if (stage.kind === "unavailable") return <Alert tone="danger">{stage.message}</Alert>;

  if (stage.kind === "known") {
    const { person, step, workEmail } = stage;
    return (
      <div class="pk-stack">
        {workEmail && !person.identity?.organizationId && (
          <Alert tone="info">
            This email address uses an organization domain. Choose or add the organization you represent for this
            registration.
          </Alert>
        )}
        <AddressFields step={step} />
        <Details
          email={step.email}
          firstName={person.firstName}
          lastName={person.lastName}
          presentationOf={presentationOf}
          saveNames={async (names) => {
            const saved = await patchJson("/api/v1/users/current", myProfileUpdateSchema.parse(names), myProfileSchema);
            setStage({
              kind: "known",
              person: { ...person, firstName: saved.firstName ?? "", lastName: saved.lastName ?? "" },
              step,
              workEmail,
            });
          }}
          representation={
            <RegistrationIdentityField
              preferred={person.identity}
              available={person.identities}
              organizationOnly={workEmail}
              userId={person.userId}
              onSelect={(identity) => {
                setStage({
                  kind: "known",
                  person: { ...person, identity },
                  step: { ...step, unaffiliatedAttestation: identity?.organizationId === null },
                  workEmail,
                });
              }}
            />
          }
        />
      </div>
    );
  }

  if (!signInSlot.current) return null;
  // Invitation and source parameters ride along, so the emailed link returns to the same registration.
  return createPortal(
    <SignInCard
      embedded={{ returnPath: `${location.pathname}${location.search}`, emailFlow: "registration" }}
      onSignedIn={load}
    />,
    signInSlot.current,
  );
}
