import type { ComponentChildren } from "preact";
import type { z } from "zod";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { RequiredTerm } from "../../shared/schemas/forms";
import type { ProposalEntryContext } from "../../shared/schemas/proposal-entry";
import {
  eventProposalProofStartSchema,
  eventProposalPersonNamePatchSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofIdentitiesSchema,
} from "../../shared/schemas/event-proposal-proof";
import type { CollectionLoader } from "../hooks/useServerCollection";
import { useContractForm } from "../hooks/useContractForm";
import { actingIdentityCatalog, actingIdentityLabel } from "../shared/acting-identity-catalog";
import { postJson, requestJson } from "../shared/api-client";
import { Alert } from "../ui/Alert";
import { Button, ButtonLink } from "../ui/Button";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { FormSection } from "../ui/FormSection";
import { ProposalCapacityChoice } from "./ProposalCapacityChoice";
import { ParticipationRepresentation } from "./ParticipationRepresentation";
import { ParticipationPersonalDetails } from "./ParticipationPersonalDetails";
import { ParticipationIdentitySummary } from "./ParticipationIdentitySummary";
import { ServerSearchSelect } from "./ServerSearchSelect";
import {
  useProposalEntryIdentity,
  type ProposalEntrySelection,
  type ParticipationPerson,
} from "./useProposalEntryIdentity";

export function EventProposalIdentityStep({
  enabled,
  eventSlug,
  consents,
  onChange,
  speakerManagementToken,
  speakerProposalId,
  expectedSpeakerUserId,
  entryContext,
  onSavePersonalDetails,
  personalDetails,
  startWithEmailProof,
}: {
  enabled: boolean;
  personalDetails?: ComponentChildren;
  startWithEmailProof?: boolean;
  eventSlug: string;
  consents: () => { termKey: RequiredTerm["termKey"]; version: RequiredTerm["version"] }[];
  onChange: (selection: ProposalEntrySelection | null) => void;
  speakerManagementToken?: string;
  speakerProposalId?: string;
  expectedSpeakerUserId?: string | null;
  entryContext?: ProposalEntryContext;
  onSavePersonalDetails?: (names: z.infer<typeof eventProposalPersonNamePatchSchema>) => Promise<ParticipationPerson>;
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
  );
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [changing, setChanging] = useState(false);
  const proofForm = useContractForm(eventProposalProofStartSchema, {
    email: identity.email,
    unaffiliatedAttestation: identity.kind === "individual",
    consents: consents(),
    speakerManagementToken: identity.proofOwnerToken ? undefined : speakerManagementToken,
    continuationToken: identity.proofOwnerToken,
    speakerProposalId,
    entryContext:
      identity.proofOwnerToken || speakerManagementToken || speakerProposalId
        ? undefined
        : (identity.entryContext ?? entryContext),
  });
  useEffect(() => {
    onChange(identity.selection);
  }, [identity.selection, onChange]);
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
  async function sendProof(): Promise<void> {
    const checked = proofForm.submit();
    if (!checked.data) {
      identity.setError(checked.message);
      return;
    }
    setSending(true);
    identity.setError(undefined);
    try {
      await postJson(endpoint, checked.data, eventProposalProofStartResponseSchema);
      setSent(true);
    } catch (error) {
      identity.setError(proofForm.refuse(error));
    } finally {
      setSending(false);
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
  const needsOrganization =
    person &&
    identity.kind === "organization" &&
    !identity.knownPerson?.organizationName &&
    !identity.selected?.organizationName;
  const needsJobTitle =
    person &&
    identity.kind === "organization" &&
    (!identity.storedPerson || needsOrganization) &&
    !identity.knownPerson?.jobTitle &&
    !identity.selected?.jobTitle;
  const catalogueEndpoint = identity.continuationToken ? `${endpoint}/identities` : "/api/v1/users/current/identities";
  const selector = (
    <Field
      label="Your organization representation"
      help="Choose an identity you already own, or verify an email to set up another organization affiliation."
    >
      {(control) => (
        <ServerSearchSelect
          {...control}
          catalog={actingIdentityCatalog(catalogueEndpoint, actingIdentityLabel, {
            active: "true",
            organizationOnly: "true",
          })}
          load={load}
          allowEmpty={false}
          searchLabel="Your organization identities"
          value={identity.selected?.id ?? null}
          selectedLabel={identity.selected ? actingIdentityLabel(identity.selected) : undefined}
          placeholder="Choose an existing representation"
          onChange={(value) => {
            identity.choose(value);
            if (value) setChanging(false);
          }}
        />
      )}
    </Field>
  );
  const representationActions = identity.storedPerson && (
    <div class="pk-cluster">
      <Button type="button" variant="secondary" onClick={() => setChanging(!changing)}>
        Choose another representation
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          identity.useDifferentEmail();
          setSent(false);
          setChanging(false);
        }}
      >
        Add representation
      </Button>
    </div>
  );
  return (
    <div class="pk-stack pk-stack--loose" {...proofForm.handlers}>
      {identity.loading ? (
        <p role="status">Loading your details…</p>
      ) : (
        <>
          {personalDetails}
          {(!resolved || changing) && (
            <>
              <ProposalCapacityChoice
                question={
                  speakerManagementToken || speakerProposalId
                    ? "In what capacity are you presenting?"
                    : "In what capacity are you submitting this proposal?"
                }
                value={identity.kind}
                onChange={(kind) => {
                  identity.setKind(kind);
                  setSent(false);
                  proofForm.reset();
                }}
              />
              {identity.kind === "organization" &&
                (identity.authenticated || (identity.continuationToken && identity.storedPerson)) &&
                selector}
              {identity.authenticated && identity.kind === "organization" && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    identity.useDifferentEmail();
                    setSent(false);
                  }}
                >
                  Add representation
                </Button>
              )}
              {identity.kind && !identity.authenticated && !identity.continuationToken && (
                <>
                  {sent ? (
                    <Alert tone="info">
                      Check your email for the verification link to verify your email address and continue.
                    </Alert>
                  ) : (
                    <Field
                      label={identity.kind === "organization" ? "Work email address" : "Email address"}
                      help={
                        identity.kind === "organization"
                          ? "Your address at the organization, not a personal address such as gmail.com."
                          : undefined
                      }
                      {...proofForm.of("email")}
                      errorSlot="email"
                    >
                      {(control) => (
                        <TextInput
                          {...control}
                          type="email"
                          name="email"
                          value={identity.email}
                          autoComplete="email"
                          onInput={(event) => {
                            identity.setEmail(event.currentTarget.value);
                            setSent(false);
                          }}
                        />
                      )}
                    </Field>
                  )}
                  <div class="pk-cluster">
                    <Button type="button" loading={sending} onClick={() => void sendProof()}>
                      {sent
                        ? "Send another verification email"
                        : identity.kind === "organization"
                          ? "Verify work email"
                          : "Verify email"}
                    </Button>
                    {sent && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          identity.setEmail("");
                          setSent(false);
                        }}
                      >
                        Use a different email
                      </Button>
                    )}
                  </div>
                </>
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
                      ? "These new details are not saved yet. They will be saved when you submit your proposal or save your speaker profile."
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
                  person={{ ...summaryPerson, email: identity.selected.email }}
                  save={identity.saveRepresentation}
                  savedMessage="Your current representation is updated."
                >
                  {representationActions}
                </ParticipationRepresentation>
              ) : (
                <FormSection
                  title="Your representation for this proposal"
                  description={
                    identity.storedPerson && identity.kind === "organization" && !needsOrganization
                      ? "No existing representation is selected. Choose one to reuse its saved details, or add a representation with a verified organization email."
                      : needsOrganization || needsJobTitle
                        ? "Any details entered below are unsaved until you submit your proposal or save your speaker profile."
                        : undefined
                  }
                >
                  {knownPerson && (
                    <ParticipationIdentitySummary
                      person={knownPerson}
                      applicantKind={identity.kind}
                      knownOnly
                      scope="representation"
                    />
                  )}
                  {needsOrganization && (
                    <Field label="Organization name" errorSlot="proposer.organizationName">
                      {(control) => (
                        <TextInput
                          {...control}
                          name="organizationName"
                          required
                          value={person.organizationName ?? ""}
                          onInput={(event) => identity.complete("organizationName", event.currentTarget.value)}
                        />
                      )}
                    </Field>
                  )}
                  {needsJobTitle && (
                    <Field label="Job title (optional)" errorSlot="proposer.jobTitle">
                      {(control) => (
                        <TextInput
                          {...control}
                          name="jobTitle"
                          value={person.jobTitle ?? ""}
                          onInput={(event) => identity.complete("jobTitle", event.currentTarget.value)}
                        />
                      )}
                    </Field>
                  )}
                  {representationActions}
                </FormSection>
              )}
              {Object.keys(identity.selection?.missingDetails ?? {}).length > 0 && (
                <Button type="button" variant="secondary" onClick={identity.clearUnsaved}>
                  Clear unsaved changes
                </Button>
              )}
            </>
          )}
        </>
      )}
      {identity.signInEmail && (
        <Alert tone="warn" title="This address belongs to another account">
          <p>
            Sign in with {identity.signInEmail} and return to this page to continue. Nothing was added to your current
            account. If both accounts are yours, the secretariat can merge them.
          </p>
          <ButtonLink href="/portal/" variant="secondary">
            Sign in
          </ButtonLink>
        </Alert>
      )}
      {identity.error && <Alert tone="danger">{identity.error}</Alert>}
    </div>
  );
}
