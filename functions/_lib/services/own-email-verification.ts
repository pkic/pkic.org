import { prepareJobWake } from "./scheduled-jobs/dispatcher";
/**
 * Proving that a person receives mail at an address they added.
 *
 * The link is the shared stateless email capability (`email_address_verification`),
 * bound to the address request and to a fingerprint of its text, delivered through
 * the outbox like a sign-in link. The portal page previews it read-only; linking
 * requires an explicit click and the intended account’s live sign-in; the capability is redeemed once through the shared
 * one-time audit key. A verified work address then joins the
 * organization its domain belongs to through the one shared rule
 * (`prepareVerifiedAddressDomainOrganizationLink`): automatically for a non-member
 * organization, and as the offer for a member organization.
 */
import {
  OWN_EMAIL_ADDRESS_LIMIT,
  EMAIL_ADDRESS_VERIFICATION_TTL_HOURS,
  EMAIL_VERIFIED_ELSEWHERE,
} from "../../../assets/shared/schemas/own-email-addresses";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
} from "../auth/email-auth-capabilities";
import { prepareQueueEmailStatement } from "../email/outbox-queue";
import { first } from "../db/queries";
import { AppError } from "../errors";
import {
  prepareAuthorizationGuard,
  isAuthorizationGuardFailure,
  type AuthorizationEvidence,
} from "../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../types";
import { readEmailOwnership, prepareEmailOwnershipClaim } from "./email-ownership";
import { prepareUnverifiedAccountConsolidation } from "./unverified-account-consolidation";
import { normalizeEmail } from "../validation";
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
  authorizationEvidence?: AuthorizationEvidence;
}

/** Queues the verification email for one address; the caller commits it with its own change. */
export async function prepareOwnEmailVerificationMessage(
  db: DatabaseLike,
  input: {
    userId: string;
    emailId: string;
    email: string;
    addressRequest?: boolean;
    purpose?: "representation";
    at: string;
  } & OwnEmailVerificationDelivery,
): Promise<{ outboxId: string; statements: StatementLike[] }> {
  const capability = await queueEmailAuthCapability({
    signingSecret: input.signingSecret,
    purpose: PURPOSE,
    subjectId: input.emailId,
    email: input.email,
    ...(input.addressRequest
      ? {
          addressRequest: {
            userId: input.userId,
            email: normalizeEmail(input.email),
            ...(input.purpose ? { purpose: input.purpose } : {}),
          },
        }
      : {}),
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
  requested: boolean;
}

async function ownAddress(db: DatabaseLike, userId: string, emailId: string): Promise<UnverifiedAddress> {
  const address = await first<UnverifiedAddress>(
    db,
    `SELECT id,email,normalized_email,verified_at,0 AS requested FROM user_emails WHERE id=? AND user_id=?`,
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
  const at = nowIso();
  const prepared = await prepareOwnEmailVerificationMessage(db, {
    ...input,
    email: address.email,
    at,
  });
  try {
    await db.batch([
      ...(input.authorizationEvidence ? [prepareAuthorizationGuard(db, input.authorizationEvidence)] : []),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM users person WHERE person.id=? AND person.email_verified_at IS NOT NULL AND person.active=1
        AND EXISTS(SELECT 1 FROM user_emails address WHERE address.id=? AND address.user_id=person.id
          AND address.normalized_email=? AND address.verified_at IS NULL)`,
        bindings: [input.userId, address.id, address.normalized_email],
      }),
      ...prepared.statements,
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "EMAIL_CLAIM_CHANGED",
        "This email request changed. Reload your email addresses and request a new link.",
      );
    throw error;
  }
  return { outboxId: prepared.outboxId };
}

interface LinkedAddress extends UnverifiedAddress {
  user_id: string;
  account_email: string;
  consolidation_source_id: string | null;
  verified_elsewhere: number;
}

/** Whether an account other than `person` already holds the address `normalizedEmail` (an SQL expression) as verified. */
function verifiedElsewhereColumn(normalizedEmail: string): string {
  return `(EXISTS(SELECT 1 FROM users owner WHERE owner.normalized_email=${normalizedEmail}
        AND owner.id<>person.id AND owner.email_verified_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM user_emails owner WHERE owner.normalized_email=${normalizedEmail}
        AND owner.user_id<>person.id AND owner.verified_at IS NOT NULL)) AS verified_elsewhere`;
}

/** The address an emailed link names, when the link is genuine and still matches the address text. */
async function resolveVerificationLink(
  db: DatabaseLike,
  input: { token: string; signingSecret: string },
): Promise<{ address: LinkedAddress; capabilityId: string; representationRequest: boolean }> {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: input.signingSecret,
    purpose: PURPOSE,
    token: input.token,
  });
  const requested = capability.addressRequest;
  const address = requested
    ? await first<LinkedAddress>(
        db,
        `SELECT COALESCE(saved.id,?) AS id,person.id AS user_id,? AS email,? AS normalized_email,
      CASE WHEN person.normalized_email=? THEN person.email_verified_at ELSE saved.verified_at END AS verified_at,
      1 AS requested,person.email AS account_email,
      (SELECT source.id FROM users source WHERE source.normalized_email=? AND source.id<>person.id
        AND source.active=1 AND source.email_verified_at IS NULL AND source.pii_redacted_at IS NULL
        AND source.merged_into_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM user_emails owned
          WHERE owned.user_id=source.id AND owned.verified_at IS NOT NULL)) AS consolidation_source_id,
      ${verifiedElsewhereColumn("?")}
      FROM users person LEFT JOIN user_emails saved ON saved.user_id=person.id AND saved.normalized_email=?
      WHERE person.id=? AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
        [
          capability.subjectId,
          requested.email,
          normalizeEmail(requested.email),
          normalizeEmail(requested.email),
          normalizeEmail(requested.email),
          normalizeEmail(requested.email),
          normalizeEmail(requested.email),
          normalizeEmail(requested.email),
          requested.userId,
        ],
      )
    : await first<LinkedAddress>(
        db,
        `SELECT address.id,address.user_id,address.email,address.normalized_email,address.verified_at,
      0 AS requested,person.email AS account_email,NULL AS consolidation_source_id,
      ${verifiedElsewhereColumn("address.normalized_email")}
      FROM user_emails address JOIN users person ON person.id=address.user_id AND person.active=1 WHERE address.id=?`,
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
  if (address.verified_elsewhere)
    throw new AppError(409, EMAIL_VERIFIED_ELSEWHERE.code, EMAIL_VERIFIED_ELSEWHERE.message);
  return {
    address,
    capabilityId: capability.capabilityId,
    representationRequest: requested?.purpose === "representation",
  };
}

/** Read-only: mail scanners may open the link, but only the explicit verification changes anything. */
export async function previewOwnEmailVerification(
  db: DatabaseLike,
  input: { token: string; signingSecret: string },
): Promise<{ email: string; accountEmail: string; consolidatesUnverifiedAccount: boolean }> {
  const { address } = await resolveVerificationLink(db, input);
  return {
    email: address.email,
    accountEmail: address.account_email,
    consolidatesUnverifiedAccount: address.consolidation_source_id !== null,
  };
}

export interface OwnEmailVerificationResult {
  email: string;
  /** The organization the address joined automatically. */
  joinedOrganization: { id: string; name: string } | null;
  /** A member organization the address belongs to, which the person joins themselves once signed in. */
  offeredOrganization: { id: string; name: string } | null;
}

/**
 * Redeems mailbox proof only with the intended account's live authorization. The verified address then joins the organization its domain
 * belongs to when that is automatic; a member organization is offered, and
 * the person signs in only to answer that offer.
 */
export async function verifyOwnEmailAddress(
  db: DatabaseLike,
  input: {
    token: string;
    signingSecret: string;
    consolidateUnverifiedAccount?: boolean;
    actor: { userId: string; authorizationEvidence: AuthorizationEvidence };
  },
): Promise<OwnEmailVerificationResult> {
  const { address, capabilityId, representationRequest } = await resolveVerificationLink(db, input);
  const userId = address.user_id;
  if (input.actor.userId !== userId)
    throw new AppError(
      403,
      "EMAIL_ACCOUNT_MISMATCH",
      "This request belongs to a different account. Do not link this address to that account.",
    );
  const at = nowIso();
  const ownership = await readEmailOwnership(db, address.normalized_email);
  const consolidating =
    ownership?.kind === "primary" && ownership.userId !== userId && !ownership.verifiedAt && !ownership.alternateId;
  if (consolidating && !input.consolidateUnverifiedAccount)
    throw new AppError(
      409,
      "EMAIL_CONSOLIDATION_REQUIRED",
      "Reopen your verification link and confirm that this address should be consolidated into your account.",
    );
  const consolidation = consolidating
    ? await prepareUnverifiedAccountConsolidation(db, {
        sourceUserId: ownership.userId,
        targetUserId: userId,
        normalizedEmail: address.normalized_email,
        at,
      })
    : [];
  const pendingRelease = prepareEmailOwnershipClaim(db, address.normalized_email, userId, ownership);
  const joined = representationRequest
    ? null
    : await prepareVerifiedAddressDomainOrganizationLink(db, {
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
    authorizationEvidence: [
      input.actor.authorizationEvidence,
      {
        sql: `SELECT 1 FROM users person WHERE person.id=? AND person.active=1 AND person.email_verified_at IS NOT NULL
        AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
        AND (?=1 OR EXISTS(SELECT 1 FROM user_emails address WHERE address.id=? AND address.user_id=person.id
          AND address.normalized_email=? AND address.verified_at IS NULL))
        AND (EXISTS(SELECT 1 FROM user_emails saved WHERE saved.id=? AND saved.user_id=person.id)
          OR (SELECT COUNT(*) FROM user_emails saved WHERE saved.user_id=person.id) < ?)
        AND NOT EXISTS (SELECT 1 FROM users owner WHERE owner.normalized_email=? AND owner.id<>person.id
          AND NOT (?=1 AND owner.email_verified_at IS NULL))
        AND NOT EXISTS (SELECT 1 FROM user_emails owner WHERE owner.normalized_email=?
          AND owner.user_id<>person.id AND owner.verified_at IS NOT NULL)`,
        bindings: [
          userId,
          address.requested ? 1 : 0,
          address.id,
          address.normalized_email,
          address.id,
          OWN_EMAIL_ADDRESS_LIMIT,
          address.normalized_email,
          (consolidating && input.consolidateUnverifiedAccount) ||
          (ownership?.kind === "primary" && !ownership.verifiedAt && ownership.alternateVerifiedAt)
            ? 1
            : 0,
          address.normalized_email,
        ],
      },
    ],
    statements: [
      ...pendingRelease,
      ...consolidation,
      ...(address.requested
        ? [
            db
              .prepare(`INSERT INTO user_emails(id,user_id,email,normalized_email,created_at)
        VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
              .bind(address.id, userId, address.email, address.normalized_email, at),
          ]
        : []),
      db
        .prepare(
          "UPDATE user_emails SET verified_at = ?, verification_method = 'magic_link' WHERE id = ? AND user_id = ?",
        )
        .bind(at, address.id, userId),
      ...(joined?.statements ?? []),
      prepareJobWake(db, "google_groups_sync"),
    ],
  });
  const [joinedOrganization, offer] = await Promise.all([
    joined
      ? first<{ id: string; name: string }>(db, "SELECT id, name FROM organizations WHERE id = ?", [
          joined.organizationId,
        ])
      : null,
    joined || representationRequest ? null : readAffiliationOffer(db, userId),
  ]);
  return {
    email: address.email,
    joinedOrganization,
    offeredOrganization: offer?.kind === "organization" && offer.emailId === address.id ? offer.organization : null,
  };
}
