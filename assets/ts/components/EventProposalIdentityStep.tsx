import { personNamePatchSchema } from "../../shared/schemas/api-common";
import { useDialogQueryState } from "../hooks/useDialogQueryState";
import type { ComponentChildren } from "preact";
import type { z } from "zod";
import { useEffect, useMemo, useState, useRef } from "preact/hooks";
import type { RequiredTerm } from "../../shared/schemas/forms";
import type { ProposalEntryContext } from "../../shared/schemas/proposal-entry";
import type { ConsentItem } from "../../shared/schemas/registration";
import {
  eventProposalProofStartSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofIdentitiesSchema,
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
} from "../../shared/schemas/event-proposal-proof";
import {
  VerifiedOrganizationDetails,
  type VerifiedOrganizationController,
} from "./identities/VerifiedOrganizationDetails";
import type { CollectionLoader } from "../hooks/useServerCollection";
import { getJson, postJson, requestJson } from "../shared/api-client";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { identitiesListResponseSchema } from "../../shared/schemas/identity";
import { IdentityCreateDialog } from "./identities/IdentityCreateDialog";
import { Alert } from "../ui/Alert";
import { Button, ButtonLink } from "../ui/Button";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { FormSection } from "../ui/FormSection";
import { EmailFirstStep } from "./EmailFirstStep";
import { ADDRESS_IN_USE_COPY, EMAIL_FIRST_COPY } from "../../shared/email-first-copy";
import { ParticipationRepresentation } from "./ParticipationRepresentation";
import { ParticipationPersonalDetails } from "./ParticipationPersonalDetails";
import { ParticipationIdentitySummary } from "./ParticipationIdentitySummary";
import { RepresentationSelect } from "./identities/RepresentationSelect";
import {
  IndependentCapacityDisclosure,
  completedIndependentCapacity,
  type IndependentCapacityDraft,
} from "./IndependentCapacityDisclosure";
import {
  useProposalEntryIdentity,
  type ProposalEntrySelection,
  type ParticipationPerson,
  type VerifiedProposalEntry,
} from "./useProposalEntryIdentity";

export function EventProposalIdentityStep({
  enabled,
  eventSlug,
  consents,
  onChange,
  onTermsRecorded,
  speakerManagementToken,
  speakerProposalId,
  expectedSpeakerUserId,
  entryContext,
  onSavePersonalDetails,
  personalDetails,
  startWithEmailProof,
  initialProof,
  invitedEmail,
}: {
  enabled: boolean;
  /** The address a speaker was invited at, offered first; their invitation link may already have proved it. */
  invitedEmail?: string;
  personalDetails?: ComponentChildren;
  startWithEmailProof?: boolean;
  initialProof?: VerifiedProposalEntry;
  eventSlug: string;
  consents: () => { termKey: RequiredTerm["termKey"]; version: RequiredTerm["version"] }[];
  onChange: (selection: ProposalEntrySelection | null) => void;
  /** The terms a confirmed email recorded before its link was sent; the flow does not ask for them again. */
  onTermsRecorded?: (consents: ConsentItem[]) => void;
  speakerManagementToken?: string;
  speakerProposalId?: string;
  expectedSpeakerUserId?: string | null;
  entryContext?: ProposalEntryContext;
  onSavePersonalDetails?: (names: z.infer<typeof personNamePatchSchema>) => Promise<ParticipationPerson>;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(eventSlug)}/proposals/proof`;
  const identity = useProposalEntryIdentity(
    enabled,
    endpoint,
    speakerManagementToken,
    expectedSpeakerUserId,
    onSavePersonalDetails,
    startWithEmailProof,
    speakerProposalId,
    initialProof,
    invitedEmail,
  );
  const [sent, setSent] = useState(false);
  const [changing, setChanging] = useState(false);
  const [adding, showAdding, closeAdding] = useDialogQueryState("identity");
  const flow = speakerManagementToken || speakerProposalId ? "speaker" : "proposal";
  // Each page names its own save, not the other flow's.
  const savedWhen = flow === "speaker" ? "when you save your speaker identity" : "when you submit your proposal";
  const proofBody = {
    consents: consents(),
    speakerManagementToken: identity.proofOwnerToken ? undefined : speakerManagementToken,
    continuationToken: identity.proofOwnerToken,
    speakerProposalId,
    entryContext:
      identity.proofOwnerToken || speakerManagementToken || speakerProposalId
        ? undefined
        : (identity.entryContext ?? entryContext),
  };
  const [disclosure, setDisclosure] = useState<IndependentCapacityDraft>({});
  const organization = useRef<VerifiedOrganizationController>({});
  const [organizationDraftRevision, setOrganizationDraftRevision] = useState(0);
  const usesOrganizationChooser = Boolean(
    identity.affiliation && !identity.selected && identity.kind === "organization",
  );
  // Taking part as an individual is complete only with the independence disclosure the contract accepts.
  const entry = useMemo<ProposalEntrySelection | null>(() => {
    // On behalf of an organization, a chosen representation needs its job title before the person continues.
    if (identity.selection && identity.kind === "organization" && identity.selected && !identity.selected.jobTitle)
      return null;
    if (identity.selection && usesOrganizationChooser)
      return {
        ...identity.selection,
        validateAffiliation: () => organization.current.validate?.() ?? false,
        prepareAffiliation: async () => {
          if (!(await organization.current.prepare?.()))
            throw new Error("Check your organization details before continuing.");
          const chosen = organization.current.read?.();
          if (!chosen || "refused" in chosen) throw new Error("Check your organization details before continuing.");
          return {
            organizationName: chosen.organizationName,
            jobTitle: chosen.input.jobTitle,
            organizationContextToken: chosen.contextToken,
          };
        },
      };
    if (!identity.selection || identity.kind !== "individual") return identity.selection;
    const independentCapacity = completedIndependentCapacity(disclosure);
    return independentCapacity ? { ...identity.selection, independentCapacity } : null;
  }, [identity.selection, identity.kind, identity.selected, disclosure, usesOrganizationChooser]);
  useEffect(() => {
    onChange(entry);
  }, [entry, onChange]);
  useEffect(() => {
    if (identity.recordedConsents) onTermsRecorded?.(identity.recordedConsents);
  }, [identity.recordedConsents, onTermsRecorded]);
  // The banner sits below the step; bring a new error into view instead of leaving it off screen.
  const errorBanner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (identity.error) errorBanner.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [identity.error]);
  const load = useMemo<CollectionLoader | undefined>(
    () =>
      identity.continuationToken
        ? (url, signal, schema) =>
            requestJson(url, schema, {
              method: "POST",
              signal,
              body: JSON.stringify(
                eventProposalProofIdentitiesSchema.parse({
                  continuationToken: identity.continuationToken,
                  speakerManagementToken,
                  speakerProposalId,
                }),
              ),
            })
        : undefined,
    [identity.continuationToken, speakerManagementToken, speakerProposalId],
  );
  if (!enabled) return null;
  async function sendProof(proof: z.output<typeof eventProposalProofStartSchema>): Promise<void> {
    identity.setError(undefined);
    const started = await postJson(endpoint, proof, eventProposalProofStartResponseSchema);
    // The speaker's own invitation link already proved this address: continue without a second email.
    if (started.status === "verified") await identity.verify(started.token);
    else setSent(true);
  }
  function addRepresentation() {
    if (identity.authenticated) showAdding();
    else {
      identity.useDifferentEmail();
      setSent(false);
      setChanging(false);
    }
  }
  const person = identity.person;
  const knownPerson = identity.knownPerson;
  const summaryPerson = knownPerson
    ? {
        ...knownPerson,
        email: knownPerson.email,
        organizationName: identity.selected?.organizationName ?? null,
        jobTitle: identity.selected?.jobTitle ?? null,
      }
    : null;
  const resolved = Boolean(identity.selection);
  const needsFirstName = person && !identity.knownPerson?.firstName;
  const needsLastName = person && !identity.knownPerson?.lastName;
  const catalogEndpoint = identity.continuationToken ? `${endpoint}/identities` : "/api/v1/users/current/identities";
  const selector = (
    <RepresentationSelect
      endpoint={catalogEndpoint}
      load={load}
      organizationOnly
      value={identity.selected ?? null}
      onAdd={addRepresentation}
      onSelect={(value) => {
        if (identity.kind !== "organization") identity.setKind("organization");
        identity.choose(value);
        setChanging(false);
      }}
    />
  );
  const representationActions = identity.storedPerson && (
    <div class="pk-cluster">
      <Button type="button" variant="secondary" onClick={() => setChanging(!changing)}>
        Choose another representation
      </Button>
      {!changing && (
        <Button type="button" variant="secondary" onClick={addRepresentation}>
          Add representation
        </Button>
      )}
    </div>
  );
  return (
    <div class="pk-stack pk-stack--loose">
      {identity.loading ? (
        <p role="status">Loading your details…</p>
      ) : (
        <>
          {personalDetails}
          {(!resolved || changing) && (
            <>
              {identity.authenticated || (identity.continuationToken && identity.storedPerson) ? (
                <>
                  {/* A confirmed mailbox proved one capacity; only a signed-in person switches without a new proof. */}
                  {(identity.authenticated || identity.kind === "organization") && selector}
                  <div class="pk-cluster">
                    <Button type="button" variant="link" onClick={() => identity.setKind("individual")}>
                      {EMAIL_FIRST_COPY[flow].individualSwitch}
                    </Button>
                  </div>
                </>
              ) : (
                !identity.continuationToken && (
                  <EmailFirstStep
                    flow={flow}
                    schema={eventProposalProofStartSchema}
                    body={proofBody}
                    email={identity.email}
                    onEmailChange={(value) => {
                      identity.setEmail(value);
                      setSent(false);
                    }}
                    individual={identity.kind === "individual"}
                    onIndividualChange={(value) => {
                      identity.setKind(value ? "individual" : "organization");
                      setSent(false);
                    }}
                    onContinue={sendProof}
                    sentTo={sent ? identity.email : null}
                    onChangeEmail={() => {
                      identity.setEmail("");
                      setSent(false);
                    }}
                  />
                )
              )}
            </>
          )}
          {person && resolved && (
            <>
              {!personalDetails && (
                <ParticipationPersonalDetails
                  person={knownPerson ?? { ...person, firstName: null, lastName: null }}
                  description={
                    needsFirstName || needsLastName
                      ? `These new details are not saved yet. They will be saved ${savedWhen}.`
                      : undefined
                  }
                  save={
                    identity.storedPerson &&
                    (!speakerManagementToken || onSavePersonalDetails) &&
                    !needsFirstName &&
                    !needsLastName
                      ? identity.savePersonalDetails
                      : undefined
                  }
                >
                  {needsFirstName && (
                    <Field label="First name" errorSlot="proposer.firstName">
                      {(control) => (
                        <TextInput
                          {...control}
                          name="firstName"
                          required
                          value={person.firstName ?? ""}
                          onInput={(event) => identity.complete("firstName", event.currentTarget.value)}
                        />
                      )}
                    </Field>
                  )}
                  {needsLastName && (
                    <Field label="Last name" errorSlot="proposer.lastName">
                      {(control) => (
                        <TextInput
                          {...control}
                          name="lastName"
                          required
                          value={person.lastName ?? ""}
                          onInput={(event) => identity.complete("lastName", event.currentTarget.value)}
                        />
                      )}
                    </Field>
                  )}
                </ParticipationPersonalDetails>
              )}
              {identity.selected && summaryPerson ? (
                <ParticipationRepresentation
                  key={identity.selected.id}
                  requireJobTitle
                  person={{ ...summaryPerson, email: identity.selected.email }}
                  save={identity.saveRepresentation}
                  savedMessage="Your current representation is updated."
                >
                  {representationActions}
                </ParticipationRepresentation>
              ) : (
                <FormSection
                  title="Your representation for this proposal"
                  layout="stack"
                  description={
                    usesOrganizationChooser
                      ? `Your representation is saved ${savedWhen}.`
                      : identity.storedPerson && identity.kind === "organization"
                        ? "Choose an existing representation or verify your organization email to add one."
                        : undefined
                  }
                >
                  {knownPerson && (
                    <ParticipationIdentitySummary
                      person={
                        usesOrganizationChooser
                          ? { ...knownPerson, email: person.email, organizationName: null, jobTitle: null }
                          : knownPerson
                      }
                      applicantKind={identity.kind}
                      knownOnly
                      scope="representation"
                    />
                  )}
                  {usesOrganizationChooser && identity.affiliation && (
                    <VerifiedOrganizationDetails
                      key={`${identity.verificationToken}:${organizationDraftRevision}`}
                      initial={identity.affiliation}
                      emailId={null}
                      controller={organization.current}
                      onDraftChange={(draft) => {
                        identity.complete("organizationName", draft.organizationName);
                        identity.complete("jobTitle", draft.jobTitle);
                      }}
                      resolve={async (domain) => {
                        const result = await postJson(
                          `${endpoint}/verify`,
                          eventProposalProofVerifySchema.parse({
                            token: identity.verificationToken,
                            speakerManagementToken,
                            speakerProposalId,
                            domain,
                          }),
                          eventProposalProofVerifyResponseSchema,
                        );
                        if (result.status !== "ready" || !result.affiliation)
                          throw new Error("Confirm your organization details again.");
                        return result.affiliation;
                      }}
                      prepare={async (input) => {
                        const { phase: _phase, email: _email, emailId: _emailId, ...affiliation } = input;
                        const result = await postJson(
                          `${endpoint}/verify`,
                          eventProposalProofVerifySchema.parse({
                            token: identity.verificationToken,
                            speakerManagementToken,
                            speakerProposalId,
                            affiliation,
                          }),
                          eventProposalProofVerifyResponseSchema,
                        );
                        if (result.status !== "ready" || !result.affiliation)
                          throw new Error("Confirm your organization details again.");
                        return result.affiliation;
                      }}
                    />
                  )}
                  {representationActions}
                </FormSection>
              )}
              {identity.kind === "individual" && (
                <IndependentCapacityDisclosure
                  draft={disclosure}
                  onChange={setDisclosure}
                  onUseWorkEmail={() => {
                    setDisclosure({});
                    identity.setKind("organization");
                    identity.useDifferentEmail();
                    setSent(false);
                    setChanging(false);
                  }}
                />
              )}
              {Object.keys(identity.selection?.missingDetails ?? {}).length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    identity.clearUnsaved();
                    setOrganizationDraftRevision((revision) => revision + 1);
                  }}
                >
                  Clear unsaved changes
                </Button>
              )}
            </>
          )}
        </>
      )}
      {identity.signInEmail && (
        <Alert tone="warn" title={ADDRESS_IN_USE_COPY.title}>
          <p>{ADDRESS_IN_USE_COPY.body(identity.signInEmail)}</p>
          <ButtonLink href="/portal/" variant="secondary">
            {ADDRESS_IN_USE_COPY.action}
          </ButtonLink>
        </Alert>
      )}
      {identity.error && (
        <div ref={errorBanner}>
          <Alert tone="danger">{identity.error}</Alert>
        </div>
      )}
      {identity.authenticated && (
        <IdentityCreateDialog
          open={adding}
          onClose={() => closeAdding()}
          onCreated={async (identityId) => {
            const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
            const summary = session.actingIdentities.find((item) => item.id === identityId);
            if (!summary?.organizationId)
              throw new Error("Your new identity is not available yet. Close and reopen this step to refresh it.");
            const result = await getJson(
              `/api/v1/users/current/identities?organizationId=${encodeURIComponent(summary.organizationId)}&active=true&limit=1`,
              identitiesListResponseSchema,
            );
            const created = result.identities.find((item) => item.id === identityId);
            if (!created)
              throw new Error("Your new identity is not available yet. Close and reopen this step to refresh it.");
            if (identity.kind !== "organization") identity.setKind("organization");
            identity.choose(created);
            setChanging(false);
          }}
        />
      )}
    </div>
  );
}
