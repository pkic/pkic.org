/**
 * Proving that a person receives mail at an address they added.
 *
 * The link is the shared stateless email capability (`email_address_verification`),
 * bound to the address row and to a fingerprint of its text, delivered through
 * the outbox like a sign-in link. The link works without signing in, like an
 * identity invitation: the portal page previews it read-only and verifies on
 * an explicit click; the capability is redeemed once through the shared
 * one-time audit key. A verified work address then joins the
 * organization its domain belongs to through the one shared rule
 * (`prepareVerifiedAddressDomainOrganizationLink`): automatically for a non-member
 * organization, and as the offer for a member organization.
 */
import { EMAIL_ADDRESS_VERIFICATION_TTL_HOURS } from "../../../assets/shared/schemas/own-email-addresses";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
} from "../auth/email-auth-capabilities";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import { prepareVerifiedAddressDomainOrganizationLink } from "./identities/email-domain-link";
import { readAffiliationOffer } from "./identities/affiliation-offer";
import { capabilityLinkUrl } from "./user-auth-flow";

const PURPOSE = "email_address_verification" as const;

/** The portal page an address verification link opens. */
export function ownEmailVerificationLinkBase(appBaseUrl: string): string {
  return `${appBaseUrl}/portal/#/email-verifications`;
}

export interface OwnEmailVerificationDelivery {
  signingSecret: string;
  appBaseUrl: string;
}

/** Queues the verification email for one address; the caller commits it with its own change. */
export async function prepareOwnEmailVerificationMessage(
  db: DatabaseLike,
  input: { userId: string; emailId: string; email: string; at: string } & OwnEmailVerificationDelivery,
): Promise<{ outboxId: string; statements: StatementLike[] }> {
  const capability = await queueEmailAuthCapability({
    signingSecret: input.signingSecret,
    purpose: PURPOSE,
    subjectId: input.emailId,
    email: input.email,
    ttlSeconds: EMAIL_ADDRESS_VERIFICATION_TTL_HOURS * 60 * 60,
  });
  const message = prepareQueueEmailStatement(
    db,
    {
      templateKey: "user_email_verification",
      recipientEmail: input.email,
      recipientUserId: input.userId,
      eventId: null,
      messageType: "transactional",
      data: {
        email: input.email,
        verificationUrl: capabilityLinkUrl(ownEmailVerificationLinkBase(input.appBaseUrl), capability.queuedToken),
        expiresInHours: EMAIL_ADDRESS_VERIFICATION_TTL_HOURS,
      },
      capabilityLinkValues: [capability.queuedToken],
    },
    input.at,
  );
  return {
    outboxId: message.id,
    statements: [
      message.statement,
      prepareAuditLog(
        db,
        "user",
        input.userId,
        "user_email_verification_requested",
        "user",
        input.userId,
        { emailId: input.emailId, email: input.email },
        input.at,
      ),
    ],
  };
}

interface UnverifiedAddress {
  id: string;
  email: string;
  normalized_email: string;
  verified_at: string | null;
}

async function ownAddress(db: DatabaseLike, userId: string, emailId: string): Promise<UnverifiedAddress> {
  const address = await first<UnverifiedAddress>(
    db,
    "SELECT id, email, normalized_email, verified_at FROM user_emails WHERE id = ? AND user_id = ?",
    [emailId, userId],
  );
  if (!address) throw new AppError(404, "EMAIL_NOT_FOUND", "Email address not found");
  return address;
}

/** Sends a fresh link to an address the person has not verified yet. */
export async function requestOwnEmailVerification(
  db: DatabaseLike,
  input: { userId: string; emailId: string } & OwnEmailVerificationDelivery,
): Promise<{ outboxId: string }> {
  const address = await ownAddress(db, input.userId, input.emailId);
  if (address.verified_at) throw new AppError(409, "EMAIL_ALREADY_VERIFIED", "This address is already verified");
  const prepared = await prepareOwnEmailVerificationMessage(db, {
    ...input,
    email: address.email,
    at: nowIso(),
  });
  await db.batch(prepared.statements);
  return { outboxId: prepared.outboxId };
}

interface LinkedAddress extends UnverifiedAddress {
  user_id: string;
}

/** The address an emailed link names, when the link is genuine and still matches the address text. */
async function resolveVerificationLink(
  db: DatabaseLike,
  input: { token: string; signingSecret: string },
): Promise<{ address: LinkedAddress; capabilityId: string }> {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: input.signingSecret,
    purpose: PURPOSE,
    token: input.token,
  });
  const address = await first<LinkedAddress>(
    db,
    `SELECT address.id, address.user_id, address.email, address.normalized_email, address.verified_at
       FROM user_emails address JOIN users person ON person.id = address.user_id AND person.active = 1
      WHERE address.id = ?`,
    [capability.subjectId],
  );
  if (!address)
    throw new AppError(404, "MAGIC_LINK_INVALID", "This verification link is not valid. Request a new one.");
  await assertEmailAuthCapabilityEmail({
    signingSecret: input.signingSecret,
    capability,
    currentEmail: address.normalized_email,
  });
  if (address.verified_at) throw new AppError(409, "MAGIC_LINK_USED", "This email address is already verified.");
  return { address, capabilityId: capability.capabilityId };
}

/** Read-only: mail scanners may open the link, but only the explicit verification changes anything. */
export async function previewOwnEmailVerification(
  db: DatabaseLike,
  input: { token: string; signingSecret: string },
): Promise<{ email: string }> {
  const { address } = await resolveVerificationLink(db, input);
  return { email: address.email };
}

export interface OwnEmailVerificationResult {
  email: string;
  /** The organization the address joined automatically. */
  joinedOrganization: { id: string; name: string } | null;
  /** A member organization the address belongs to, which the person joins themselves once signed in. */
  offeredOrganization: { id: string; name: string } | null;
}

/**
 * Redeems the emailed link once, without a session: the link alone proves the
 * mailbox. The verified address then joins the organization its domain
 * belongs to when that is automatic; a member organization is offered, and
 * the person signs in only to answer that offer.
 */
export async function verifyOwnEmailAddress(
  db: DatabaseLike,
  input: { token: string; signingSecret: string },
): Promise<OwnEmailVerificationResult> {
  const { address, capabilityId } = await resolveVerificationLink(db, input);
  const userId = address.user_id;
  const at = nowIso();
  const joined = await prepareVerifiedAddressDomainOrganizationLink(db, {
    userId,
    normalizedEmail: address.normalized_email,
    emailId: address.id,
    at,
  });
  await commitEmailAuthRedemption(db, {
    purpose: PURPOSE,
    capabilityId,
    actorType: "user",
    actorId: userId,
    action: "user_email_verified",
    entityType: "user",
    entityId: userId,
    details: { emailId: address.id, email: address.email },
    createdAt: at,
    // The exact unverified address of this active person, unchanged since the link was checked.
    authorizationEvidence: {
      sql: `SELECT 1 FROM user_emails address JOIN users person ON person.id = address.user_id AND person.active = 1
             WHERE address.id = ? AND address.user_id = ? AND address.normalized_email = ?
               AND address.verified_at IS NULL`,
      bindings: [address.id, userId, address.normalized_email],
    },
    statements: [
      db
        .prepare(
          "UPDATE user_emails SET verified_at = ?, verification_method = 'magic_link' WHERE id = ? AND user_id = ?",
        )
        .bind(at, address.id, userId),
      ...(joined?.statements ?? []),
    ],
  });
  const [joinedOrganization, offer] = await Promise.all([
    joined
      ? first<{ id: string; name: string }>(db, "SELECT id, name FROM organizations WHERE id = ?", [
          joined.organizationId,
        ])
      : null,
    joined ? null : readAffiliationOffer(db, userId),
  ]);
  return {
    email: address.email,
    joinedOrganization,
    offeredOrganization: offer?.kind === "organization" && offer.emailId === address.id ? offer.organization : null,
  };
}
