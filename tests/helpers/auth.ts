import { sha256Hex } from "../../functions/_lib/utils/crypto";
import { nowIso, addHours } from "../../functions/_lib/utils/time";
import { signAdminSessionToken } from "../../functions/_lib/auth/admin";
import { signMemberSessionToken } from "../../functions/_lib/auth/member";
import { AUTH_SCOPES } from "../../functions/_lib/auth/scopes";
import { first } from "../../functions/_lib/db/queries";
import type { DatabaseLike } from "../../functions/_lib/types";
import { env } from "cloudflare:test";

/**
 * Signs a session token whose `scopes` claim matches `adminUserId`'s real DB
 * role (see issueAdminSession's `role === "admin" ? AUTH_SCOPES : []`
 * convention in functions/_lib/auth/admin.ts) instead of always granting the
 * full legacy AUTH_SCOPES set regardless of role — P4-R01: a hardcoded
 * `role: "admin"` here would silently no-op any test asserting legacy-scope
 * denial for a non-admin-role user, since getAdminBySessionClaims trusts the
 * token's own `scopes` claim rather than re-deriving it from the DB.
 */
export async function createAdminSession(
  db: DatabaseLike,
  adminUserId: string,
  rawToken: string,
  signingSecret: string = env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret",
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

  const userRow = await first<{ email: string; role: string }>(
    db,
    "SELECT email, role FROM users WHERE id = ?",
    [adminUserId],
  );
  const role = userRow?.role ?? "admin";
  const email = userRow?.email ?? "admin@example.test";

  return signAdminSessionToken(signingSecret, {
    admin: { id: adminUserId, email, role, scopes: role === "admin" ? [...AUTH_SCOPES] : [] },
    sessionId,
    expiresAt,
  });
}

/** member-facing session — mirrors createAdminSession's shape. */
export async function createMemberSession(
  db: DatabaseLike,
  userId: string,
  rawToken: string,
  signingSecret: string = env.INTERNAL_SIGNING_SECRET ?? "test-signing-secret",
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

  return signMemberSessionToken(signingSecret, { userId, sessionId, expiresAt });
}
