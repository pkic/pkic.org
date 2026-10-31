import { ParticipationPersonalDetails, type PersonalNamePatch } from "./ParticipationPersonalDetails";
import {
  registrationProofPersonPatchSchema,
  registrationProofPersonPatchResponseSchema,
} from "../../shared/schemas/registration-email-proof";
import { IconPencil } from "./icons";
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { FieldPresentation } from "../hooks/useContractForm";
import { EMAIL_FIRST_COPY } from "../../shared/email-first-copy";
import { emailDomainOf, emailDomainResponseSchema, emailDomainUrl } from "../../shared/schemas/email-domains";
import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import {
  registrationEmailProofStartResponseSchema,
  registrationEmailProofStartSchema,
  type RegistrationEntry,
} from "../../shared/schemas/registration-email-proof";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { myProfileSchema, myProfileUpdateSchema } from "../../shared/schemas/me";
import { workEmailStepForKindSchema, type WorkEmailStep } from "../../shared/schemas/work-email";
import { getJson, postJson, patchJson } from "../shared/api-client";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { DescriptionList } from "../ui/DescriptionList";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { EmailFirstStep } from "./EmailFirstStep";
import { RegistrationConfirmOrganization, type ConfirmOrganizationController } from "./RegistrationConfirmOrganization";
import { RegistrationIdentityField } from "./RegistrationIdentitySelect";
import { useRegistrationEmailProof, type VerifiedRegistrationEmail } from "./useRegistrationEmailProof";

const copy = EMAIL_FIRST_COPY.registration;

/** Known details for an address the signed-in person continued with; names may still be missing. */
interface KnownPerson {
  firstName: string;
  lastName: string;
  identity: SessionActingIdentity | null;
  identities: SessionActingIdentity[];
  userId: string;
}

type Stage =
  | { kind: "email" }
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  /** A verification link went to this address; the person continues from the email. */
  | { kind: "sent"; email: string }
  /** Signed in with the same address: verified already, and continues with saved details. */
  | { kind: "known"; step: WorkEmailStep; person: KnownPerson };

/** The signed-in person, or null when this browser has no session; asked only once the visitor continues. */
async function readSession() {
  // Signed out (401) or unreadable alike: neither stops someone registering; they verify their address instead.
  return getJson("/api/v1/auth/session", userAuthSessionResponseSchema).catch(() => null);
}

async function readKnownPerson(session: Awaited<ReturnType<typeof readSession>>): Promise<KnownPerson> {
  if (!session) throw new Error("Sign in again before registering.");
  const detail = await getJson("/api/v1/users/current", myProfileSchema);
  return {
    firstName: detail.firstName ?? "",
    lastName: detail.lastName ?? "",
    identities: session.actingIdentities,
    userId: session.identity.id,
    identity: session.actingIdentities.find((identity) => identity.id === session.actingIdentityId) ?? null,
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

function AddressFields({ step, emailProof }: { step: WorkEmailStep; emailProof?: string }) {
  return (
    <>
      <input type="hidden" name="email" value={step.email} />
      <input type="hidden" name="unaffiliatedAttestation" value={step.unaffiliatedAttestation ? "true" : ""} />
      {emailProof && <input type="hidden" name="emailProof" value={emailProof} />}
    </>
  );
}

function Details({
  email,
  firstName,
  lastName,
  representation,
  onChangeEmail,
  saveNames,
  presentationOf,
}: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  representation?: ComponentChildren;
  onChangeEmail?: () => void;
  saveNames?: (names: PersonalNamePatch) => Promise<void>;
  presentationOf?: (name: string) => FieldPresentation;
}) {
  const refusal = presentationOf?.("firstName").message ?? presentationOf?.("lastName").message;
  return (
    <>
      <ParticipationPersonalDetails
        person={{ firstName: firstName ?? null, lastName: lastName ?? null }}
        save={saveNames}
        refusal={refusal}
        summary={(edit) => (
          <DescriptionList
            align="baseline"
            items={[
              ...(firstName && lastName
                ? [
                    {
                      term: "Name",
                      value: (
                        <span class="pk-cluster pk-cluster--nowrap">
                          <span>{`${firstName} ${lastName}`}</span>
                          {edit && (
                            <Button
                              type="button"
                              variant="ghost"
                              icon
                              aria-label="Edit personal details"
                              title="Edit personal details"
                              onClick={edit}
                            >
                              <IconPencil />
                            </Button>
                          )}
                        </span>
                      ),
                    },
                  ]
                : []),
              {
                term: "Email",
                value: (
                  <span class="pk-cluster pk-cluster--nowrap">
                    <span class="pk-break">{email}</span>
                    {onChangeEmail && (
                      <Button
                        type="button"
                        variant="ghost"
                        icon
                        aria-label={copy.changeEmail}
                        title={copy.changeEmail}
                        onClick={onChangeEmail}
                      >
                        <IconPencil />
                      </Button>
                    )}
                  </span>
                ),
              },
              ...(representation ? [{ term: "Representation", value: representation }] : []),
            ]}
          />
        )}
      />
      <NameFields firstName={firstName} lastName={lastName} presentationOf={presentationOf} />
    </>
  );
}

function VerifiedContact({
  verified,
  organization,
  changeEmail,
  endpoint,
  presentationOf,
}: {
  verified: VerifiedRegistrationEmail;
  organization: ConfirmOrganizationController;
  changeEmail: () => void;
  endpoint: string;
  presentationOf?: (name: string) => FieldPresentation;
}) {
  const [savedPerson, setSavedPerson] = useState(verified.person);
  const person = savedPerson;
  return (
    <div class="pk-stack">
      <AddressFields step={verified} emailProof={verified.token} />
      <Details
        email={verified.email}
        firstName={person?.firstName}
        lastName={person?.lastName}
        onChangeEmail={changeEmail}
        presentationOf={presentationOf}
        saveNames={
          person
            ? async (names) => {
                const saved = await patchJson(
                  `${endpoint}/proof/person`,
                  registrationProofPersonPatchSchema.parse({ token: verified.token, userId: person.userId, ...names }),
                  registrationProofPersonPatchResponseSchema,
                );
                setSavedPerson(saved.person);
              }
            : undefined
        }
      />
      {verified.affiliation && (
        <RegistrationConfirmOrganization
          key={verified.email}
          controller={organization}
          email={verified.email}
          proof={{ token: verified.token, endpoint: `${endpoint}/proof/verify`, affiliation: verified.affiliation }}
        />
      )}
    </div>
  );
}

/**
 * The registration's first step: the shared work-email step, verified before
 * anything else is asked. Continuing emails a verification link; opening it
 * returns the person to this form — in this tab or a new one — with the
 * address verified, their saved names filled in, and the shared organization
 * confirmation flow for a work address. A
 * person signed in with the same address has nothing to verify and continues
 * with their saved details and organization identity.
 */
export function RegistrationContactStep({
  endpoint,
  entry = {},
  organization,
  onReadyChange,
  autoSession = false,
  presentationOf,
}: {
  /** The event's registrations collection, under which the email proof lives. */
  endpoint: string;
  /** How the person reached the form; the link brings them back to the same entry. */
  entry?: RegistrationEntry;
  organization: ConfirmOrganizationController;
  onReadyChange: (ready: boolean) => void;
  /** An authenticated embedding starts with its current session, without a mailbox challenge. */
  autoSession?: boolean;
  presentationOf?: (name: string) => FieldPresentation;
}) {
  const [email, setEmail] = useState("");
  const [individual, setIndividual] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: autoSession ? "loading" : "email" });
  const proof = useRegistrationEmailProof(`${endpoint}/proof/verify`);
  const verified = proof.verified;
  useEffect(() => onReadyChange(Boolean(verified) || stage.kind === "known"), [verified, stage.kind, onReadyChange]);

  useEffect(() => {
    if (!autoSession) return;
    let active = true;
    void (async () => {
      try {
        const session = await readSession();
        const person = await readKnownPerson(session);
        if (active && session)
          setStage({
            kind: "known",
            person,
            step: { email: session.identity.email, unaffiliatedAttestation: person.identity?.organizationId === null },
          });
      } catch {
        if (active) setStage({ kind: "unavailable", message: "Close registration and sign in again to continue." });
      }
    })();
    return () => {
      active = false;
    };
  }, [autoSession]);

  async function proceed(step: WorkEmailStep): Promise<void> {
    // Ask the server what kind of mailbox this is first; a refusal is the ZodError the step reads onto its field.
    const domain = await getJson(emailDomainUrl(emailDomainOf(step.email)), emailDomainResponseSchema).catch(
      () => null,
    );
    if (domain) workEmailStepForKindSchema(domain.kind).parse(step);
    const session = await readSession();
    if (session && session.identity.email.toLowerCase() === step.email) {
      const person = await readKnownPerson(session);
      setStage({
        kind: "known",
        person,
        step: person.identity ? { ...step, unaffiliatedAttestation: person.identity.organizationId === null } : step,
      });
      return;
    }
    await postJson(
      `${endpoint}/proof`,
      registrationEmailProofStartSchema.parse({ ...step, entry }),
      registrationEmailProofStartResponseSchema,
    );
    setStage({ kind: "sent", email: step.email });
  }

  const changeEmail = () => {
    proof.forget();
    setStage({ kind: "email" });
  };

  if (stage.kind === "loading") return <p role="status">Loading your saved details…</p>;
  if (stage.kind === "unavailable") return <Alert tone="danger">{stage.message}</Alert>;

  if (proof.verifying) return <p role="status">Verifying your email address…</p>;

  if (verified)
    return (
      <VerifiedContact
        verified={verified}
        endpoint={endpoint}
        organization={organization}
        changeEmail={changeEmail}
        presentationOf={presentationOf}
      />
    );

  if (stage.kind === "known") {
    const { person, step } = stage;
    return (
      <div class="pk-stack">
        <AddressFields step={step} />
        <Details
          email={step.email}
          onChangeEmail={!autoSession ? changeEmail : undefined}
          firstName={person.firstName}
          lastName={person.lastName}
          presentationOf={presentationOf}
          saveNames={async (names) => {
            const saved = await patchJson("/api/v1/users/current", myProfileUpdateSchema.parse(names), myProfileSchema);
            setStage({
              kind: "known",
              person: { ...person, firstName: saved.firstName ?? "", lastName: saved.lastName ?? "" },
              step,
            });
          }}
          representation={
            <RegistrationIdentityField
              preferred={person.identity}
              available={person.identities}
              userId={person.userId}
              onSelect={(identity) => {
                setStage({
                  kind: "known",
                  person: { ...person, identity },
                  step: { ...step, unaffiliatedAttestation: identity?.organizationId === null },
                });
              }}
            />
          }
        />
      </div>
    );
  }

  return (
    <div class="pk-stack">
      {proof.error && <Alert tone="danger">{proof.error}</Alert>}
      <EmailFirstStep
        flow="registration"
        schema={registrationEmailProofStartSchema}
        body={{ entry }}
        email={email}
        onEmailChange={setEmail}
        individual={individual}
        onIndividualChange={setIndividual}
        onContinue={proceed}
        sentTo={stage.kind === "sent" ? stage.email : null}
        onChangeEmail={changeEmail}
      />
    </div>
  );
}
