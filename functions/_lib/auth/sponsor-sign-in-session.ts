/** Sponsor-mailbox sign-in: redeems a sponsor capability into the canonical user session. */
import type { DatabaseLike } from "../types";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import {
  findEligibleStaffUserById,
  resolveEligibleMembershipRows,
  countPendingIdentitiesForUser,
} from "./identity-capacities";
import { hasEventParticipation } from "./event-participation";
import { sessionExpiresAtToExp } from "./session-engine";
import { commitEmailAuthRedemption } from "./email-auth-capabilities";
import { prepareVerifyOwnedEmailStatements } from "../services/email-verification";
import { buildFindOrCreateUserStatement } from "../services/users";
import {
  findActiveSponsorCapacitiesByUserId,
  sponsorSignInAuthorizationEvidence,
  verifySponsorSignInCapability,
} from "./sponsor-capacity";
import { signUserSessionToken } from "./user-session-token";
import { createEstablishedUserSessionResult, type UserSessionResult } from "./user-session-result";
import { findActingIdentitiesForUser } from "./session-acting-identities";
import { resolveSessionActingIdentityId } from "../../../assets/shared/session-acting-identity";
import { recordAuditActingIdentity } from "../services/audit-actor";
import { findActiveIdentity, prepareSessionEmailAuthenticationStatement, prepareUserSession } from "./user-session";
import { provedMailboxSignInEvidence } from "./email-sign-in-policy";
import { first } from "../db/queries";
import { prepareFirstAddressSignInStatements } from "../services/account-security-notices";
import type { AccountOrganizationRequired } from "../../../assets/shared/schemas/account-organization";
import {
  accountOrganizationStepStatements,
  type AccountOrganizationStepInput,
} from "../services/identities/account-organization";

/**
 * Redeem a sponsor-mailbox capability into the same user session used by the
 * portal, under the rules of an email sign-in: account setup's organization
 * step comes first, and the first sign-in through an added address is noticed.
 */
export async function redeemSponsorSignInCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    sessionTtlHours: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
    organization?: AccountOrganizationStepInput;
  },
): Promise<{ session: UserSessionResult; token: string } | { required: AccountOrganizationRequired }> {
  const verified = await verifySponsorSignInCapability(db, payload);
  const preparedUser = await buildFindOrCreateUserStatement(db, {
    email: verified.sponsorship.contactEmail,
    mailboxVerified: true,
  });
  if (!preparedUser.created && !(await findActiveIdentity(db, preparedUser.user.id))) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This identity is inactive");
  }

  const [staff, memberships] = preparedUser.created
    ? [null, []]
    : await Promise.all([
        findEligibleStaffUserById(db, preparedUser.user.id),
        resolveEligibleMembershipRows(db, preparedUser.user.id),
      ]);
  const actingIdentities = preparedUser.created ? [] : await findActingIdentitiesForUser(db, preparedUser.user.id);
  recordAuditActingIdentity(preparedUser.user.id, resolveSessionActingIdentityId(actingIdentities, null));
  const verifiedAt = nowIso();
  const normalizedContactEmail = normalizeEmail(verified.sponsorship.contactEmail);
  const organizationStep = await accountOrganizationStepStatements(db, {
    signingSecret: payload.signingSecret,
    subject: preparedUser.created ? { userId: null } : { userId: preparedUser.user.id },
    newUserId: preparedUser.user.id,
    email: normalizedContactEmail,
    verifiedAt,
    input: payload.organization,
  });
  if ("required" in organizationStep) return organizationStep;
  // The link may sign in through an address added to an existing account.
  const addedAddress =
    !preparedUser.created && normalizeEmail(preparedUser.user.email) !== normalizedContactEmail
      ? await first<{ id: string; email: string }>(
          db,
          "SELECT id, email FROM user_emails WHERE user_id = ? AND normalized_email = ?",
          [preparedUser.user.id, normalizedContactEmail],
        )
      : null;
  const prepared = await prepareUserSession(db, preparedUser.user.id, payload.sessionTtlHours);
  await commitEmailAuthRedemption(db, {
    purpose: "sponsor_sign_in",
    capabilityId: verified.capability.capabilityId,
    actorType: "user",
    actorId: preparedUser.user.id,
    action: "sponsor_magic_link_verified",
    entityType: "identity_session",
    entityId: prepared.sessionId,
    details: { sponsorId: verified.sponsorship.sponsorId, expiresAt: prepared.expiresAt },
    createdAt: verifiedAt,
    authorizationEvidence: [
      sponsorSignInAuthorizationEvidence(verified.sponsorship.sponsorId, normalizedContactEmail),
      ...(!preparedUser.created
        ? [provedMailboxSignInEvidence({ userId: preparedUser.user.id, normalizedEmail: normalizedContactEmail })]
        : []),
    ],
    statements: [
      ...preparedUser.statements,
      ...prepareVerifyOwnedEmailStatements(db, {
        userId: preparedUser.user.id,
        normalizedEmail: normalizedContactEmail,
        method: "magic_link",
        verifiedAt,
      }),
      ...organizationStep.statements,
      ...prepared.statements,
      prepareSessionEmailAuthenticationStatement(db, {
        sessionId: prepared.sessionId,
        emailId: addedAddress?.id ?? null,
        normalizedEmail: normalizedContactEmail,
        at: verifiedAt,
      }),
      ...(addedAddress
        ? prepareFirstAddressSignInStatements(db, {
            userId: preparedUser.user.id,
            primaryEmail: preparedUser.user.email,
            emailId: addedAddress.id,
            email: addedAddress.email,
            at: verifiedAt,
          })
        : []),
    ],
  });

  const sponsors = await findActiveSponsorCapacitiesByUserId(db, preparedUser.user.id);
  if (sponsors.length === 0) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This identity no longer has sponsor access");
  }
  const pendingIdentityCount = await countPendingIdentitiesForUser(db, preparedUser.user.id);
  const eventParticipation = await hasEventParticipation(db, preparedUser.user.id);
  // An organization added at account setup is read back, with any membership it brings, and acted as.
  const added = organizationStep.identityId;
  const [currentMemberships, currentActingIdentities] = added
    ? await Promise.all([
        resolveEligibleMembershipRows(db, preparedUser.user.id),
        findActingIdentitiesForUser(db, preparedUser.user.id),
      ])
    : [memberships, actingIdentities];
  const session = await createEstablishedUserSessionResult(
    db,
    prepared,
    {
      identity: { id: preparedUser.user.id, email: preparedUser.user.email },
      staff,
      memberships: currentMemberships,
      sponsors,
      pendingIdentityCount,
      eventParticipation,
      actingIdentities: currentActingIdentities,
    },
    added ?? null,
  );
  const token = await signUserSessionToken(payload.signingSecret, {
    sub: preparedUser.user.id,
    sid: prepared.sessionId,
    exp: sessionExpiresAtToExp(prepared.expiresAt),
    identityId: session.actingIdentityId,
  });
  return { session, token };
}
