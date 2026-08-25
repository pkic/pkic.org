/**
 * Passkey (WebAuthn) registration and authentication.
 *
 * The WebAuthn ceremony's server-held challenge is carried statelessly in a
 * short-lived signed JWT rather than a new DB table — see consolidated migration 0035's
 * header comment for the rationale.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { z } from "zod";
import { AppError } from "../errors";
import { all, first } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import {
  prepareIdentityCapacitySessions,
  resolveIdentityCapacities,
  type PreparedIdentityCapacitySessions,
} from "../auth/identity-capacities";
import { isAuditOneChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "./audit";
import { MAX_PASSKEY_CREDENTIALS_PER_USER } from "../../../assets/shared/constants/passkeys";
import type { authenticationResponseSchema, registrationResponseSchema } from "../../../assets/shared/schemas/passkeys";
import type { DatabaseLike, Env, StatementLike } from "../types";
import {
  issuePasskeyChallengeToken,
  passkeyChallengeAlreadyUsedError,
  prepareConsumePasskeyChallenge,
  prepareExpiredPasskeyChallengeCleanup,
  toPasskeyChallengeUse,
  verifyPasskeyChallengeToken,
  wasPasskeyChallengeConsumed,
  type PasskeyChallengeUse,
} from "./passkey-challenges";

// The route layer validates the WebAuthn response shape with Zod
// (assets/shared/schemas/passkeys.ts) before it reaches here; that schema is
// deliberately looser than @simplewebauthn/server's own types (e.g.
// `clientExtensionResults` as a generic record), so the verified value is
// cast to the library's precise type at the point it's handed to it.
type RegistrationResponseInput = z.infer<typeof registrationResponseSchema>;
type AuthenticationResponseInput = z.infer<typeof authenticationResponseSchema>;

const PASSKEY_CREDENTIAL_COLUMNS =
  "id, user_id, credential_id, public_key, sign_count, aaguid, device_name, last_used_at, created_at, revoked_at";

function requireEnvVar(value: string | undefined, name: string): string {
  if (!value) {
    throw new AppError(500, "WEBAUTHN_CONFIG_MISSING", `${name} is not configured`);
  }
  return value;
}

interface PasskeyCredentialRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  aaguid: string | null;
  device_name: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface PasskeySummary {
  id: string;
  deviceName: string | null;
  aaguid: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface VerifiedPasskeyCredentialInput {
  credentialId: string;
  publicKey: string;
  signCount: number;
  aaguid: string | null;
  deviceName: string | null;
}

function toSummary(row: PasskeyCredentialRow): PasskeySummary {
  return {
    id: row.id,
    deviceName: row.device_name,
    aaguid: row.aaguid,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

type WebAuthnEnv = Pick<Env, "WEBAUTHN_RP_ID" | "WEBAUTHN_RP_NAME" | "WEBAUTHN_ORIGIN" | "INTERNAL_SIGNING_SECRET">;

export async function beginPasskeyRegistration(
  db: DatabaseLike,
  env: WebAuthnEnv,
  actor: { id: string; email: string },
): Promise<{ options: Record<string, unknown>; challengeToken: string }> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const rpName = requireEnvVar(env.WEBAUTHN_RP_NAME, "WEBAUTHN_RP_NAME");
  const signingSecret = requireEnvVar(env.INTERNAL_SIGNING_SECRET, "INTERNAL_SIGNING_SECRET");

  const existing = await all<{ credential_id: string }>(
    db,
    "SELECT credential_id FROM passkey_credentials WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC, id ASC LIMIT ?",
    [actor.id, MAX_PASSKEY_CREDENTIALS_PER_USER],
  );
  if (existing.length >= MAX_PASSKEY_CREDENTIALS_PER_USER) {
    throw new AppError(
      409,
      "PASSKEY_LIMIT_REACHED",
      `Each account can have at most ${MAX_PASSKEY_CREDENTIALS_PER_USER} active passkeys`,
    );
  }

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: actor.email,
    userID: new TextEncoder().encode(actor.id),
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({ id: row.credential_id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const challengeToken = await issuePasskeyChallengeToken(signingSecret, "registration", options.challenge, actor.id);

  return { options: options as unknown as Record<string, unknown>, challengeToken };
}

export async function completePasskeyRegistration(
  db: DatabaseLike,
  env: WebAuthnEnv,
  actor: { id: string; kind: "admin" | "member" },
  payload: { challengeToken: string; response: RegistrationResponseInput; deviceName?: string | null },
): Promise<PasskeySummary> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const origin = requireEnvVar(env.WEBAUTHN_ORIGIN, "WEBAUTHN_ORIGIN");
  const signingSecret = requireEnvVar(env.INTERNAL_SIGNING_SECRET, "INTERNAL_SIGNING_SECRET");

  const claims = await verifyPasskeyChallengeToken(signingSecret, payload.challengeToken, "registration");
  if (claims.userId !== actor.id) {
    throw new AppError(400, "PASSKEY_CHALLENGE_INVALID", "Passkey challenge does not match the authenticated user");
  }
  if (await wasPasskeyChallengeConsumed(db, claims.challengeId)) {
    throw passkeyChallengeAlreadyUsedError();
  }

  const verification = await verifyRegistrationResponse({
    response: payload.response as unknown as RegistrationResponseJSON,
    expectedChallenge: claims.challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
  }).catch((err: unknown) => {
    throw new AppError(
      400,
      "PASSKEY_CREDENTIAL_INVALID",
      err instanceof Error ? err.message : "Invalid passkey credential",
    );
  });

  if (!verification.verified) {
    throw new AppError(400, "PASSKEY_CREDENTIAL_INVALID", "Passkey credential could not be verified");
  }

  const { credential, aaguid } = verification.registrationInfo;
  return persistVerifiedPasskeyCredential(
    db,
    actor,
    {
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      signCount: credential.counter,
      aaguid,
      deviceName: payload.deviceName ?? null,
    },
    toPasskeyChallengeUse(claims),
  );
}

/**
 * Persists an already verified WebAuthn credential. The cap predicate and
 * insert execute as one SQLite statement, so concurrent ceremonies cannot
 * both claim the final slot. The OFFSET probe touches at most the configured
 * cap through the partial active-credential index, including for legacy
 * overfull accounts.
 */
export async function persistVerifiedPasskeyCredential(
  db: DatabaseLike,
  actor: { id: string; kind: "admin" | "member" },
  credential: VerifiedPasskeyCredentialInput,
  challenge?: PasskeyChallengeUse,
): Promise<PasskeySummary> {
  const findDuplicate = () =>
    first<{ id: string }>(db, "SELECT id FROM passkey_credentials WHERE credential_id = ? LIMIT 1", [
      credential.credentialId,
    ]);
  if (await findDuplicate()) {
    throw new AppError(409, "PASSKEY_ALREADY_REGISTERED", "This passkey is already registered");
  }

  const id = uuid();
  const now = nowIso();

  try {
    await db.batch([
      ...(challenge ? [prepareConsumePasskeyChallenge(db, challenge, now)] : []),
      db
        .prepare(
          `INSERT INTO passkey_credentials (
             id, user_id, credential_id, public_key, sign_count, aaguid, device_name,
             last_used_at, created_at, revoked_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL
           WHERE NOT EXISTS (
             SELECT 1 FROM passkey_credentials
             WHERE user_id = ? AND revoked_at IS NULL
             ORDER BY created_at ASC, id ASC
             LIMIT 1 OFFSET ?
           )`,
        )
        .bind(
          id,
          actor.id,
          credential.credentialId,
          credential.publicKey,
          credential.signCount,
          credential.aaguid,
          credential.deviceName,
          now,
          actor.id,
          MAX_PASSKEY_CREDENTIALS_PER_USER - 1,
        ),
      prepareAuditLogAfterOneChange(
        db,
        actor.kind,
        actor.id,
        "passkey_registered",
        "passkey_credential",
        id,
        { deviceName: credential.deviceName },
        now,
      ),
      ...(challenge ? [prepareExpiredPasskeyChallengeCleanup(db, now)] : []),
    ]);
  } catch (error) {
    if (challenge && (await wasPasskeyChallengeConsumed(db, challenge.challengeId))) {
      throw passkeyChallengeAlreadyUsedError();
    }
    if (isAuditOneChangeGuardFailure(error)) {
      if (await findDuplicate()) {
        throw new AppError(409, "PASSKEY_ALREADY_REGISTERED", "This passkey is already registered");
      }
      throw new AppError(
        409,
        "PASSKEY_LIMIT_REACHED",
        `Each account can have at most ${MAX_PASSKEY_CREDENTIALS_PER_USER} active passkeys`,
      );
    }
    // A different registration can win the unique credential-id race after
    // the preflight lookup but before this transaction commits.
    if (await findDuplicate()) {
      throw new AppError(409, "PASSKEY_ALREADY_REGISTERED", "This passkey is already registered");
    }
    throw error;
  }

  return {
    id,
    deviceName: credential.deviceName,
    aaguid: credential.aaguid,
    lastUsedAt: null,
    createdAt: now,
  };
}

export async function beginPasskeyAuthentication(
  env: Pick<Env, "WEBAUTHN_RP_ID" | "INTERNAL_SIGNING_SECRET">,
): Promise<{ options: Record<string, unknown>; challengeToken: string }> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const signingSecret = requireEnvVar(env.INTERNAL_SIGNING_SECRET, "INTERNAL_SIGNING_SECRET");

  // No `allowCredentials` — a usernameless/discoverable-credential flow
  // "no auth required" begin endpoint. The browser lets the user pick
  // from any resident credential; completePasskeyAuthentication resolves
  // which user it was from the assertion's own credential ID (`response.id`,
  // stored in the clear in passkey_credentials.credential_id — see migration
  // consolidated migration 0035), not from the WebAuthn `userHandle` field.
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "preferred",
  });

  const challengeToken = await issuePasskeyChallengeToken(signingSecret, "authentication", options.challenge);

  return { options: options as unknown as Record<string, unknown>, challengeToken };
}

export type PasskeyAuthenticationResult = PreparedIdentityCapacitySessions;

export async function completePasskeyAuthentication(
  db: DatabaseLike,
  env: Pick<Env, "WEBAUTHN_RP_ID" | "WEBAUTHN_ORIGIN" | "INTERNAL_SIGNING_SECRET" | "MEMBER_SESSION_TTL_HOURS">,
  payload: { challengeToken: string; response: AuthenticationResponseInput },
): Promise<PasskeyAuthenticationResult> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const origin = requireEnvVar(env.WEBAUTHN_ORIGIN, "WEBAUTHN_ORIGIN");
  const signingSecret = requireEnvVar(env.INTERNAL_SIGNING_SECRET, "INTERNAL_SIGNING_SECRET");

  const claims = await verifyPasskeyChallengeToken(signingSecret, payload.challengeToken, "authentication");
  if (await wasPasskeyChallengeConsumed(db, claims.challengeId)) {
    throw passkeyChallengeAlreadyUsedError();
  }

  const credentialRow = await first<PasskeyCredentialRow>(
    db,
    `SELECT ${PASSKEY_CREDENTIAL_COLUMNS} FROM passkey_credentials WHERE credential_id = ?`,
    [payload.response.id],
  );

  if (!credentialRow || credentialRow.revoked_at) {
    throw new AppError(400, "PASSKEY_CREDENTIAL_INVALID", "Unknown or revoked passkey credential");
  }

  const credential: WebAuthnCredential = {
    id: credentialRow.credential_id,
    publicKey: isoBase64URL.toBuffer(credentialRow.public_key),
    counter: credentialRow.sign_count,
  };

  const verification = await verifyAuthenticationResponse({
    response: payload.response as unknown as AuthenticationResponseJSON,
    expectedChallenge: claims.challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    credential,
  }).catch((err: unknown) => {
    throw new AppError(
      400,
      "PASSKEY_CREDENTIAL_INVALID",
      err instanceof Error ? err.message : "Invalid passkey assertion",
    );
  });

  if (!verification.verified) {
    throw new AppError(400, "PASSKEY_CREDENTIAL_INVALID", "Passkey assertion could not be verified");
  }

  const { newCounter } = verification.authenticationInfo;

  // Clone-attack detection: a resident/synced authenticator may
  // legitimately report 0 on every assertion (no counter support), so only a
  // *non-increasing* nonzero counter indicates a replayed/cloned credential.
  if (newCounter !== 0 && newCounter <= credentialRow.sign_count) {
    throw new AppError(
      400,
      "PASSKEY_SIGN_COUNT_REUSED",
      "Passkey sign count did not increase; possible replay or clone",
    );
  }

  const resolved = await resolveIdentityCapacities(db, credentialRow.user_id);
  if (!resolved) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account is no longer eligible to sign in");
  }
  const sessions = await prepareIdentityCapacitySessions(db, resolved, env.MEMBER_SESSION_TTL_HOURS);

  const lastUsedAt = nowIso();
  const challenge = toPasskeyChallengeUse(claims);
  const persistAuthentication = async (input: {
    actorType: "admin" | "member";
    actorId: string;
    auditSessionId: string;
    expiresAt: string;
    capacities: Array<"admin" | "member">;
    sessionStatements: StatementLike[];
  }) => {
    try {
      await db.batch([
        prepareConsumePasskeyChallenge(db, challenge, lastUsedAt),
        db
          .prepare(
            `UPDATE passkey_credentials
             SET sign_count = ?, last_used_at = ?
             WHERE id = ? AND sign_count = ? AND revoked_at IS NULL`,
          )
          .bind(newCounter, lastUsedAt, credentialRow.id, credentialRow.sign_count),
        prepareAuditLogAfterOneChange(
          db,
          input.actorType,
          input.actorId,
          "passkey_authenticated",
          "identity_session",
          input.auditSessionId,
          { capacities: input.capacities, expiresAt: input.expiresAt },
          lastUsedAt,
        ),
        ...input.sessionStatements,
        prepareExpiredPasskeyChallengeCleanup(db, lastUsedAt),
      ]);
    } catch (error) {
      if (await wasPasskeyChallengeConsumed(db, challenge.challengeId)) {
        throw passkeyChallengeAlreadyUsedError();
      }
      if (isAuditOneChangeGuardFailure(error)) {
        throw new AppError(
          400,
          "PASSKEY_SIGN_COUNT_REUSED",
          "Passkey sign count did not increase; possible replay or clone",
        );
      }
      throw error;
    }
  };

  await persistAuthentication({
    actorType: sessions.admin ? "admin" : "member",
    actorId: credentialRow.user_id,
    auditSessionId: (sessions.admin ?? sessions.member)!.sessionId,
    expiresAt: sessions.expiresAt,
    capacities: [...(sessions.admin ? (["admin"] as const) : []), ...(sessions.member ? (["member"] as const) : [])],
    sessionStatements: [sessions.admin?.statement, sessions.member?.statement].filter(
      (statement): statement is StatementLike => Boolean(statement),
    ),
  });
  return sessions;
}

export async function listPasskeysForUser(db: DatabaseLike, userId: string): Promise<PasskeySummary[]> {
  const rows = await all<PasskeyCredentialRow>(
    db,
    `SELECT ${PASSKEY_CREDENTIAL_COLUMNS}
     FROM passkey_credentials
     WHERE user_id = ? AND revoked_at IS NULL
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [userId, MAX_PASSKEY_CREDENTIALS_PER_USER],
  );
  return rows.map(toSummary);
}

export async function revokePasskey(
  db: DatabaseLike,
  actor: { id: string; kind: "admin" | "member" },
  passkeyId: string,
): Promise<void> {
  const row = await first<{ id: string; user_id: string }>(
    db,
    "SELECT id, user_id FROM passkey_credentials WHERE id = ? AND revoked_at IS NULL",
    [passkeyId],
  );

  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Passkey not found");
  }

  if (row.user_id !== actor.id) {
    throw new AppError(403, "PERMISSION_REQUIRED", "Cannot remove another user's passkey");
  }

  await db.batch([
    db.prepare("UPDATE passkey_credentials SET revoked_at = ? WHERE id = ?").bind(nowIso(), passkeyId),
    prepareAuditLog(db, actor.kind, actor.id, "passkey_removed", "passkey_credential", passkeyId, {}),
  ]);
}
