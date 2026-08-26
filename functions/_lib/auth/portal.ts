import type { PublicAuthAdmin } from "../../../assets/shared/schemas/admin-auth";
import type { AuthMember, DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../types";
import { first } from "../db/queries";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { requireUserBackedAdminFromRequest, staffSignInAuthorizationEvidence } from "./admin";
import { publicAuthAdmin } from "./admin-identity";
import { memberSignInAuthorizationEvidence, requireMemberFromRequest } from "./member";
import {
  prepareIdentityCapacitySessions,
  resolveIdentityCapacities,
  type IdentityCapacity,
  type PreparedCapacitySession,
} from "./identity-capacities";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
} from "./email-auth-capabilities";
import { prepareVerifyPrimaryEmailStatement } from "../services/email-verification";
import { prepareVerifiedDomainAssociationStatements } from "../services/organization-representations";
export interface PortalSessionResult {
  identity: IdentityCapacity;
  admin?: UserBackedAuthAdmin;
  member?: AuthMember;
}

export interface PortalSessionEstablishedResult extends PortalSessionResult {
  expiresAt: string;
  adminSession?: PreparedCapacitySession<UserBackedAuthAdmin>;
  memberSession?: PreparedCapacitySession<AuthMember>;
}

export async function queuePortalSignInCapability(
  db: DatabaseLike,
  payload: {
    email: string;
    ttlMinutes: number;
    signingSecret: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{
  queuedToken: string;
  identity: IdentityCapacity;
  capacities: Array<"admin" | "member">;
} | null> {
  const identity = await first<IdentityCapacity>(
    db,
    "SELECT id, email FROM users WHERE normalized_email = ? AND active = 1",
    [normalizeEmail(payload.email)],
  );
  if (!identity) return null;
  const resolved = await resolveIdentityCapacities(db, identity.id);
  if (!resolved) return null;
  const magic = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose: "portal_sign_in",
    subjectId: identity.id,
    email: identity.email,
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  return {
    queuedToken: magic.queuedToken,
    identity: resolved.identity,
    capacities: [...(resolved.staff ? (["admin"] as const) : []), ...(resolved.member ? (["member"] as const) : [])],
  };
}

export async function redeemPortalSignInCapability(
  db: DatabaseLike,
  env: Pick<Env, "MEMBER_SESSION_TTL_HOURS">,
  payload: { token: string; signingSecret: string; ipHash?: string | null; userAgentHash?: string | null },
): Promise<PortalSessionEstablishedResult> {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: payload.signingSecret,
    purpose: "portal_sign_in",
    token: payload.token,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });

  const resolved = await resolveIdentityCapacities(db, capability.subjectId);
  if (!resolved) throw new AppError(403, "AUTH_FORBIDDEN", "This identity no longer has portal access");
  await assertEmailAuthCapabilityEmail({
    signingSecret: payload.signingSecret,
    capability,
    currentEmail: resolved.identity.email,
  });
  const sessions = await prepareIdentityCapacitySessions(db, resolved, env.MEMBER_SESSION_TTL_HOURS);
  const verifiedAt = nowIso();
  const capacities: Array<"admin" | "member"> = [
    ...(sessions.admin ? (["admin"] as const) : []),
    ...(sessions.member ? (["member"] as const) : []),
  ];
  const normalizedEmail = normalizeEmail(resolved.identity.email);
  const authorizationEvidence = [
    ...(sessions.admin ? [staffSignInAuthorizationEvidence(resolved.identity.id, normalizedEmail)] : []),
    ...(sessions.member ? [memberSignInAuthorizationEvidence(resolved.identity.id, normalizedEmail)] : []),
  ];

  await commitEmailAuthRedemption(db, {
    purpose: "portal_sign_in",
    capabilityId: capability.capabilityId,
    actorType: "user",
    actorId: resolved.identity.id,
    action: "portal_magic_link_verified",
    entityType: "identity_session",
    entityId: (sessions.admin ?? sessions.member)!.sessionId,
    details: { capacities, expiresAt: sessions.expiresAt },
    createdAt: verifiedAt,
    authorizationEvidence,
    statements: [
      prepareVerifyPrimaryEmailStatement(db, {
        userId: resolved.identity.id,
        normalizedEmail,
        method: "magic_link",
        verifiedAt,
      }),
      ...(await prepareVerifiedDomainAssociationStatements(db, {
        userId: resolved.identity.id,
        normalizedEmail,
        at: verifiedAt,
      })),
      ...[sessions.admin?.statement, sessions.member?.statement].filter((statement): statement is StatementLike =>
        Boolean(statement),
      ),
    ],
  });

  return {
    identity: resolved.identity,
    expiresAt: sessions.expiresAt,
    ...(sessions.admin ? { admin: sessions.admin.value, adminSession: sessions.admin } : {}),
    ...(sessions.member ? { member: sessions.member.value, memberSession: sessions.member } : {}),
  };
}

async function resolveOptionalCapacity<T>(resolver: () => Promise<T>): Promise<T | null> {
  try {
    return await resolver();
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.status === 401 || (error.status === 403 && error.code === "AUTH_FORBIDDEN"))
    ) {
      return null;
    }
    throw error;
  }
}

export async function resolvePortalSessionFromRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<PortalSessionResult> {
  const [admin, member] = await Promise.all([
    resolveOptionalCapacity(() => requireUserBackedAdminFromRequest(db, request, env)),
    resolveOptionalCapacity(() => requireMemberFromRequest(db, request, env)),
  ]);
  if (!admin && !member) throw new AppError(401, "AUTH_REQUIRED", "Portal authentication required");
  if (admin && member && admin.id !== member.userId) {
    throw new AppError(401, "PORTAL_IDENTITY_MISMATCH", "Portal session capacities belong to different identities");
  }
  const identity = admin ? { id: admin.id, email: admin.email } : { id: member!.userId, email: member!.email };
  return { identity, ...(admin ? { admin } : {}), ...(member ? { member } : {}) };
}

export function publicPortalSession(result: PortalSessionResult): {
  identity: IdentityCapacity;
  admin?: PublicAuthAdmin;
  member?: AuthMember;
} {
  return {
    identity: result.identity,
    ...(result.admin ? { admin: publicAuthAdmin(result.admin) } : {}),
    ...(result.member ? { member: result.member } : {}),
  };
}
