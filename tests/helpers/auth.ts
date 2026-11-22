import { sha256Hex } from "../../functions/_lib/utils/crypto";
import { nowIso, addHours } from "../../functions/_lib/utils/time";
import { signUserSessionToken } from "../../functions/_lib/auth/user-session";
import { signMcpSessionToken } from "../../functions/_lib/auth/mcp-session";
import { prepareAccountIdentityStatement } from "../../functions/_lib/services/users";
import { normalizeEmail } from "../../functions/_lib/validation";
import { buildCreateIdentityStatement } from "../../functions/_lib/services/membership/identities";
import { insertOrganization } from "./membership";
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
  identityId?: string | null,
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
    identityId,
  });
}

/** Creates an explicitly marked, scope-restricted MCP machine session. */
export async function createMcpSession(
  db: DatabaseLike,
  user: { id: string; email: string },
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
  identityId?: string | null,
): Promise<string> {
  let selectedIdentityId = identityId;
  if (selectedIdentityId === undefined) {
    const activeIdentities = await db
      .prepare(
        `SELECT id FROM identities
          WHERE user_id = ? AND started_at IS NOT NULL
            AND ended_at IS NULL AND blocked_at IS NULL
          ORDER BY id`,
      )
      .bind(userId)
      .all<{ id: string }>();
    if (activeIdentities.results.length > 1) {
      throw new Error("createMemberSession requires an explicit identityId when the user has multiple identities");
    }
    selectedIdentityId = activeIdentities.results[0]?.id ?? null;
  }
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
    identityId: selectedIdentityId,
  });
}

export interface SignedInRegistrant {
  userId: string;
  /** The identity the session acts as; a work address registers with it as `identityId`. */
  identityId: string;
  session: string;
  /** Request headers that carry the session. */
  headers: { authorization: string };
}

/**
 * A person signed in to the portal, as sign-up or sign-in leaves them before
 * they register for an event. An address that already has an account reuses it
 * and keeps its saved names; a new account starts with a proven mailbox. A work
 * address represents an organization, so `organization` gives the person an
 * identity there; otherwise they act as their account identity.
 */
export async function signInRegistrant(
  db: DatabaseLike,
  email: string,
  options: { firstName?: string | null; lastName?: string | null; organization?: string; jobTitle?: string } = {},
): Promise<SignedInRegistrant> {
  const normalizedEmail = normalizeEmail(email);
  const existing = await db
    .prepare("SELECT id FROM users WHERE normalized_email = ?")
    .bind(normalizedEmail)
    .first<{ id: string }>();
  const userId = existing?.id ?? crypto.randomUUID();
  const now = nowIso();
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, active, email_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        userId,
        email.trim(),
        normalizedEmail,
        options.firstName === undefined ? "Test" : options.firstName,
        options.lastName === undefined ? "User" : options.lastName,
        now,
        now,
        now,
      )
      .run();
  }
  let identityId: string;
  const heldThere = options.organization
    ? await db
        .prepare(
          `SELECT identity.id FROM identities identity
             JOIN organizations organization ON organization.id = identity.organization_id
            WHERE identity.user_id = ? AND organization.normalized_name = ?
              AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL
            LIMIT 1`,
        )
        .bind(userId, options.organization.toLowerCase())
        .first<{ id: string }>()
    : null;
  if (heldThere) {
    identityId = heldThere.id;
  } else if (options.organization) {
    const organizationId = await insertOrganization(db, options.organization);
    const identity = await buildCreateIdentityStatement(db, {
      userId,
      organizationId,
      source: "staff",
      jobTitle: options.jobTitle ?? "Engineer",
      startImmediately: true,
    });
    await db.batch([identity.statement]);
    identityId = identity.identityId;
  } else {
    const active = await db
      .prepare(
        `SELECT id FROM identities
          WHERE user_id = ? AND organization_id IS NULL AND started_at IS NOT NULL
            AND ended_at IS NULL AND blocked_at IS NULL
          LIMIT 1`,
      )
      .bind(userId)
      .first<{ id: string }>();
    if (active) identityId = active.id;
    else {
      await prepareAccountIdentityStatement(db, userId, now).run();
      const created = await db
        .prepare("SELECT id FROM identities WHERE user_id = ? AND source = 'account' ORDER BY created_at DESC LIMIT 1")
        .bind(userId)
        .first<{ id: string }>();
      identityId = created!.id;
    }
  }
  const session = await createMemberSession(db, userId, `registrant-${crypto.randomUUID()}`, undefined, identityId);
  return { userId, identityId, session, headers: { authorization: `Bearer ${session}` } };
}
