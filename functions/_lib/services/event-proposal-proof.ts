import type { z } from "zod";
import type {
  eventProposalProofStartSchema,
  eventProposalProofVerifySchema,
} from "../../../assets/shared/schemas/event-proposal-proof";
import { identityAffiliationPrepareSchema } from "../../../assets/shared/schemas/identity-affiliation";
import { prepareVerifiedAffiliationRead } from "./identities/verified-affiliation-read";
import { verifiedAffiliationPreview } from "./identities/verified-affiliation-preview";
import { planVerifiedAffiliation } from "./identities/verified-affiliation-plan";
import { signEventAffiliationContext } from "./identities/event-affiliation-context";
import { nowIso } from "../utils/time";
import type { IdentitiesListQuery } from "../../../assets/shared/schemas/identity";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { readAffiliation } from "./identities/affiliation-projection";
import { assertProposalProofCurrent } from "./event-proposal-proof-current";
export { assertProposalProofCurrent } from "./event-proposal-proof-current";
import type { DatabaseLike } from "../types";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { AppError } from "../errors";
import { randomToken } from "../utils/crypto";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import { requireDeliverableTemplate } from "../email/templates";
import { emailPlainText } from "../email/plain-text";
import { getRequiredTerms, type EventRecord } from "./events";
import { prepareActiveTermsSnapshotGuard, validateRequiredConsents } from "./consent";
import { speakerManagePageUrl, speakerParticipationPageUrl } from "./frontend-links";
import {
  createEventProposalProofContext,
  eventProposalSpeakerAuthority,
  prepareEventProposalProofContext,
  resumeEventProposalSpeakerProof,
} from "./event-proposal-proof-context";
import { listUserIdentities } from "./identities/read-model";
import { isInvitationMailbox } from "./proposal-speaker-account-authority";
import {
  prepareInvitedSpeakerAccountClaim,
  isProposalProofAddressOwnedElsewhere,
  resolveProposalProofPerson,
} from "./event-proposal-proof-person";
import {
  issueEventProposalContinuation,
  issueEventProposalProofToken,
  proposalTermsDigest,
  queuedEventProposalProofToken,
  verifyEventProposalCapability,
  type EventProposalProofPayload,
} from "./event-proposal-proof-capabilities";

export async function startEventProposalProof(
  db: DatabaseLike,
  input: {
    event: EventRecord;
    body: z.infer<typeof eventProposalProofStartSchema>;
    appBaseUrl: string;
    ttlSeconds: number;
    signingSecret: string;
    actor?: AuthenticatedIdentity;
  },
) {
  const audience = "speaker";
  const terms = await getRequiredTerms(db, input.event.id, audience);
  // The terms can stop someone from taking part, so they are accepted before any mailbox is emailed.
  await validateRequiredConsents(terms, input.body.consents);
  const speakerAuthority = eventProposalSpeakerAuthority({ ...input.body, actor: input.actor });
  const context = await createEventProposalProofContext(db, {
    eventId: input.event.id,
    signingSecret: input.signingSecret,
    actor: input.actor,
    speakerManagementToken: input.body.speakerManagementToken,
    speakerProposalId: input.body.speakerProposalId,
  });
  // A speaker link reaches only the mailbox it was sent to. When this is that address, opening the
  // link proved it: the speaker continues at once instead of confirming it twice.
  const invitationMailbox =
    !context.sessionId &&
    (await isInvitationMailbox(db, { speakerId: context.speakerId, userId: context.userId, email: input.body.email }));
  const payload: EventProposalProofPayload = {
    eventId: input.event.id,
    email: input.body.email,
    applicantKind: input.body.unaffiliatedAttestation ? "individual" : "organization",
    capabilityId: randomToken(18),
    termsDigest: await proposalTermsDigest(terms),
    consents: input.body.consents,
    context,
    ...(invitationMailbox ? { basis: "invitation" as const } : {}),
  };
  const proofTtl = Math.min(input.ttlSeconds, context.expiresAt - Math.floor(Date.now() / 1000));
  const verificationToken = encodeURIComponent(queuedEventProposalProofToken(payload, proofTtl));
  const verificationUrl = input.body.speakerProposalId
    ? `${speakerParticipationPageUrl(input.appBaseUrl, input.event, input.body.speakerProposalId)}?verify=${verificationToken}`
    : `${speakerManagePageUrl(input.appBaseUrl, input.event, "")}#verify=${verificationToken}`;
  if (!invitationMailbox) await requireDeliverableTemplate(db, "event_proposal_verify");
  const email = invitationMailbox
    ? null
    : prepareQueueEmailStatement(db, {
        eventId: input.event.id,
        templateKey: "event_proposal_verify",
        recipientEmail: payload.email,
        recipientUserId: null,
        messageType: "transactional",
        subject: `Verify your email for ${input.event.name}`,
        capabilityLinkValues: [verificationUrl],
        data: { verificationUrl, eventName: emailPlainText(input.event.name) },
      });
  try {
    await db.batch([
      ...(await prepareEventProposalProofContext(db, {
        payload,
        signingSecret: input.signingSecret,
        actor: input.actor,
        speakerAuthority,
        speakerId: context.speakerId,
      })),
      prepareActiveTermsSnapshotGuard(db, input.event.id, terms, audience),
      ...(email ? [email.statement] : []),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "PROPOSAL_TERMS_CHANGED",
        "The event terms changed. Review them before confirming your email.",
        { consents: "Review the current event terms." },
      );
    throw error;
  }
  if (!email)
    return {
      status: "verified" as const,
      token: await issueEventProposalProofToken(input.signingSecret, payload, proofTtl),
      outboxId: null,
    };
  return { status: "verification_sent" as const, outboxId: email.id };
}

const ORGANIZATION_DOMAIN_REVIEW_CODES = new Set([
  "ORGANIZATION_DOMAIN_IN_USE",
  "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
]);

export async function verifyEventProposalProof(
  db: DatabaseLike,
  input: {
    eventId: string;
    token: string;
    signingSecret: string;
    actor?: AuthenticatedIdentity;
    speakerManagementToken?: string;
    speakerProposalId?: string;
    event: EventRecord;
    appBaseUrl: string;
  } & Pick<z.infer<typeof eventProposalProofVerifySchema>, "domain" | "affiliation">,
) {
  const payload = await verifyEventProposalCapability(input.signingSecret, input.token, input.eventId, false);
  await assertProposalProofCurrent(db, payload);
  const speakerAuthority = eventProposalSpeakerAuthority(input);
  const speakerManagementToken =
    !payload.context.sessionId && !input.speakerProposalId
      ? await resumeEventProposalSpeakerProof(db, { payload, signingSecret: input.signingSecret })
      : undefined;
  if (!speakerManagementToken)
    await prepareEventProposalProofContext(db, {
      payload,
      signingSecret: input.signingSecret,
      actor: input.actor,
      speakerAuthority,
      speakerId: payload.context.speakerId,
    });
  let resolved = await resolveProposalProofPerson(db, payload.email, payload.context.userId);
  let speakerClaimSessionId: string | undefined;
  if (!resolved && !payload.context.sessionId && input.actor) {
    const target = await resolveProposalProofPerson(db, payload.email);
    if (target?.user?.id === input.actor.userId) {
      await prepareInvitedSpeakerAccountClaim(
        db,
        { ...payload, userId: target.user.id, speakerClaimSessionId: input.actor.sessionId },
        input.actor,
      );
      resolved = target;
      speakerClaimSessionId = input.actor.sessionId;
    }
  }
  if (!resolved)
    return (await isProposalProofAddressOwnedElsewhere(db, payload.email, payload.context.userId))
      ? { status: "sign_in_required" as const, email: payload.email }
      : {
          status: "support_required" as const,
          email: payload.email,
          applicantKind: payload.applicantKind,
          reason: "address_review" as const,
        };
  const { expiresAt, ...receipt } = payload;
  // The person's biography and links are those of the identity they are shown with.
  const spokenAs = resolved.user ? await readAffiliation(db, resolved.user.id) : null;
  const affiliationRead =
    payload.applicantKind === "organization"
      ? prepareVerifiedAffiliationRead(
          db,
          resolved.user?.id ?? "",
          {
            email: payload.email,
            emailId: null,
            domain: input.affiliation?.domain ?? input.domain,
            organizationName: input.affiliation?.organizationName,
          },
          { verifiedAt: nowIso() },
        )
      : null;
  let observed: ReturnType<NonNullable<typeof affiliationRead>["decode"]> | undefined;
  let affiliation: ReturnType<typeof verifiedAffiliationPreview> | undefined;
  try {
    observed = affiliationRead?.decode(await db.batch(affiliationRead.statements));
    // A new mailbox has no recorded address; that is not the person's primary one, whose identities carry no address id.
    affiliation = observed
      ? verifiedAffiliationPreview(observed.basis, observed.address, {
          unrecordedAddress:
            observed.address.id === null && Boolean(resolved.user) && resolved.user?.normalized_email !== payload.email,
        })
      : undefined;
  } catch (error) {
    // Unresolvable organization evidence needs support; nothing was linked or created.
    if (!(error instanceof AppError) || !ORGANIZATION_DOMAIN_REVIEW_CODES.has(error.code)) throw error;
    return {
      status: "support_required" as const,
      email: payload.email,
      applicantKind: payload.applicantKind,
      reason: "organization_domain_review" as const,
    };
  }
  if (input.affiliation && observed && affiliation) {
    const selection = identityAffiliationPrepareSchema.parse({
      ...input.affiliation,
      phase: "prepare",
      email: payload.email,
      emailId: observed.address.id,
    });
    if (selection.organizationId && !affiliation.organizations.some((item) => item.id === selection.organizationId))
      throw new AppError(
        422,
        "IDENTITY_DOMAIN_MISMATCH",
        "Choose an organization confirmed by your verified work domain.",
      );
    await planVerifiedAffiliation(
      db,
      { userId: resolved.user?.id ?? crypto.randomUUID(), proofEvidence: { sql: "SELECT 1", bindings: [] } },
      selection,
      observed.basis,
      nowIso(),
    );
    affiliation.contextToken = await signEventAffiliationContext(
      input.signingSecret,
      {
        eventId: input.eventId,
        input: selection,
        basis: observed.basis,
      },
      "proposal-affiliation",
    );
  }
  const organization = affiliation?.organization;
  const represented = affiliation?.organizations.find((item) => item.id === organization?.id);
  return {
    status: "ready" as const,
    email: payload.email,
    affiliation,
    applicantKind: payload.applicantKind,
    consents: payload.consents,
    organization: organization
      ? { id: organization.id, name: organization.name, jobTitle: represented?.jobTitle ?? null }
      : null,
    ...(speakerManagementToken
      ? {
          speakerManagementToken,
          speakerManageUrl: speakerManagePageUrl(input.appBaseUrl, input.event, speakerManagementToken),
        }
      : {}),
    continuationToken: await issueEventProposalContinuation(
      input.signingSecret,
      { ...receipt, userId: resolved.user?.id ?? null, ...(speakerClaimSessionId ? { speakerClaimSessionId } : {}) },
      expiresAt,
    ),
    ...(payload.context.sessionId && input.speakerProposalId
      ? {
          speakerProposalId: input.speakerProposalId,
          speakerManageUrl: speakerParticipationPageUrl(input.appBaseUrl, input.event, input.speakerProposalId),
        }
      : {}),
    person: resolved.user
      ? {
          email: payload.email,
          firstName: resolved.user.first_name,
          lastName: resolved.user.last_name,
          organizationName: null,
          jobTitle: null,
          bio: spokenAs?.biography ?? null,
          links: spokenAs?.links ?? [],
        }
      : null,
  };
}

export async function listEventProposalProofIdentities(
  db: DatabaseLike,
  input: {
    eventId: string;
    continuationToken: string;
    signingSecret: string;
    query: IdentitiesListQuery;
    actor?: AuthenticatedIdentity;
    speakerManagementToken?: string;
    speakerProposalId?: string;
  },
) {
  const payload = await verifyEventProposalCapability(
    input.signingSecret,
    input.continuationToken,
    input.eventId,
    true,
  );
  await assertProposalProofCurrent(db, payload);
  const speakerAuthority = eventProposalSpeakerAuthority(input);
  await prepareEventProposalProofContext(db, {
    payload,
    signingSecret: input.signingSecret,
    actor: input.actor,
    speakerAuthority,
    speakerId: payload.context.speakerId,
  });
  const resolved = await resolveProposalProofPerson(
    db,
    payload.email,
    payload.speakerClaimSessionId ? (payload.userId ?? undefined) : payload.context.userId,
  );
  if (!resolved || (resolved.user?.id ?? null) !== payload.userId)
    throw new AppError(409, "PROPOSAL_PERSON_CHANGED", "The confirmed email's account changed.");
  return resolved.user && payload.applicantKind === "organization"
    ? listUserIdentities(db, resolved.user.id, { ...input.query, active: true, blocked: false, organizationOnly: true })
    : { identities: [], page: buildPageInfo(input.query.limit, input.query.offset, 0, 0) };
}
