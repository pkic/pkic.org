import { useEffect, useState } from "preact/hooks";
import { EMAIL_FIRST_COPY } from "../../shared/email-first-copy";
import { emailDomainOf, emailDomainResponseSchema, emailDomainUrl } from "../../shared/schemas/email-domains";
import type { SessionActingIdentity } from "../../shared/session-acting-identity";
import {
  registrationEmailProofStartResponseSchema,
  registrationEmailProofStartSchema,
  type RegistrationEntry,
} from "../../shared/schemas/registration-email-proof";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { myProfileSchema } from "../../shared/schemas/me";
import { workEmailStepForKindSchema, type WorkEmailStep } from "../../shared/schemas/work-email";
import { getJson, postJson } from "../shared/api-client";
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
  hasIdentities: boolean;
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
    hasIdentities: session.actingIdentities.length > 0,
    identity: session.actingIdentities.find((identity) => identity.id === session.actingIdentityId) ?? null,
  };
}

/** Saved names are shown, not asked again; a missing one is asked for. */
function NameFields({ firstName = "", lastName = "" }: { firstName?: string | null; lastName?: string | null }) {
  const [draft, setDraft] = useState({ firstName: firstName ?? "", lastName: lastName ?? "" });
  if (firstName && lastName)
    return (
      <>
        <input type="hidden" name="firstName" value={firstName} />
        <input type="hidden" name="lastName" value={lastName} />
      </>
    );
  return (
    <div class="pk-split">
      <Field id="registration-first-name" label="First name" errorSlot="firstName" required>
        {(control) => (
          <TextInput
            {...control}
            name="firstName"
            required
            autoComplete="given-name"
            value={draft.firstName}
            onInput={(event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({ ...current, firstName: value }));
            }}
          />
        )}
      </Field>
      <Field id="registration-last-name" label="Last name" errorSlot="lastName" required>
        {(control) => (
          <TextInput
            {...control}
            name="lastName"
            required
            autoComplete="family-name"
            value={draft.lastName}
            onInput={(event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({ ...current, lastName: value }));
            }}
          />
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
}: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}) {
  return (
    <DescriptionList
      items={[
        ...(firstName && lastName ? [{ term: "Name", value: `${firstName} ${lastName}` }] : []),
        { term: "Email", value: email },
      ]}
    />
  );
}

function VerifiedContact({
  verified,
  organization,
  changeEmail,
}: {
  verified: VerifiedRegistrationEmail;
  organization: ConfirmOrganizationController;
  changeEmail: () => void;
}) {
  const { person } = verified;
  return (
    <div class="pk-stack">
      <AddressFields step={verified} emailProof={verified.token} />
      <Details email={verified.email} firstName={person?.firstName} lastName={person?.lastName} />
      <NameFields firstName={person?.firstName} lastName={person?.lastName} />
      {verified.asksOrganization && <RegistrationConfirmOrganization controller={organization} />}
      <div>
        <Button type="button" variant="link" onClick={changeEmail}>
          {copy.changeEmail}
        </Button>
      </div>
    </div>
  );
}

/**
 * The registration's first step: the shared work-email step, verified before
 * anything else is asked. Continuing emails a verification link; opening it
 * returns the person to this form — in this tab or a new one — with the
 * address verified, their saved names filled in, and, for a work domain that
 * names no organization yet, the organization and job title asked once. A
 * person signed in with the same address has nothing to verify and continues
 * with their saved details and organization identity.
 */
export function RegistrationContactStep({
  endpoint,
  entry = {},
  organization,
  onReadyChange,
  autoSession = false,
}: {
  /** The event's registrations collection, under which the email proof lives. */
  endpoint: string;
  /** How the person reached the form; the link brings them back to the same entry. */
  entry?: RegistrationEntry;
  organization: ConfirmOrganizationController;
  onReadyChange: (ready: boolean) => void;
  /** An authenticated embedding starts with its current session, without a mailbox challenge. */
  autoSession?: boolean;
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

  if (verified) return <VerifiedContact verified={verified} organization={organization} changeEmail={changeEmail} />;

  if (stage.kind === "known") {
    const { person, step } = stage;
    return (
      <div class="pk-stack">
        <AddressFields step={step} />
        <Details email={step.email} firstName={person.firstName} lastName={person.lastName} />
        <NameFields firstName={person.firstName} lastName={person.lastName} />
        {person.hasIdentities && (
          <RegistrationIdentityField
            preferred={person.identity}
            onSelect={(identity) => {
              setStage({
                kind: "known",
                person: { ...person, identity },
                step: { ...step, unaffiliatedAttestation: identity?.organizationId === null },
              });
            }}
          />
        )}
        {!autoSession && (
          <div>
            <Button type="button" variant="link" onClick={changeEmail}>
              {copy.changeEmail}
            </Button>
          </div>
        )}
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
