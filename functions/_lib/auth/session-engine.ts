/**
 * Shared session/magic-link mechanism used by admin.ts, member.ts, and
 * sponsor-portal.ts. Extracts what was byte-identical (or identical in
 * shape, differing only by table/column name) across all three: cookie
 * parsing, bearer extraction, cookie serialization, JWT claims'
 * typ/sub/sid/exp base shape, session-row issue/fetch/revoke, and
 * magic-link-row issue/validate/consume.
 *
 * Deliberately NOT unified: each module's eligibility query (who may hold a
 * session at all) and its magic-link lookup. Admin re-checks eligibility
 * *at* magic-link lookup time (a JOIN against STAFF_ACCESS_CONDITION in the
 * WHERE clause, so a link found while temporarily ineligible is never
 * consumed and can still work later if eligibility is restored before
 * expiry); member/sponsor-portal look the link up first, consume it, then
 * separately re-check eligibility. Forcing admin into the two-step shape
 * would silently change that behavior (burn the token even when the
 * eventual re-check fails), so admin keeps its own JOIN'd lookup and only
 * hands the fetched row to `validateAndConsumeMagicLinkRow` below. Trust
 * boundaries (who's eligible, what a session grants) stay separate per
 * module; only the mechanism is shared.
 */
import { AppError } from "../errors";
import { first, run } from "../db/queries";
import { nowIso, addMinutes, addHours } from "../utils/time";
import { randomToken, sha256Hex } from "../utils/crypto";
import { uuid } from "../utils/ids";
import type { DatabaseLike } from "../types";

// ── Cookie / bearer token transport ─────────────────────────────────────────

export function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!name) continue;
    values.set(name, decodeURIComponent(value));
  }
  return values;
}

export function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function getSessionCookieToken(request: Request, cookieName: string): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (!cookieHeader) return null;
  return parseCookieHeader(cookieHeader).get(cookieName) ?? null;
}

export function serializeSessionCookie(
  cookieName: string,
  cookiePath: string,
  token: string,
  request: Request,
): string {
  const parts = [`${cookieName}=${encodeURIComponent(token)}`, `Path=${cookiePath}`, "HttpOnly", "SameSite=Strict"];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

export function serializeExpiredSessionCookie(cookieName: string, cookiePath: string, request: Request): string {
  const parts = [
    `${cookieName}=`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

export function sessionExpiresAtToExp(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid expiresAt timestamp: ${expiresAt}`);
  }
  return Math.floor(ms / 1000);
}

// ── Session-token claims base shape (typ/sub/sid/exp) ───────────────────────

export interface BaseSessionTokenClaims {
  typ: string;
  sub: string;
  sid: string;
  exp: number;
}

/** Each module's own `is*Claims` type guard calls this for the shared base fields, then checks its own extras (if any). */
export function hasBaseSessionTokenClaims(claims: object, expectedTyp: string): claims is BaseSessionTokenClaims {
  const candidate = claims as Partial<BaseSessionTokenClaims>;
  return (
    candidate.typ === expectedTyp &&
    typeof candidate.sub === "string" &&
    typeof candidate.sid === "string" &&
    typeof candidate.exp === "number"
  );
}

// ── Session rows (`sessions` for admin/member, `sponsor_portal_sessions`) ──

export interface SessionTableConfig {
  table: string;
  subjectColumn: string;
}

/** Generic session-row INSERT — same shape across admin/member/sponsor-portal, differing only by table + subject column. */
export async function insertSessionRow(
  db: DatabaseLike,
  config: SessionTableConfig,
  subjectId: string,
  sessionTtlHours: number,
): Promise<{ sessionId: string; expiresAt: string }> {
  const sessionId = uuid();
  const sessionHash = await sha256Hex(randomToken(24));
  const expiresAt = addHours(nowIso(), sessionTtlHours);

  await run(
    db,
    `INSERT INTO ${config.table} (id, ${config.subjectColumn}, token_hash, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [sessionId, subjectId, sessionHash, expiresAt, nowIso()],
  );

  return { sessionId, expiresAt };
}

export interface PlainSessionRow {
  id: string;
  subjectId: string;
  expiresAt: string;
  revokedAt: string | null;
}

/** Plain session-row SELECT (no eligibility join) — used by member/sponsor-portal, which re-check eligibility separately after this. */
export async function fetchSessionRow(
  db: DatabaseLike,
  config: SessionTableConfig,
  sessionId: string,
  subjectId: string,
): Promise<PlainSessionRow | null> {
  const row = await first<{ id: string; subject_id: string; expires_at: string; revoked_at: string | null }>(
    db,
    `SELECT id, ${config.subjectColumn} AS subject_id, expires_at, revoked_at FROM ${config.table} WHERE id = ? AND ${config.subjectColumn} = ?`,
    [sessionId, subjectId],
  );
  if (!row) return null;
  return { id: row.id, subjectId: row.subject_id, expiresAt: row.expires_at, revokedAt: row.revoked_at };
}

/** Throws the standardized 401 AUTH_INVALID/AUTH_REVOKED/AUTH_EXPIRED trio — same codes and logic everywhere, message text parameterized by entity label. */
export function assertSessionActive<T extends { revokedAt: string | null; expiresAt: string }>(
  row: T | null,
  entityLabel: string,
): T {
  if (!row) {
    throw new AppError(401, "AUTH_INVALID", `Invalid ${entityLabel} session token`);
  }
  if (row.revokedAt) {
    throw new AppError(
      401,
      "AUTH_REVOKED",
      `${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} session is revoked`,
    );
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new AppError(401, "AUTH_EXPIRED", `${entityLabel[0].toUpperCase()}${entityLabel.slice(1)} session expired`);
  }
  return row;
}

export async function revokeSessionRow(db: DatabaseLike, table: string, sessionId: string): Promise<void> {
  await run(db, `UPDATE ${table} SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?`, [nowIso(), sessionId]);
}

// ── Magic-link rows (`auth_magic_links` for admin/member, `sponsor_portal_magic_links`) ──

export interface MagicLinkTableConfig {
  table: string;
  subjectColumn: string;
}

/** Generic magic-link-row INSERT — same shape across all three. Returns the raw (unhashed) token to email to the recipient. */
export async function insertMagicLinkRow(
  db: DatabaseLike,
  config: MagicLinkTableConfig,
  subjectId: string,
  payload: { ttlMinutes: number; ipHash?: string | null; userAgentHash?: string | null },
): Promise<string> {
  const token = randomToken(24);
  const tokenHash = await sha256Hex(token);
  const now = nowIso();

  await run(
    db,
    `INSERT INTO ${config.table} (
      id, ${config.subjectColumn}, token_hash, expires_at, used_at, request_ip_hash, user_agent_hash, created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      uuid(),
      subjectId,
      tokenHash,
      addMinutes(now, payload.ttlMinutes),
      payload.ipHash ?? null,
      payload.userAgentHash ?? null,
      now,
    ],
  );

  return token;
}

export interface PlainMagicLinkRow {
  id: string;
  subjectId: string;
  expiresAt: string;
  usedAt: string | null;
  requestIpHash: string | null;
  userAgentHash: string | null;
}

/** Plain magic-link-row SELECT by token hash (no eligibility join) — used by member/sponsor-portal. */
export async function fetchMagicLinkRowByToken(
  db: DatabaseLike,
  config: MagicLinkTableConfig,
  token: string,
): Promise<PlainMagicLinkRow | null> {
  const tokenHash = await sha256Hex(token);
  const row = await first<{
    id: string;
    subject_id: string;
    expires_at: string;
    used_at: string | null;
    request_ip_hash: string | null;
    user_agent_hash: string | null;
  }>(
    db,
    `SELECT id, ${config.subjectColumn} AS subject_id, expires_at, used_at, request_ip_hash, user_agent_hash
     FROM ${config.table} WHERE token_hash = ?`,
    [tokenHash],
  );
  if (!row) return null;
  return {
    id: row.id,
    subjectId: row.subject_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    requestIpHash: row.request_ip_hash,
    userAgentHash: row.user_agent_hash,
  };
}

/**
 * Validates an already-fetched magic-link row (used_at/expires_at/ip/UA
 * context) and atomically consumes it. Shared by all three modules — admin
 * passes in the row from its own eligibility-JOIN'd lookup; member/
 * sponsor-portal pass in the row from `fetchMagicLinkRowByToken`.
 */
export async function validateAndConsumeMagicLinkRow(
  db: DatabaseLike,
  table: string,
  row: {
    id: string;
    expiresAt: string;
    usedAt: string | null;
    requestIpHash: string | null;
    userAgentHash: string | null;
  },
  payload: { ipHash?: string | null; userAgentHash?: string | null },
): Promise<void> {
  if (row.usedAt) {
    throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new AppError(410, "MAGIC_LINK_EXPIRED", "Magic link expired");
  }
  if (row.requestIpHash && row.requestIpHash !== payload.ipHash) {
    throw new AppError(403, "MAGIC_LINK_CONTEXT_MISMATCH", "Magic link is not valid from this network");
  }
  if (row.userAgentHash && row.userAgentHash !== payload.userAgentHash) {
    throw new AppError(403, "MAGIC_LINK_CONTEXT_MISMATCH", "Magic link is not valid from this browser");
  }

  // Atomic consume to prevent TOCTOU race: only the request that flips used_at
  // from NULL wins. Other concurrent verifications get MAGIC_LINK_USED.
  const consume = await run(db, `UPDATE ${table} SET used_at = ? WHERE id = ? AND used_at IS NULL`, [nowIso(), row.id]);
  if (consume.changes === 0) {
    throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
  }
}
