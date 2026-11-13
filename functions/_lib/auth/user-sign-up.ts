/** Account sign-up: redeems a proved address into a user and the canonical user session. */
import type { DatabaseLike } from "../types";
import { AppError } from "../errors";
import { first } from "../db/queries";
import { nowIso } from "../utils/time";
import {
  countPendingIdentitiesForUser,
  findEligibleStaffUserById,
  resolveEligibleMembershipRows,
} from "./identity-capacities";
import { hasEventParticipation } from "./event-participation";
import { sessionExpiresAtToExp } from "./session-engine";
import {
  SIGN_IN_LINK_REFUSALS,
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  emailAuthRedemptionKey,
  verifyEmailAuthCapabilityToken,
} from "./email-auth-capabilities";
import { prepareVerifyOwnedEmailStatements } from "../services/email-verification";
import { buildFindOrCreateUserStatement } from "../services/users";
import { findActiveSponsorCapacitiesByUserId } from "./sponsor-capacity";
import { signUserSessionToken } from "./user-session-token";
import { createEstablishedUserSessionResult, type UserSessionResult } from "./user-session-result";
import { findActingIdentitiesForUser } from "./session-acting-identities";
import { resolveSessionActingIdentityId } from "../../../assets/shared/session-acting-identity";
import { recordAuditActingIdentity } from "../services/audit-actor";
import { prepareUserSession } from "./user-session";

/**
 * Opening a sign-up link proves the mailbox, so the account is created here
 * and not when the link was requested. A new account starts with the
 * individual identity every new account gets; an organization identity is
 * added by the flow the person continues into, under that flow's own rules.
 */
export async function redeemUserSignUpCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    sessionTtlHours: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{ session: UserSessionResult; token: string }> {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: payload.signingSecret,
    purpose: "user_sign_up",
    token: payload.token,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  const email = capability.signUpEmail;
  if (!email) throw new AppError(404, "MAGIC_LINK_INVALID", SIGN_IN_LINK_REFUSALS.invalid);
  await assertEmailAuthCapabilityEmail({ signingSecret: payload.signingSecret, capability, currentEmail: email });

  const preparedUser = await buildFindOrCreateUserStatement(db, { email, mailboxVerified: true });
  const userId = preparedUser.user.id;
  // A sign-up link only ever starts a new account. An address an account has already proved signs in
  // under that account's own rules (it may have turned sign-in off for this address), never through here.
  if (!preparedUser.created) {
    const used = await first(db, "SELECT 1 AS used FROM audit_log WHERE idempotency_key = ?", [
      emailAuthRedemptionKey("user_sign_up", capability.capabilityId),
    ]);
    throw used
      ? new AppError(409, "MAGIC_LINK_USED", SIGN_IN_LINK_REFUSALS.used)
      : new AppError(404, "MAGIC_LINK_INVALID", SIGN_IN_LINK_REFUSALS.invalid);
  }
  const prepared = await prepareUserSession(db, userId, payload.sessionTtlHours);
  const verifiedAt = nowIso();
  await commitEmailAuthRedemption(db, {
    purpose: "user_sign_up",
    capabilityId: capability.capabilityId,
    actorType: "user",
    actorId: userId,
    action: "user_sign_up_verified",
    entityType: "identity_session",
    entityId: prepared.sessionId,
    details: { expiresAt: prepared.expiresAt },
    createdAt: verifiedAt,
    authorizationEvidence: [],
    statements: [
      ...preparedUser.statements,
      ...prepareVerifyOwnedEmailStatements(db, { userId, normalizedEmail: email, method: "magic_link", verifiedAt }),
      ...prepared.statements,
    ],
  });

  const [staff, memberships, sponsors, pendingIdentityCount, eventParticipation, actingIdentities] = await Promise.all([
    findEligibleStaffUserById(db, userId),
    resolveEligibleMembershipRows(db, userId),
    findActiveSponsorCapacitiesByUserId(db, userId),
    countPendingIdentitiesForUser(db, userId),
    hasEventParticipation(db, userId),
    findActingIdentitiesForUser(db, userId),
  ]);
  recordAuditActingIdentity(userId, resolveSessionActingIdentityId(actingIdentities, null));
  const session = await createEstablishedUserSessionResult(db, prepared, {
    identity: { id: userId, email: preparedUser.user.email },
    staff,
    memberships,
    sponsors,
    pendingIdentityCount,
    eventParticipation,
    actingIdentities,
  });
  const token = await signUserSessionToken(payload.signingSecret, {
    sub: userId,
    sid: prepared.sessionId,
    exp: sessionExpiresAtToExp(prepared.expiresAt),
    identityId: session.actingIdentityId,
  });
  return { session, token };
}
