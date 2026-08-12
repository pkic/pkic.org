import { sha256Hex } from "../../functions/_lib/utils/crypto";
import { nowIso, addHours } from "../../functions/_lib/utils/time";
import { signAdminSessionToken } from "../../functions/_lib/auth/admin";
import { signMemberSessionToken } from "../../functions/_lib/auth/member";
import type { DatabaseLike } from "../../functions/_lib/types";
import { env } from "cloudflare:test";

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

  return signAdminSessionToken(signingSecret, {
    admin: { id: adminUserId, email: "admin@example.test", role: "admin" },
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
