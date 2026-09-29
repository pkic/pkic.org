/**
 * Shared revocable-session mechanism used by admin.ts, member.ts, and
 * user-session.ts. Capacity-specific eligibility and authorization remain
 * separate; cookie transport, JWT claim shape, and session-row lifecycle are
 * centralized here.
 */
import { AppError } from "../errors";
import { first, run } from "../db/queries";
import { nowIso, addHours } from "../utils/time";
import { randomToken, sha256Hex } from "../utils/crypto";
import { uuid } from "../utils/ids";
import type { DatabaseLike, StatementLike } from "../types";

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
    try {
      values.set(name, decodeURIComponent(value));
    } catch {
      // Cookie headers are attacker-controlled. Ignore only the malformed
      // pair so one invalid percent escape cannot turn every auth surface
      // using this shared parser into an unhandled 500 response.
    }
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

// ── Session rows ──

export interface SessionTableConfig {
  table: string;
  subjectColumn: string;
}

/** Generic session-row INSERT — table and subject column are explicit. */
export async function prepareSessionRow(
  db: DatabaseLike,
  config: SessionTableConfig,
  subjectId: string,
  sessionTtlHours: number,
): Promise<{ sessionId: string; expiresAt: string; createdAt: string; statement: StatementLike }> {
  const sessionId = uuid();
  const sessionHash = await sha256Hex(randomToken(24));
  const now = nowIso();
  const expiresAt = addHours(nowIso(), sessionTtlHours);

  return {
    sessionId,
    expiresAt,
    createdAt: now,
    statement: db
      .prepare(
        `INSERT INTO ${config.table} (id, ${config.subjectColumn}, token_hash, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .bind(sessionId, subjectId, sessionHash, expiresAt, now),
  };
}

export async function insertSessionRow(
  db: DatabaseLike,
  config: SessionTableConfig,
  subjectId: string,
  sessionTtlHours: number,
): Promise<{ sessionId: string; expiresAt: string }> {
  const prepared = await prepareSessionRow(db, config, subjectId, sessionTtlHours);
  await prepared.statement.run();
  return { sessionId: prepared.sessionId, expiresAt: prepared.expiresAt };
}

export interface PlainSessionRow {
  id: string;
  subjectId: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}

/** Plain session-row SELECT (no eligibility join); callers re-check live eligibility separately. */
export async function fetchSessionRow(
  db: DatabaseLike,
  config: SessionTableConfig,
  sessionId: string,
  subjectId: string,
): Promise<PlainSessionRow | null> {
  const row = await first<{
    id: string;
    subject_id: string;
    expires_at: string;
    created_at: string;
    revoked_at: string | null;
  }>(
    db,
    `SELECT id, ${config.subjectColumn} AS subject_id, expires_at, created_at, revoked_at FROM ${config.table} WHERE id = ? AND ${config.subjectColumn} = ?`,
    [sessionId, subjectId],
  );
  if (!row) return null;
  return {
    id: row.id,
    subjectId: row.subject_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
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

export function prepareRevokeSessionRow(db: DatabaseLike, table: string, sessionId: string): StatementLike {
  return db.prepare(`UPDATE ${table} SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?`).bind(nowIso(), sessionId);
}
