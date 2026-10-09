/** Sponsor-mailbox sign-in: redeems a sponsor capability into the canonical user session. */
import type { DatabaseLike } from "../types";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import {
  findEligibleStaffUserById,
  findEligibleMemberById,
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
import { findActiveIdentity, prepareUserSession } from "./user-session";

/** Redeem a sponsor-mailbox capability into the same user session used by the portal. */
export async function redeemSponsorSignInCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    sessionTtlHours: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{ session: UserSessionResult; token: string }> {
  const verified = await verifySponsorSignInCapability(db, payload);
  const preparedUser = await buildFindOrCreateUserStatement(db, {
    email: verified.sponsorship.contactEmail,
  });
  if (!preparedUser.created && !(await findActiveIdentity(db, preparedUser.user.id))) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This identity is inactive");
  }

  const [staff, member] = preparedUser.created
    ? [null, null]
    : await Promise.all([
        findEligibleStaffUserById(db, preparedUser.user.id),
        findEligibleMemberById(db, preparedUser.user.id),
      ]);
  const actingIdentities = preparedUser.created ? [] : await findActingIdentitiesForUser(db, preparedUser.user.id);
  recordAuditActingIdentity(preparedUser.user.id, resolveSessionActingIdentityId(actingIdentities, null));
  const prepared = await prepareUserSession(db, preparedUser.user.id, payload.sessionTtlHours);
  const verifiedAt = nowIso();
  const normalizedContactEmail = normalizeEmail(verified.sponsorship.contactEmail);
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
        ? [
            {
              sql: "SELECT 1 FROM users WHERE id = ? AND active = 1",
              bindings: [preparedUser.user.id],
            },
          ]
        : []),
    ],
    statements: [
      ...(preparedUser.statement ? [preparedUser.statement] : []),
      ...prepareVerifyOwnedEmailStatements(db, {
        userId: preparedUser.user.id,
        normalizedEmail: normalizedContactEmail,
        method: "magic_link",
        verifiedAt,
      }),
      prepared.statement,
    ],
  });

  const sponsors = await findActiveSponsorCapacitiesByUserId(db, preparedUser.user.id);
  if (sponsors.length === 0) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This identity no longer has sponsor access");
  }
  const pendingIdentityCount = await countPendingIdentitiesForUser(db, preparedUser.user.id);
  const eventParticipation = await hasEventParticipation(db, preparedUser.user.id);
  const session = await createEstablishedUserSessionResult(db, prepared, {
    identity: { id: preparedUser.user.id, email: preparedUser.user.email },
    staff,
    member,
    sponsors,
    pendingIdentityCount,
    eventParticipation,
    actingIdentities,
  });
  const token = await signUserSessionToken(payload.signingSecret, {
    sub: preparedUser.user.id,
    sid: prepared.sessionId,
    exp: sessionExpiresAtToExp(prepared.expiresAt),
    identityId: session.actingIdentityId,
  });
  return { session, token };
}
