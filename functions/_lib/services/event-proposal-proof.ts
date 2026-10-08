import type { z } from "zod";
import {
  emailDomainOf,
  isDisposableEmailDomain,
  isPersonalEmailDomain,
} from "../../../assets/shared/constants/email-domains";
import type { eventProposalProofStartSchema } from "../../../assets/shared/schemas/event-proposal-proof";
import type { IdentitiesListQuery } from "../../../assets/shared/schemas/identity";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { assertProposalProofCurrent, prepareCurrentEventProposalProof } from "./event-proposal-proof-current";
export { assertProposalProofCurrent } from "./event-proposal-proof-current";
import type { DatabaseLike } from "../types";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { all } from "../db/queries";
import { resolveVerifiedEmailDomainOrganization } from "./identities";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import { randomToken } from "../utils/crypto";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import { emailPlainText } from "../email/plain-text";
import { getRequiredTerms, type EventRecord } from "./events";
import { prepareActiveTermsSnapshotGuard, validateRequiredConsents } from "./consent";
import { proposalPageUrl, speakerManagePageUrl, speakerParticipationPageUrl } from "./frontend-links";
import {
  createEventProposalProofContext,
  eventProposalSpeakerAuthority,
  prepareEventProposalProofContext,
  resumeEventProposalSpeakerProof,
} from "./event-proposal-proof-context";
import { listUserIdentities } from "./identities/read-model";
import { resolveProposalProofPerson } from "./event-proposal-proof-person";
import {
  captureEventProposalEntry,
  resumeEventProposalEntry,
  prepareEventProposalEntry,
} from "./event-proposal-proof-entry";
import {
  issueEventProposalContinuation,
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
  await validateRequiredConsents(terms, input.body.consents);
  const domain = emailDomainOf(input.body.email);
  if (isDisposableEmailDomain(domain))
    throw new AppError(422, "DISPOSABLE_EMAIL_NOT_ALLOWED", "Disposable email providers are not accepted");
  if (isPersonalEmailDomain(domain) && !input.body.unaffiliatedAttestation)
    return { status: "unaffiliated_attestation_required" as const, outboxId: null };
  const speakerAuthority = eventProposalSpeakerAuthority({ ...input.body, actor: input.actor });
  if (speakerAuthority && input.body.entryContext)
    throw new AppError(
      422,
      "PROPOSAL_ENTRY_CONTEXT_INVALID",
      "Proposal entry context belongs to an initial proposal submission.",
    );
  if (input.body.continuationToken && (speakerAuthority || input.body.entryContext))
    throw new AppError(
      422,
      "PROPOSAL_PROOF_CONTEXT_MISMATCH",
      "Continue with the original confirmed person and invitation.",
    );
  const source = input.body.continuationToken
    ? await verifyEventProposalCapability(input.signingSecret, input.body.continuationToken, input.event.id, true)
    : null;
  const sourceGuards = source ? await prepareCurrentEventProposalProof(db, source) : [];
  let context = await createEventProposalProofContext(db, {
    eventId: input.event.id,
    signingSecret: input.signingSecret,
    actor: input.actor,
    speakerManagementToken: input.body.speakerManagementToken,
    speakerProposalId: input.body.speakerProposalId,
  });
  if (source) {
    sourceGuards.push(
      ...(await prepareEventProposalProofContext(db, {
        payload: source,
        signingSecret: input.signingSecret,
        actor: input.actor,
        operation: "proposal_submission",
      })),
    );
    const resolved = await resolveProposalProofPerson(db, source.email);
    if (
      !resolved?.user ||
      resolved.user.id !== source.userId ||
      (input.actor && input.actor.userId !== resolved.user.id)
    )
      throw new AppError(
        403,
        "PROPOSAL_PERSON_MISMATCH",
        "Confirm an existing person's own mailbox before adding another email.",
      );
    const target = await resolveProposalProofPerson(db, input.body.email, resolved.user.id);
    if (!target)
      throw new AppError(
        409,
        "PROPOSAL_PERSON_CHANGED",
        "This address cannot be linked to your account. Contact support.",
      );
    sourceGuards.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM users WHERE pending_email=?) AND NOT EXISTS(SELECT 1 FROM users WHERE normalized_email=? AND id<>?) AND NOT EXISTS(SELECT 1 FROM user_emails WHERE normalized_email=? AND user_id<>?)",
        bindings: [input.body.email, input.body.email, resolved.user.id, input.body.email, resolved.user.id],
      }),
    );
    context = {
      kind: "mailbox",
      userId: resolved.user.id,
      email: source.email,
      emailId: resolved.emailId,
      capabilityId: source.capabilityId,
      termsDigest: source.termsDigest,
      expiresAt: source.expiresAt,
      ...(source.context?.kind === "session" || (source.context?.kind === "mailbox" && source.context.sessionId)
        ? { sessionId: source.context.sessionId }
        : {}),
    };
    // Recheck the exact original mailbox ownership and source proof at the email queue boundary.
    sourceGuards.push(
      ...(await prepareEventProposalProofContext(db, {
        payload: { ...source, context },
        signingSecret: input.signingSecret,
        actor: input.actor,
        operation: "proposal_submission",
      })),
    );
  }
  const entryContext =
    source?.entryContext ??
    (await captureEventProposalEntry(db, {
      entryContext: input.body.entryContext,
      event: input.event,
      signingSecret: input.signingSecret,
    }));
  const entryGuards = (await prepareEventProposalEntry(db, input.event.id, entryContext)).statements;
  const payload: EventProposalProofPayload = {
    eventId: input.event.id,
    email: input.body.email,
    applicantKind: input.body.unaffiliatedAttestation ? "individual" : "organization",
    capabilityId: randomToken(18),
    termsDigest: await proposalTermsDigest(terms),
    operation: speakerAuthority ? "speaker_profile" : "proposal_submission",
    context,
    ...(entryContext ? { entryContext } : {}),
  };
  const contextTtl =
    payload.context?.kind === "speaker" || payload.context?.kind === "mailbox"
      ? Math.min(input.ttlSeconds, payload.context.expiresAt - Math.floor(Date.now() / 1000))
      : input.ttlSeconds;
  const proofTtl = entryContext?.invite
    ? Math.min(contextTtl, entryContext.invite.expiresAt - Math.floor(Date.now() / 1000))
    : contextTtl;
  const verificationToken = encodeURIComponent(queuedEventProposalProofToken(payload, proofTtl));
  const verificationUrl = input.body.speakerProposalId
    ? `${speakerParticipationPageUrl(input.appBaseUrl, input.event, input.body.speakerProposalId)}?verify=${verificationToken}`
    : `${proposalPageUrl(input.appBaseUrl, input.event)}#verify=${verificationToken}`;
  const email = prepareQueueEmailStatement(db, {
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
      ...sourceGuards,
      ...entryGuards,
      ...(speakerAuthority
        ? await prepareEventProposalProofContext(db, {
            payload,
            signingSecret: input.signingSecret,
            actor: input.actor,
            speakerAuthority,
            speakerId: context?.kind === "speaker" ? context.speakerId : undefined,
            operation: "speaker_profile",
          })
        : []),
      prepareActiveTermsSnapshotGuard(db, input.event.id, terms, audience),
      email.statement,
    ]);
  } catch (error) {
    if (source && isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "PROPOSAL_PERSON_CHANGED",
        "Your confirmed account, mailbox, or event terms changed. Confirm again.",
      );
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "PROPOSAL_TERMS_CHANGED",
        "The event terms changed. Review them before confirming your email.",
        { consents: "Review the current event terms." },
      );
    throw error;
  }
  return { status: "verification_sent" as const, outboxId: email.id };
}

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
  },
) {
  const payload = await verifyEventProposalCapability(input.signingSecret, input.token, input.eventId, false);
  await assertProposalProofCurrent(db, payload);
  const speakerAuthority = eventProposalSpeakerAuthority(input);
  const speakerManagementToken =
    payload.context?.kind === "speaker" && !payload.context.sessionId && !input.speakerProposalId
      ? await resumeEventProposalSpeakerProof(db, { payload, signingSecret: input.signingSecret })
      : undefined;
  if (!speakerManagementToken)
    await prepareEventProposalProofContext(db, {
      payload,
      signingSecret: input.signingSecret,
      actor: input.actor,
      operation: speakerAuthority ? "speaker_profile" : payload.operation,
      speakerAuthority,
      speakerId: payload.context?.kind === "speaker" ? payload.context.speakerId : undefined,
    });
  const resolved = await resolveProposalProofPerson(db, payload.email, payload.context?.userId);
  if (!resolved) return { status: "support_required" as const };
  const entryContext = await resumeEventProposalEntry(db, {
    eventId: input.eventId,
    entryContext: payload.entryContext,
    signingSecret: input.signingSecret,
    proofExpiresAt: payload.expiresAt,
  });
  const { expiresAt, ...receipt } = payload;
  let organization: { id: string; name: string } | null = null;
  if (payload.applicantKind === "organization") {
    // Existing approved own relationships remain selectable even when neutral global domain evidence needs review.
    const owned = resolved.user
      ? await all<{ id: string; name: string }>(
          db,
          `
      SELECT organization.id,organization.name FROM identities identity
      JOIN organizations organization ON organization.id=identity.organization_id
      JOIN users person ON person.id=identity.user_id
      LEFT JOIN user_emails address ON address.id=identity.email_id AND address.user_id=identity.user_id
      WHERE identity.user_id=? AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
        AND CASE WHEN identity.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END=?
        AND (identity.email_id IS NULL OR address.verified_at IS NOT NULL)
      ORDER BY identity.id LIMIT 2`,
          [resolved.user.id, payload.email],
        )
      : [];
    try {
      organization = await resolveVerifiedEmailDomainOrganization(db, payload.email);
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        !["ORGANIZATION_DOMAIN_IN_USE", "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED"].includes(error.code)
      )
        throw error;
      if (!owned.length) return { status: "support_required" as const };
      organization = owned.length === 1 ? owned[0] : null;
    }
  }
  return {
    status: "ready" as const,
    email: payload.email,
    applicantKind: payload.applicantKind,
    organization,
    ...(entryContext ? { entryContext } : {}),
    ...(speakerManagementToken
      ? {
          speakerManagementToken,
          speakerManageUrl: speakerManagePageUrl(input.appBaseUrl, input.event, speakerManagementToken),
        }
      : {}),
    continuationToken: await issueEventProposalContinuation(
      input.signingSecret,
      { ...receipt, userId: resolved.user?.id ?? null },
      expiresAt,
    ),
    ...(payload.context?.kind === "speaker" && payload.context.sessionId && input.speakerProposalId
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
          bio: resolved.user.biography,
          links: parseLinksJson(resolved.user.links_json),
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
    operation: speakerAuthority ? "speaker_profile" : payload.operation,
    speakerAuthority,
    speakerId: payload.context?.kind === "speaker" ? payload.context.speakerId : undefined,
  });
  const resolved = await resolveProposalProofPerson(db, payload.email, payload.context?.userId);
  if (!resolved || (resolved.user?.id ?? null) !== payload.userId)
    throw new AppError(409, "PROPOSAL_PERSON_CHANGED", "The confirmed email's account changed.");
  return resolved.user && payload.applicantKind === "organization"
    ? listUserIdentities(db, resolved.user.id, { ...input.query, active: true, blocked: false, organizationOnly: true })
    : { identities: [], page: buildPageInfo(input.query.limit, input.query.offset, 0, 0) };
}
