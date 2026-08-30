import { sha256Hex } from "../../functions/_lib/utils/crypto";
import { nowIso, addHours } from "../../functions/_lib/utils/time";
import { signUserSessionToken } from "../../functions/_lib/auth/user-session";
import { signMcpSessionToken } from "../../functions/_lib/auth/mcp-session";
import type { AuthScope } from "../../functions/_lib/auth/scopes";
import type { DatabaseLike } from "../../functions/_lib/types";
import { env } from "cloudflare:test";

/**
 * Creates a canonical user session for a staff fixture. Staff permissions are
 * resolved from live D1 and are never encoded in the user JWT.
 */
export async function createAdminSession(
  db: DatabaseLike,
  adminUserId: string,
  rawToken: string,
  signingSecret: string = env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret",
  memberId?: string | null,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const tokenHash = await sha256Hex(rawToken);
  const now = nowIso();
  const expiresAt = addHours(now, 8);
  await db
    .prepare(
      `
    INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?);
  `,
    )
    .bind(sessionId, adminUserId, tokenHash, expiresAt, now)
    .run();

  return signUserSessionToken(signingSecret, {
    sub: adminUserId,
    sid: sessionId,
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
    memberId,
  });
}

/** Creates an explicitly marked, scope-restricted MCP machine session. */
export async function createMcpSession(
  db: DatabaseLike,
  user: { id: string; email: string; role: string },
  rawToken: string,
  scopes: readonly AuthScope[],
  signingSecret: string = env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret",
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const tokenHash = await sha256Hex(rawToken);
  const now = nowIso();
  const expiresAt = addHours(now, 8);
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    )
    .bind(sessionId, user.id, tokenHash, expiresAt, now)
    .run();

  return signMcpSessionToken(signingSecret, {
    sub: user.id,
    sid: sessionId,
    email: user.email,
    role: user.role,
    scopes: [...scopes],
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
  });
}

/** Canonical user session whose live capacity is an active membership. */
export async function createMemberSession(
  db: DatabaseLike,
  userId: string,
  rawToken: string,
  signingSecret: string = env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret",
  memberId?: string | null,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const tokenHash = await sha256Hex(rawToken);
  const now = nowIso();
  const expiresAt = addHours(now, 24 * 30);
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)`,
    )
    .bind(sessionId, userId, tokenHash, expiresAt, now)
    .run();

  return signUserSessionToken(signingSecret, {
    sub: userId,
    sid: sessionId,
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
    memberId,
  });
}
