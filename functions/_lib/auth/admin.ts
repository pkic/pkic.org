import { AppError } from "../errors";
import { first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso, addMinutes, addHours } from "../utils/time";
import { randomToken, sha256Hex } from "../utils/crypto";
import { uuid } from "../utils/ids";
import type { AuthAdmin, DatabaseLike, Env } from "../types";

interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  active: number;
}

interface AdminSessionRow {
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  email: string;
  role: string;
}

export async function requireAdminFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY">,
): Promise<AuthAdmin> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing bearer token");
  }

  const token = match[1];

  // API key auth — no DB lookup needed, returns a synthetic admin identity
  if (env?.ADMIN_API_KEY && token === env.ADMIN_API_KEY) {
    return { id: "api-key", email: "api-key", role: "admin" };
  }

  return getAdminBySessionToken(db, token);
}

export async function getAdminBySessionToken(db: DatabaseLike, token: string): Promise<AuthAdmin> {
  const tokenHash = await sha256Hex(token);
  const row = await first<AdminSessionRow>(
    db,
    `SELECT s.user_id, s.expires_at, s.revoked_at, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND u.active = 1 AND u.role = 'admin'`,
    [tokenHash],
  );

  if (!row) {
    throw new AppError(401, "AUTH_INVALID", "Invalid admin session token");
  }

  if (row.revoked_at) {
    throw new AppError(401, "AUTH_REVOKED", "Admin session is revoked");
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, "AUTH_EXPIRED", "Admin session expired");
  }

  return {
    id: row.user_id,
    email: row.email,
    role: row.role,
  };
}

export async function requestAdminMagicLink(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
  },
): Promise<{ token: string | null; admin: AuthAdmin | null }> {
  const email = normalizeEmail(payload.email);
  const admin = await first<AdminUserRow>(
    db,
    "SELECT id, email, role, active FROM users WHERE normalized_email = ? AND active = 1 AND role = 'admin'",
    [email],
  );

  if (!admin) {
    return { token: null, admin: null };
  }

  const token = randomToken(24);
  const tokenHash = await sha256Hex(token);
  const now = nowIso();

  await run(
    db,
    `INSERT INTO auth_magic_links (
      id, user_id, token_hash, expires_at, used_at, request_ip_hash, user_agent_hash, created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      uuid(),
      admin.id,
      tokenHash,
      addMinutes(now, payload.ttlMinutes),
      payload.ipHash ?? null,
      payload.userAgentHash ?? null,
      now,
    ],
  );

  return {
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    },
  };
}

export async function verifyAdminMagicLink(
  db: DatabaseLike,
  payload: { token: string; sessionTtlHours: number },
): Promise<{ admin: AuthAdmin; sessionToken: string; expiresAt: string }> {
  const tokenHash = await sha256Hex(payload.token);
  const row = await first<{
    id: string;
    user_id: string;
    expires_at: string;
    used_at: string | null;
    email: string;
    role: string;
  }>(
    db,
    `SELECT m.id, m.user_id, m.expires_at, m.used_at, u.email, u.role
     FROM auth_magic_links m
     JOIN users u ON u.id = m.user_id
     WHERE m.token_hash = ? AND u.active = 1 AND u.role = 'admin'`,
    [tokenHash],
  );

  if (!row) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid admin magic link token");
  }

  if (row.used_at) {
    throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(410, "MAGIC_LINK_EXPIRED", "Magic link expired");
  }

  await run(db, "UPDATE auth_magic_links SET used_at = ? WHERE id = ?", [nowIso(), row.id]);

  const sessionToken = randomToken(24);
  const sessionHash = await sha256Hex(sessionToken);
  const expiresAt = addHours(nowIso(), payload.sessionTtlHours);

  await run(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [uuid(), row.user_id, sessionHash, expiresAt, nowIso()],
  );

  return {
    admin: {
      id: row.user_id,
      email: row.email,
      role: row.role,
    },
    sessionToken,
    expiresAt,
  };
}
