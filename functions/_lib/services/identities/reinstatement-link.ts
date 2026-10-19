/**
 * The identity's owner reinstates their own ended identity by proving, again,
 * that they receive mail at the identity's address, and that address must
 * still resolve to the identity's organization: the proof is of current
 * employment, so a personal mailbox never qualifies.
 *
 * The link is the shared stateless email capability (`identity_reinstatement`),
 * bound to the identity and a fingerprint of its address. Only the latest
 * request's link works: each request records its capability in the audit log,
 * and confirming requires that record to be the newest one made since the
 * identity last changed. Confirming needs the same signed-in account and
 * redeems the link once through the shared one-time audit key.
 */
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  emailAuthRedemptionKey,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
} from "../../auth/email-auth-capabilities";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { prepareQueueEmailStatement } from "../../email/outbox-queue";
import { emailPlainText } from "../../email/plain-text";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { organizationIdentityAuditScope } from "./authorization";
import { isConcurrentIdentityConflict } from "./conflicts";
import { loadIdentityNotificationContext } from "./notifications";
import { ownedIdentityEmailEvidence } from "./owned-email";
import { resolveEmailDomainOrganization, verifiedEmailDomainResolutionEvidence } from "./verified-email-domain";
import {
  loadReinstatementCandidate,
  planReinstatement,
  prepareReinstatementStatements,
  reinstatableIdentityEvidence,
  requireReinstatable,
  type ReinstatementCandidate,
} from "./reinstate";

const PURPOSE = "identity_reinstatement" as const;
const REQUESTED_ACTION = "organization_identity_reinstatement_requested";
export const IDENTITY_REINSTATEMENT_TTL_HOURS = 24;

/**
 * A reinstatement link opens the person's own record, which asks them to
 * sign in if needed and then shows the confirmation.
 */
function reinstatementLinkUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl}/portal/#/users/current?reinstatement=${encodeURIComponent(token)}`;
}

interface ReinstatementAddress {
  /** Rechecks, in the final batch, that the address still resolves to the organization. */
  organizationEvidence: AuthorizationEvidence;
  email: string;
  normalized_email: string;
  email_verified: number;
  account_email: string;
  recipient_name: string;
  organization_id: string;
  organization_name: string;
}

/**
 * The owner may reinstate by email only through an address whose domain still
 * resolves to the identity's organization. Null when it does not.
 */
export async function organizationAddressEvidence(
  db: DatabaseLike,
  normalizedEmail: string,
  organizationId: string,
): Promise<AuthorizationEvidence | null> {
  const { domain, resolution } = await resolveEmailDomainOrganization(db, normalizedEmail);
  if (!domain || resolution.kind !== "organization" || resolution.organizationId !== organizationId) return null;
  return verifiedEmailDomainResolutionEvidence(domain, organizationId, resolution.via === "claim");
}

/** The identity's own address: its selected verified address, or the person's primary one. */
async function loadReinstatementAddress(
  db: DatabaseLike,
  identity: ReinstatementCandidate,
): Promise<ReinstatementAddress> {
  const address = await first<Omit<ReinstatementAddress, "organizationEvidence">>(
    db,
    `SELECT COALESCE(address.email, person.email) AS email,
            COALESCE(address.normalized_email, person.normalized_email) AS normalized_email,
            identity.email_id IS NULL OR address.verified_at IS NOT NULL AS email_verified,
            person.email AS account_email,
            trim(COALESCE(person.first_name, '') || ' ' || COALESCE(person.last_name, '')) AS recipient_name,
            organization.id AS organization_id, organization.name AS organization_name
       FROM identities identity
       JOIN users person ON person.id = identity.user_id AND person.active = 1
       JOIN organizations organization ON organization.id = identity.organization_id
       LEFT JOIN user_emails address ON address.id = identity.email_id AND address.user_id = identity.user_id
      WHERE identity.id = ?`,
    [identity.id],
  );
  if (!address) throw new AppError(404, "IDENTITY_NOT_FOUND", "Identity not found");
  if (!address.email_verified) {
    throw new AppError(
      422,
      "IDENTITY_EMAIL_UNVERIFIED",
      "The identity's email address is not verified. Verify it before reinstating the identity.",
    );
  }
  const organizationEvidence = await organizationAddressEvidence(db, address.normalized_email, address.organization_id);
  if (!organizationEvidence) {
    throw new AppError(
      422,
      "IDENTITY_REINSTATEMENT_ADDRESS_NOT_ORGANIZATION",
      "Ask a contact at the organization to reinstate it, or add your work address first.",
    );
  }
  return { ...address, organizationEvidence };
}

async function loadOwnCandidate(db: DatabaseLike, identityId: string, userId: string) {
  const candidate = await loadReinstatementCandidate(db, { identityId });
  if (!candidate || candidate.user_id !== userId) {
    throw new AppError(404, "IDENTITY_NOT_FOUND", "Identity not found");
  }
  return candidate;
}

function ownSessionEvidence(input: { sessionId: string; userId: string }): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM sessions session JOIN users person ON person.id = session.user_id AND person.active = 1
           WHERE session.id = ? AND session.user_id = ? AND session.revoked_at IS NULL
             AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    bindings: [input.sessionId, input.userId],
  };
}

/** This capability is the newest reinstatement request since the identity last changed. */
function latestRequestEvidence(identityId: string, capabilityId: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM audit_log request
           JOIN identities identity ON identity.id = request.entity_id
          WHERE request.entity_type = 'identity' AND request.entity_id = ? AND request.action = ?
            AND json_extract(request.details_json, '$.capabilityId.to') = ?
            AND request.created_at >= identity.updated_at
            AND NOT EXISTS (
              SELECT 1 FROM audit_log newer
               WHERE newer.entity_type = 'identity' AND newer.entity_id = request.entity_id
                 AND newer.action = request.action AND newer.created_at > request.created_at
            )`,
    bindings: [identityId, REQUESTED_ACTION, capabilityId],
  };
}

/**
 * Emails a single-use link to the identity's address. Asking again sends a
 * new link and retires the previous one.
 */
export async function requestOwnIdentityReinstatement(
  db: DatabaseLike,
  input: {
    identityId: string;
    userId: string;
    sessionId: string;
    signingSecret: string;
    appBaseUrl: string;
  },
): Promise<{ outboxId: string; recipientEmail: string }> {
  const identity = requireReinstatable(await loadOwnCandidate(db, input.identityId, input.userId));
  const address = await loadReinstatementAddress(db, identity);
  const at = nowIso();
  const capability = await queueEmailAuthCapability({
    signingSecret: input.signingSecret,
    purpose: PURPOSE,
    subjectId: identity.id,
    email: address.normalized_email,
    ttlSeconds: IDENTITY_REINSTATEMENT_TTL_HOURS * 60 * 60,
  });
  const message = prepareQueueEmailStatement(
    db,
    {
      templateKey: "organization_identity_reinstatement",
      recipientEmail: address.email,
      recipientUserId: identity.user_id,
      eventId: null,
      messageType: "transactional",
      data: {
        recipientName: emailPlainText(address.recipient_name || address.email),
        organizationName: emailPlainText(address.organization_name),
        accountEmail: emailPlainText(address.account_email),
        reinstatementUrl: reinstatementLinkUrl(input.appBaseUrl, capability.queuedToken),
        expiresInHours: IDENTITY_REINSTATEMENT_TTL_HOURS,
      },
      capabilityLinkValues: [capability.queuedToken],
    },
    at,
  );
  await db.batch([
    prepareAuthorizationGuard(db, ownSessionEvidence(input)),
    prepareAuthorizationGuard(db, reinstatableIdentityEvidence(identity)),
    prepareAuthorizationGuard(db, address.organizationEvidence),
    message.statement,
    prepareScopedAuditLog(
      db,
      organizationIdentityAuditScope(identity.member_id, identity.user_id),
      "user",
      identity.user_id,
      REQUESTED_ACTION,
      "identity",
      identity.id,
      { organizationId: identity.organization_id, capabilityId: capability.capabilityId },
      at,
    ),
  ]);
  return { outboxId: message.id, recipientEmail: address.normalized_email };
}

/** The identity an emailed link names, for the signed-in account it belongs to. */
async function resolveReinstatementLink(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; userId: string },
) {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: input.signingSecret,
    purpose: PURPOSE,
    token: input.token,
  });
  const used = await first<{ id: string }>(db, "SELECT id FROM audit_log WHERE idempotency_key = ?", [
    emailAuthRedemptionKey(PURPOSE, capability.capabilityId),
  ]);
  if (used) throw new AppError(409, "MAGIC_LINK_USED", "This reinstatement link has already been used.");
  const candidate = await loadReinstatementCandidate(db, { identityId: capability.subjectId });
  if (!candidate) throw new AppError(404, "MAGIC_LINK_INVALID", "This reinstatement link is not valid.");
  if (candidate.user_id !== input.userId) {
    throw new AppError(
      403,
      "IDENTITY_REINSTATEMENT_OTHER_ACCOUNT",
      "This link belongs to another account. Sign in with the account that asked for it.",
    );
  }
  const address = await loadReinstatementAddress(db, candidate);
  await assertEmailAuthCapabilityEmail({
    signingSecret: input.signingSecret,
    capability,
    currentEmail: address.normalized_email,
  });
  return { candidate, address, capabilityId: capability.capabilityId };
}

/** Read-only: names the identity a link would reinstate, so the person confirms knowingly. */
export async function previewOwnIdentityReinstatement(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; userId: string },
): Promise<{ identityId: string; organizationName: string; recipientEmail: string }> {
  const { candidate, address } = await resolveReinstatementLink(db, input);
  requireReinstatable(candidate);
  return {
    identityId: candidate.id,
    organizationName: address.organization_name,
    recipientEmail: address.normalized_email,
  };
}

/** Redeems the latest link once, for the same signed-in account, and reinstates the identity. */
export async function confirmOwnIdentityReinstatement(
  db: DatabaseLike,
  input: { token: string; signingSecret: string; userId: string; sessionId: string },
): Promise<{ identityId: string; state: "active" }> {
  const { candidate, address, capabilityId } = await resolveReinstatementLink(db, input);
  const { identity, seatDepth } = await planReinstatement(db, candidate);
  const context = await loadIdentityNotificationContext(db, identity.organization_id, identity.user_id, true);
  const at = nowIso();
  try {
    await commitEmailAuthRedemption(db, {
      purpose: PURPOSE,
      capabilityId,
      actorType: "user",
      actorId: identity.user_id,
      action: "organization_identity_reinstated",
      entityType: "identity",
      entityId: identity.id,
      scope: organizationIdentityAuditScope(identity.member_id, identity.user_id),
      details: { organizationId: identity.organization_id, endedAt: identity.ended_at, reinstated_by: "owner" },
      createdAt: at,
      authorizationEvidence: [
        ownSessionEvidence(input),
        ownedIdentityEmailEvidence({
          userId: identity.user_id,
          emailId: identity.email_id,
          normalizedEmail: address.normalized_email,
          identityId: identity.id,
        }),
        latestRequestEvidence(identity.id, capabilityId),
        address.organizationEvidence,
      ],
      statements: prepareReinstatementStatements(db, { identity, context, seatDepth, at, audit: null }),
    });
  } catch (error) {
    if (isConcurrentIdentityConflict(error)) {
      throw new AppError(409, "IDENTITY_CONFLICT", "Another identity for this organization became active");
    }
    throw error;
  }
  return { identityId: identity.id, state: "active" };
}
