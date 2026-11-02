import { personNamePatchSchema } from "../../shared/schemas/api-common";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import type { MemberJoinApplicantKind } from "../../shared/schemas/member-join";
import type { ActingIdentity } from "../../shared/schemas/identity";
import type { IndependentCapacityDisclosure } from "../../shared/schemas/independent-capacity";
import {
  eventProposalProofPersonSchema,
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
  eventProposalProofPersonPatchSchema,
  eventProposalIdentityJobTitlePatchSchema,
  eventProposalProofIdentityPatchSchema,
  eventProposalProofIdentityPatchResponseSchema,
  eventProposalProofPersonPatchResponseSchema,
} from "../../shared/schemas/event-proposal-proof";
import type { proposalCreateSchema } from "../../shared/schemas/proposal-management";
import type { ProposalEntryContext } from "../../shared/schemas/proposal-entry";
import type { ConsentItem } from "../../shared/schemas/registration";
import type { identityAffiliationPreviewResponseSchema } from "../../shared/schemas/identity-affiliation";
import { userAuthSessionResponseSchema } from "../../shared/schemas/user-auth";
import { userDetailResponseSchema } from "../../shared/schemas/user-management";
import { ApiClientError, getJson, patchJson, postJson } from "../shared/api-client";

export type VerifiedProposalEntry = {
  token: string;
  result: Extract<z.infer<typeof eventProposalProofVerifyResponseSchema>, { status: "ready" }>;
};

export type ParticipationPerson = z.infer<typeof eventProposalProofPersonSchema>;
type Proposer = z.infer<typeof proposalCreateSchema>["proposer"];
type NameDrafts = Pick<Proposer, "firstName" | "lastName">;
type AffiliationDrafts = Pick<Proposer, "organizationName" | "jobTitle" | "organizationContextToken">;
export interface ProposalEntrySelection {
  authenticated: boolean;
  continuationToken?: string;
  entryContext?: ProposalEntryContext;
  unaffiliatedAttestation: boolean;
  /** The completed independence disclosure; present exactly when taking part as an individual. */
  independentCapacity?: IndependentCapacityDisclosure;
  actingIdentityId: ActingIdentity["id"] | null | undefined;
  person: ParticipationPerson;
  missingDetails: NameDrafts & AffiliationDrafts;
  prepareAffiliation?: () => Promise<AffiliationDrafts>;
  validateAffiliation?: () => boolean;
}

/** Explicit submission prepares the same shared organization controller in every embedding. */
export async function prepareProposalEntry(entry: ProposalEntrySelection): Promise<ProposalEntrySelection> {
  return entry.prepareAffiliation
    ? { ...entry, missingDetails: { ...entry.missingDetails, ...(await entry.prepareAffiliation()) } }
    : entry;
}

/**
 * The new-affiliation details a submission sends. On behalf of an organization
 * with no representation chosen, the job title is the one entered here or, for
 * an affiliation the person already holds, the one it carries.
 */
export function newAffiliationDetails(entry: ProposalEntrySelection): ProposalEntrySelection["missingDetails"] {
  if (entry.unaffiliatedAttestation || entry.actingIdentityId !== undefined || entry.missingDetails.jobTitle)
    return entry.missingDetails;
  return entry.person.jobTitle ? { ...entry.missingDetails, jobTitle: entry.person.jobTitle } : entry.missingDetails;
}

/** Resolve an owned person only after the terms step has activated this entry. */
export function useProposalEntryIdentity(
  enabled: boolean,
  endpoint: string,
  speakerManagementToken?: string,
  expectedSpeakerUserId?: string | null,
  saveNames?: (names: z.infer<typeof personNamePatchSchema>) => Promise<ParticipationPerson>,
  startWithEmailProof = false,
  speakerProposalId?: string,
  initialProof?: VerifiedProposalEntry,
  /** The address a speaker was invited at; their invitation link may already have proved it. */
  invitedEmail = "",
) {
  // Email-first: a person takes part on behalf of their organization unless they explicitly choose otherwise.
  const [kind, setKindState] = useState<MemberJoinApplicantKind>("organization");
  const [person, setPerson] = useState<ParticipationPerson | null>(null);
  const [knownPerson, setKnownPerson] = useState<ParticipationPerson | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [storedPerson, setStoredPerson] = useState(false);
  const [continuationToken, setContinuationToken] = useState<string>();
  const [proofOwnerToken, setProofOwnerToken] = useState<string>();
  const [entryContext, setEntryContext] = useState<ProposalEntryContext>();
  const [selected, setSelected] = useState<ActingIdentity | null | undefined>();
  const [affiliation, setAffiliation] = useState<z.infer<typeof identityAffiliationPreviewResponseSchema>>();
  const [verificationToken, setVerificationToken] = useState<string>();
  /** Details for a new affiliation; they belong to the representation and go with it. */
  const [missingDetails, setMissingDetails] = useState<AffiliationDrafts>({});
  /**
   * Names the person typed because none are saved yet. They belong to the
   * person, not to a representation, so choosing or adding a representation
   * keeps them; only another person's address or "Clear unsaved changes"
   * discards them.
   */
  const [nameDrafts, setNameDrafts] = useState<NameDrafts>({});
  const proofOwner = useRef<string>();
  proofOwner.current = proofOwnerToken;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  /** A proved address that signs in to another account; nothing was linked. */
  const [signInEmail, setSignInEmail] = useState<string>();
  const [email, setEmailState] = useState(invitedEmail);
  /** The terms a confirmed email already recorded: the flow does not ask for them again. */
  const [recordedConsents, setRecordedConsents] = useState<ConsentItem[]>();
  const initialized = useRef(false);
  const proofScope = [endpoint, speakerManagementToken, speakerProposalId, expectedSpeakerUserId].join("|");
  const proofAttempt = useRef<{ scope: string; token: string; state: "pending" | "verified" } | null>(null);
  const generation = useRef(0);

  function clearResolution(): void {
    generation.current += 1;
    setSelected(undefined);
    setMissingDetails({});
    setContinuationToken(undefined);
    setAffiliation(undefined);
    setVerificationToken(undefined);
    setLoading(false);
  }
  function setKind(value: MemberJoinApplicantKind): void {
    clearResolution();
    setKindState(value);
    setSignInEmail(undefined);
    // A signed-in individual takes part with the account itself; no organization is selected.
    if (authenticated && knownPerson && value === "individual") {
      setSelected(null);
      setPerson({ ...knownPerson, organizationName: null, jobTitle: null });
    } else setPerson(knownPerson);
  }
  function setEmail(value: string): void {
    clearResolution();
    setEmailState(value);
    setPerson(null);
    if (!proofOwnerToken) {
      setKnownPerson(null);
      setStoredPerson(false);
      setNameDrafts({});
    }
    setAuthenticated(false);
  }
  function useDifferentEmail(): void {
    setProofOwnerToken(storedPerson && !speakerManagementToken && !speakerProposalId ? continuationToken : undefined);
    clearResolution();
    setEmailState("");
    setPerson(null);
    setAuthenticated(false);
  }
  function choose(identity: ActingIdentity | null): void {
    generation.current += 1;
    setSelected(identity ?? (kind === "individual" ? null : undefined));
    setMissingDetails({});
    if (knownPerson)
      setPerson({
        ...knownPerson,
        email: identity?.email ?? knownPerson.email,
        organizationName: identity?.organizationName ?? (kind === "organization" ? knownPerson.organizationName : null),
        jobTitle: identity?.jobTitle ?? (kind === "organization" ? knownPerson.jobTitle : null),
        bio: identity?.biography ?? knownPerson.bio,
        links: identity?.links ?? knownPerson.links,
      });
  }
  function complete(field: keyof ProposalEntrySelection["missingDetails"], value: string): void {
    if (field === "firstName" || field === "lastName") setNameDrafts((current) => ({ ...current, [field]: value }));
    else {
      setMissingDetails((current) => {
        const next = { ...current };
        if (value === "") delete next[field];
        else next[field] = value;
        return next;
      });
      setPerson((current) => (current ? { ...current, [field]: value } : null));
    }
  }
  function clearUnsaved(): void {
    setNameDrafts({});
    choose(selected ?? null);
  }
  async function saveRepresentation(role: z.infer<typeof eventProposalIdentityJobTitlePatchSchema>): Promise<void> {
    if (!selected) throw new Error("Choose an existing representation before updating its role.");
    const currentGeneration = generation.current;
    const result = await patchJson(
      `${endpoint}/identities/${encodeURIComponent(selected.id)}`,
      eventProposalProofIdentityPatchSchema.parse({
        ...role,
        continuationToken,
        speakerManagementToken,
        speakerProposalId,
      }),
      eventProposalProofIdentityPatchResponseSchema,
    );
    if (currentGeneration !== generation.current || result.identityId !== selected.id) return;
    setSelected((current) => (current ? { ...current, jobTitle: result.jobTitle } : current));
    setPerson((current) => (current ? { ...current, jobTitle: result.jobTitle } : current));
  }
  async function savePersonalDetails(names: z.infer<typeof personNamePatchSchema>): Promise<void> {
    const currentGeneration = generation.current;
    const savedPerson = saveNames
      ? await saveNames(names)
      : (
          await patchJson(
            `${endpoint}/person`,
            eventProposalProofPersonPatchSchema.parse({
              ...names,
              continuationToken: continuationToken ?? proofOwnerToken,
            }),
            eventProposalProofPersonPatchResponseSchema,
          )
        ).person;
    if (currentGeneration !== generation.current) return;
    const savedNames = { firstName: savedPerson.firstName, lastName: savedPerson.lastName };
    setKnownPerson((current) => (current ? { ...current, ...savedNames } : current));
    setPerson((current) => (current ? { ...current, ...savedNames } : current));
  }
  async function verify(token: string): Promise<void> {
    if (proofAttempt.current?.scope === proofScope && proofAttempt.current.token === token) return;
    const attempt = { scope: proofScope, token, state: "pending" as const };
    proofAttempt.current = attempt;
    const currentGeneration = generation.current;
    setLoading(true);
    setError(undefined);
    setSignInEmail(undefined);
    try {
      const result =
        initialProof?.token === token
          ? initialProof.result
          : await postJson(
              `${endpoint}/verify`,
              eventProposalProofVerifySchema.parse({ token, speakerManagementToken, speakerProposalId }),
              eventProposalProofVerifyResponseSchema,
            );
      if (currentGeneration !== generation.current) return;
      if (result.status === "sign_in_required") {
        proofAttempt.current = null;
        setSignInEmail(result.email);
        return;
      }
      if (result.status !== "ready") {
        proofAttempt.current = null;
        setError("We need to review this email address before you can continue.");
        return;
      }
      if (speakerProposalId && result.speakerProposalId !== speakerProposalId) {
        proofAttempt.current = null;
        setError("This verification does not belong to this speaker record.");
        return;
      }
      if (result.speakerManageUrl && !speakerManagementToken && !speakerProposalId) {
        const destination = new URL(result.speakerManageUrl);
        if (result.speakerProposalId) {
          const route = new URL(destination.hash.slice(1), destination.origin);
          route.searchParams.set("verify", token);
          destination.hash = `${route.pathname}${route.search}`;
        } else destination.hash = `verify=${encodeURIComponent(token)}`;
        location.assign(destination.href);
        return;
      }
      const resolved = eventProposalProofPersonSchema.parse(
        result.person ?? {
          email: result.email,
          firstName: null,
          lastName: null,
          organizationName: result.organization?.name ?? null,
          jobTitle: null,
          bio: null,
          links: [],
        },
      );
      if (result.organization) {
        resolved.organizationName = result.organization.name;
        resolved.jobTitle = result.organization.jobTitle;
      }
      proofAttempt.current = { scope: proofScope, token, state: "verified" };
      // A confirmed address answers whatever went wrong before it.
      setError(undefined);
      setKindState(result.applicantKind);
      setEmailState(result.email);
      setPerson(resolved);
      setKnownPerson(resolved);
      setStoredPerson(Boolean(result.person));
      setAuthenticated(false);
      setContinuationToken(result.continuationToken);
      setProofOwnerToken(undefined);
      setEntryContext(result.entryContext);
      setRecordedConsents(result.consents);
      setSelected(result.applicantKind === "individual" ? null : undefined);
      setAffiliation(result.affiliation);
      setVerificationToken(token);
      if (!speakerManagementToken && !speakerProposalId)
        history.replaceState({}, "", `${location.pathname}${location.search}`);
    } catch (caught) {
      if (proofAttempt.current === attempt) proofAttempt.current = null;
      if (currentGeneration === generation.current)
        setError(caught instanceof Error ? caught.message : "We could not verify this email. Please try again.");
    } finally {
      if (currentGeneration === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let initializingSession = false;
    const consumeProof = (): boolean => {
      const token =
        new URLSearchParams(location.hash.slice(1)).get("verify") ??
        new URL(location.hash.slice(1), location.origin).searchParams.get("verify") ??
        initialProof?.token;
      if (!token || (startWithEmailProof && token === initialProof?.token)) return false;
      if (proofAttempt.current?.scope === proofScope && proofAttempt.current.token === token) return true;
      clearResolution();
      setPerson(null);
      setKnownPerson(null);
      setStoredPerson(false);
      setAuthenticated(false);
      // A new representation confirmed for the same person keeps their typed names; anyone else starts afresh.
      if (!proofOwner.current) setNameDrafts({});
      void verify(token);
      return true;
    };
    window.addEventListener("hashchange", consumeProof);
    const hasProof = consumeProof();
    if (!initialized.current) {
      initialized.current = true;
      if (!hasProof) {
        const currentGeneration = generation.current;
        initializingSession = true;
        setLoading(true);
        void (async () => {
          try {
            const session = await getJson("/api/v1/auth/session", userAuthSessionResponseSchema);
            if (!active || currentGeneration !== generation.current) return;
            if ((speakerManagementToken || speakerProposalId) && session.identity.id !== expectedSpeakerUserId) return;
            const detail = await getJson(
              `/api/v1/users/${encodeURIComponent(session.identity.id)}`,
              userDetailResponseSchema,
            );
            if (!active || currentGeneration !== generation.current) return;
            if (detail.user.id !== session.identity.id) throw new Error("We could not confirm your saved profile.");
            const resolved = eventProposalProofPersonSchema.parse({
              email: session.identity.email,
              firstName: detail.user.first_name,
              lastName: detail.user.last_name,
              organizationName: null,
              jobTitle: null,
              bio: null,
              links: [],
            });
            setAuthenticated(!startWithEmailProof);
            setStoredPerson(true);
            setPerson(resolved);
            setKnownPerson(resolved);
          } catch (caught) {
            if (
              active &&
              currentGeneration === generation.current &&
              !(caught instanceof ApiClientError && caught.status === 401)
            )
              setError("We could not load your saved profile. You can verify your email to continue.");
          } finally {
            initializingSession = false;
            if (active && currentGeneration === generation.current) setLoading(false);
          }
        })();
      }
    }
    return () => {
      active = false;
      if (proofAttempt.current?.scope === proofScope && proofAttempt.current.state === "pending")
        proofAttempt.current = null;
      if (initializingSession) initialized.current = false;
      generation.current += 1;
      window.removeEventListener("hashchange", consumeProof);
      setLoading(false);
    };
  }, [enabled, endpoint, speakerManagementToken, speakerProposalId, expectedSpeakerUserId, startWithEmailProof]);

  // The person as shown and sent: saved names first, otherwise the names typed here.
  const draftedPerson = useMemo<ParticipationPerson | null>(
    () =>
      person && {
        ...person,
        firstName: person.firstName ?? nameDrafts.firstName ?? null,
        lastName: person.lastName ?? nameDrafts.lastName ?? null,
      },
    [person, nameDrafts],
  );
  const draftedDetails = useMemo<ProposalEntrySelection["missingDetails"]>(
    () => ({
      ...(person && !person.firstName && nameDrafts.firstName !== undefined ? { firstName: nameDrafts.firstName } : {}),
      ...(person && !person.lastName && nameDrafts.lastName !== undefined ? { lastName: nameDrafts.lastName } : {}),
      ...missingDetails,
    }),
    [person, nameDrafts, missingDetails],
  );
  const ready = Boolean(
    person &&
    kind &&
    (continuationToken ||
      (authenticated && (kind === "organization" ? Boolean(selected?.organizationId) : selected === null))),
  );
  const selection = useMemo<ProposalEntrySelection | null>(
    () =>
      ready && person
        ? {
            authenticated,
            continuationToken,
            entryContext,
            unaffiliatedAttestation: kind === "individual",
            actingIdentityId: selected?.id ?? (selected === null ? null : undefined),
            person: draftedPerson ?? person,
            missingDetails: draftedDetails,
          }
        : null,
    [ready, person, draftedPerson, authenticated, continuationToken, entryContext, kind, selected, draftedDetails],
  );
  return {
    kind,
    setKind,
    signInEmail,
    person: draftedPerson,
    knownPerson,
    authenticated,
    storedPerson,
    proofOwnerToken,
    savePersonalDetails,
    saveRepresentation,
    clearUnsaved,
    continuationToken,
    entryContext,
    recordedConsents,
    selected,
    affiliation,
    verificationToken,
    choose,
    email,
    setEmail,
    useDifferentEmail,
    complete,
    // Until the first activation has asked who is signed in, the step is loading: a form shown before
    // the answer would be replaced by the one it decides, losing whatever was typed into it.
    loading: loading || (enabled && !initialized.current),
    error,
    setError,
    verify,
    selection,
  };
}
