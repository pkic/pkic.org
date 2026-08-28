import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../types";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { AUTH_SCOPES } from "./scopes";
import { createUserBackedAuthAdmin } from "./admin-identity";
import {
  findEligibleStaffUserByEmail,
  findEligibleStaffUserById,
  staffSignInAuthorizationEvidence,
} from "./identity-capacities";
import { prepareSessionRow } from "./session-engine";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
} from "./email-auth-capabilities";
import { prepareVerifyPrimaryEmailStatement } from "../services/email-verification";
import { prepareVerifiedDomainAssociationStatements } from "../services/organization-representations";

export interface McpSessionTokenClaims {
  typ: "mcp-session";
  sub: string;
  sid: string;
  email: string;
  role: string;
  scopes: string[];
  state?: string;
  exp: number;
}

function isMcpSessionClaims(value: object): value is McpSessionTokenClaims {
  const claims = value as Partial<McpSessionTokenClaims>;
  return (
    claims.typ === "mcp-session" &&
    typeof claims.sub === "string" &&
    typeof claims.sid === "string" &&
    typeof claims.email === "string" &&
    typeof claims.role === "string" &&
    Array.isArray(claims.scopes) &&
    claims.scopes.every((scope) => typeof scope === "string") &&
    (claims.state === undefined || typeof claims.state === "string") &&
    typeof claims.exp === "number"
  );
}

export function signMcpSessionToken(secret: string, claims: Omit<McpSessionTokenClaims, "typ">): Promise<string> {
  return signJwt(secret, { typ: "mcp-session", ...claims });
}

export async function verifyMcpSessionToken(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<McpSessionTokenClaims>> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok) return result;
  return isMcpSessionClaims(result.claims) ? { ok: true, claims: result.claims } : { ok: false, reason: "invalid" };
}

function toStaff(user: { id: string; email: string; role: string }): UserBackedAuthAdmin {
  return createUserBackedAuthAdmin({
    id: user.id,
    email: user.email,
    role: user.role,
    scopes: user.role === "admin" ? [...AUTH_SCOPES] : [],
  });
}

/** MCP OAuth has a separate capability and session token; it is not human `/auth` authentication. */
export async function queueMcpSignInCapability(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
    signingSecret: string;
    returnTo: string;
  },
): Promise<{ queuedToken: string | null; staff: UserBackedAuthAdmin | null }> {
  const staff = await findEligibleStaffUserByEmail(db, payload.email);
  if (!staff) return { queuedToken: null, staff: null };
  const capability = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose: "mcp_oauth_sign_in",
    subjectId: staff.id,
    email: staff.email,
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
    returnTo: payload.returnTo,
  });
  return { queuedToken: capability.queuedToken, staff: toStaff(staff) };
}

export async function redeemMcpSignInCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    sessionTtlHours: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{ staff: UserBackedAuthAdmin; sessionId: string; expiresAt: string; returnTo: string }> {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: payload.signingSecret,
    purpose: "mcp_oauth_sign_in",
    token: payload.token,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  const staff = await findEligibleStaffUserById(db, capability.subjectId);
  if (!staff) throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid MCP authorization link");
  await assertEmailAuthCapabilityEmail({ signingSecret: payload.signingSecret, capability, currentEmail: staff.email });
  const session = await prepareSessionRow(
    db,
    { table: "sessions", subjectColumn: "user_id" },
    staff.id,
    payload.sessionTtlHours,
  );
  const verifiedAt = nowIso();
  await commitEmailAuthRedemption(db, {
    purpose: "mcp_oauth_sign_in",
    capabilityId: capability.capabilityId,
    actorType: "user",
    actorId: staff.id,
    action: "mcp_oauth_link_verified",
    entityType: "mcp_session",
    entityId: session.sessionId,
    details: { expiresAt: session.expiresAt },
    createdAt: verifiedAt,
    authorizationEvidence: staffSignInAuthorizationEvidence(staff.id, normalizeEmail(staff.email)),
    statements: [
      prepareVerifyPrimaryEmailStatement(db, {
        userId: staff.id,
        normalizedEmail: normalizeEmail(staff.email),
        method: "magic_link",
        verifiedAt,
      }),
      ...(await prepareVerifiedDomainAssociationStatements(db, {
        userId: staff.id,
        normalizedEmail: normalizeEmail(staff.email),
        at: verifiedAt,
      })),
      session.statement as StatementLike,
    ],
  });
  if (!capability.returnTo) throw new AppError(400, "MAGIC_LINK_INVALID", "Missing MCP authorization return path");
  return {
    staff: toStaff(staff),
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    returnTo: capability.returnTo,
  };
}
