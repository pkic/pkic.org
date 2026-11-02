/** Passkey (WebAuthn) registration: the ceremony and the credential insert. */
import { generateRegistrationOptions, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { z } from "zod";
import { AppError } from "../errors";
import { all, first } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import { MAX_PASSKEY_CREDENTIALS_PER_USER } from "../../../assets/shared/constants/passkeys";
import type { registrationResponseSchema } from "../../../assets/shared/schemas/passkeys";
import type { DatabaseLike } from "../types";
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
import {
  expectedPasskeyOrigin,
  PASSKEY_USER_VERIFICATION_POLICY,
  requireEnvVar,
  type WebAuthnEnv,
} from "./passkey-webauthn";
import type { PasskeySummary } from "./passkeys";

// The route layer validates the WebAuthn response shape with Zod
// (assets/shared/schemas/passkeys.ts) before it reaches here; that schema is
// deliberately looser than @simplewebauthn/server's own types (e.g.
// `clientExtensionResults` as a generic record), so the verified value is
// cast to the library's precise type at the point it's handed to it.
type RegistrationResponseInput = z.infer<typeof registrationResponseSchema>;

export interface VerifiedPasskeyCredentialInput {
  credentialId: string;
  publicKey: string;
  signCount: number;
  aaguid: string | null;
  deviceName: string | null;
}

export async function beginPasskeyRegistration(
  db: DatabaseLike,
  env: WebAuthnEnv,
  requestUrl: string,
  actor: { id: string; email: string },
): Promise<{ options: Record<string, unknown>; challengeToken: string }> {
  expectedPasskeyOrigin(env, requestUrl);
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
    // Empty display names cause registration failures in some passkey providers.
    userDisplayName: actor.email,
    userID: new TextEncoder().encode(actor.id),
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({ id: row.credential_id })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: PASSKEY_USER_VERIFICATION_POLICY.preference,
    },
  });

  const mailbox = await first<{ normalized_email: string; email_verified_at: string | null }>(
    db,
    "SELECT normalized_email, email_verified_at FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
    [actor.id],
  );
  if (!mailbox?.email_verified_at)
    throw new AppError(403, "PASSKEY_EMAIL_UNVERIFIED", "Confirm your sign-in email before adding a passkey.");
  const challengeToken = await issuePasskeyChallengeToken(signingSecret, "registration", options.challenge, actor.id, {
    email: mailbox.normalized_email,
    verifiedAt: mailbox.email_verified_at,
  });

  return { options: options as unknown as Record<string, unknown>, challengeToken };
}

export async function completePasskeyRegistration(
  db: DatabaseLike,
  env: WebAuthnEnv,
  requestUrl: string,
  actor: { id: string; kind: "user" },
  payload: { challengeToken: string; response: RegistrationResponseInput; deviceName?: string | null },
): Promise<PasskeySummary> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const origin = expectedPasskeyOrigin(env, requestUrl);
  const signingSecret = requireEnvVar(env.INTERNAL_SIGNING_SECRET, "INTERNAL_SIGNING_SECRET");

  const claims = await verifyPasskeyChallengeToken(signingSecret, payload.challengeToken, "registration");
  if (claims.userId !== actor.id || !claims.mailbox) {
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
    requireUserVerification: PASSKEY_USER_VERIFICATION_POLICY.required,
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
  actor: { id: string; kind: "user" },
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
      ...(challenge?.mailbox
        ? [
            prepareAuthorizationGuard(db, {
              sql: "SELECT 1 FROM users WHERE id=? AND normalized_email=? AND email_verified_at=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
              bindings: [actor.id, challenge.mailbox.email, challenge.mailbox.verifiedAt],
            }),
          ]
        : []),
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
    if (isAuthorizationGuardFailure(error))
      throw new AppError(409, "PASSKEY_ACCOUNT_CHANGED", "Your account changed. Start adding the passkey again.");
    if (challenge && (await wasPasskeyChallengeConsumed(db, challenge.challengeId))) {
      throw passkeyChallengeAlreadyUsedError();
    }
    if (isAuditChangeGuardFailure(error)) {
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
