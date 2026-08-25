import type { PublicAuthAdmin } from "../../../assets/shared/schemas/admin-auth";
import type { AuthMember, DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../types";
import { first } from "../db/queries";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { requireUserBackedAdminFromRequest } from "./admin";
import { publicAuthAdmin } from "./admin-identity";
import { requireMemberFromRequest } from "./member";
import {
  prepareIdentityCapacitySessions,
  resolveIdentityCapacities,
  type IdentityCapacity,
  type PreparedCapacitySession,
} from "./identity-capacities";
import {
  AUTH_MAGIC_LINK_PURPOSES,
  fetchMagicLinkRowByToken,
  prepareConsumeMagicLinkStatement,
  prepareMagicLinkRow,
  validateMagicLinkRow,
  type MagicLinkTableConfig,
} from "./session-engine";
import { prepareVerifyPrimaryEmailStatement } from "../services/email-verification";
import { prepareVerifiedDomainAssociationStatements } from "../services/organization-representations";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "../services/audit";

const PORTAL_MAGIC_LINKS = {
  table: "auth_magic_links",
  subjectColumn: "user_id",
  purpose: AUTH_MAGIC_LINK_PURPOSES.portal,
} satisfies MagicLinkTableConfig;
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

export async function preparePortalMagicLink(
  db: DatabaseLike,
  payload: { email: string; ttlMinutes: number; ipHash?: string | null; userAgentHash?: string | null },
): Promise<{
  token: string;
  identity: IdentityCapacity;
  capacities: Array<"admin" | "member">;
  statement: StatementLike;
} | null> {
  const identity = await first<IdentityCapacity>(
    db,
    "SELECT id, email FROM users WHERE normalized_email = ? AND active = 1",
    [normalizeEmail(payload.email)],
  );
  if (!identity) return null;
  const resolved = await resolveIdentityCapacities(db, identity.id);
  if (!resolved) return null;
  const magic = await prepareMagicLinkRow(db, PORTAL_MAGIC_LINKS, identity.id, payload);
  return {
    token: magic.token,
    identity: resolved.identity,
    capacities: [...(resolved.staff ? (["admin"] as const) : []), ...(resolved.member ? (["member"] as const) : [])],
    statement: magic.statement,
  };
}

export async function verifyPortalMagicLink(
  db: DatabaseLike,
  env: Pick<Env, "MEMBER_SESSION_TTL_HOURS">,
  payload: { token: string; ipHash?: string | null; userAgentHash?: string | null },
): Promise<PortalSessionEstablishedResult> {
  const row = await fetchMagicLinkRowByToken(db, PORTAL_MAGIC_LINKS, payload.token);
  if (!row) throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid portal magic link token");
  validateMagicLinkRow(row, payload);

  const resolved = await resolveIdentityCapacities(db, row.subjectId);
  if (!resolved) throw new AppError(403, "AUTH_FORBIDDEN", "This identity no longer has portal access");
  const sessions = await prepareIdentityCapacitySessions(db, resolved, env.MEMBER_SESSION_TTL_HOURS);
  const verifiedAt = nowIso();
  const capacities: Array<"admin" | "member"> = [
    ...(sessions.admin ? (["admin"] as const) : []),
    ...(sessions.member ? (["member"] as const) : []),
  ];

  try {
    await db.batch([
      prepareConsumeMagicLinkStatement(db, PORTAL_MAGIC_LINKS.table, row.id),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        resolved.identity.id,
        "portal_magic_link_verified",
        "identity_session",
        (sessions.admin ?? sessions.member)!.sessionId,
        { capacities, expiresAt: sessions.expiresAt },
        verifiedAt,
      ),
      prepareVerifyPrimaryEmailStatement(db, {
        userId: resolved.identity.id,
        normalizedEmail: normalizeEmail(resolved.identity.email),
        method: "magic_link",
        verifiedAt,
      }),
      ...(await prepareVerifiedDomainAssociationStatements(db, {
        userId: resolved.identity.id,
        normalizedEmail: normalizeEmail(resolved.identity.email),
        at: verifiedAt,
      })),
      ...[sessions.admin?.statement, sessions.member?.statement].filter((statement): statement is StatementLike =>
        Boolean(statement),
      ),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
    }
    throw error;
  }

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
