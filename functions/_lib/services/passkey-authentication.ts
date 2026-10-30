/** Passkey (WebAuthn) authentication: the sign-in ceremony and its session. */
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, WebAuthnCredential } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { z } from "zod";
import { AppError } from "../errors";
import { first } from "../db/queries";
import { nowIso } from "../utils/time";
import { normalizeEmail } from "../validation";
import { resolveIdentityCapacities } from "../auth/identity-capacities";
import { resolveSessionActingIdentityId } from "../../../assets/shared/session-acting-identity";
import { recordAuditActingIdentity } from "./audit-actor";
import {
  createEstablishedUserSessionResult,
  prepareUserSession,
  signUserSessionToken,
  type UserSessionResult,
} from "../auth/user-session";
import { resolveMemberSessionTtlHours } from "../auth/session-policy";
import { signInCapacityAuthorizationEvidence } from "../auth/sign-in-capacity-authorization";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { sessionExpiresAtToExp } from "../auth/session-engine";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "./audit";
import type { authenticationResponseSchema } from "../../../assets/shared/schemas/passkeys";
import type { DatabaseLike, Env } from "../types";
import {
  issuePasskeyChallengeToken,
  passkeyChallengeAlreadyUsedError,
  prepareConsumePasskeyChallenge,
  prepareExpiredPasskeyChallengeCleanup,
  toPasskeyChallengeUse,
  verifyPasskeyChallengeToken,
  wasPasskeyChallengeConsumed,
} from "./passkey-challenges";
import {
  expectedPasskeyOrigin,
  PASSKEY_USER_VERIFICATION_POLICY,
  requireEnvVar,
  type WebAuthnEnv,
} from "./passkey-webauthn";
import { PASSKEY_CREDENTIAL_COLUMNS, type PasskeyCredentialRow } from "./passkeys";

// The route layer validates the WebAuthn response shape with Zod before it
// reaches here; see passkey-registration.ts for why it is cast to the
// library's precise type.
type AuthenticationResponseInput = z.infer<typeof authenticationResponseSchema>;

export async function beginPasskeyAuthentication(
  env: WebAuthnEnv,
  requestUrl: string,
): Promise<{ options: Record<string, unknown>; challengeToken: string }> {
  expectedPasskeyOrigin(env, requestUrl);
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
    userVerification: PASSKEY_USER_VERIFICATION_POLICY.preference,
  });

  const challengeToken = await issuePasskeyChallengeToken(signingSecret, "authentication", options.challenge);

  return { options: options as unknown as Record<string, unknown>, challengeToken };
}

export interface PasskeyAuthenticationResult {
  session: UserSessionResult;
  token: string;
}

export async function completePasskeyAuthentication(
  db: DatabaseLike,
  env: WebAuthnEnv & Pick<Env, "MEMBER_SESSION_TTL_HOURS">,
  requestUrl: string,
  payload: { challengeToken: string; response: AuthenticationResponseInput },
): Promise<PasskeyAuthenticationResult> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const origin = expectedPasskeyOrigin(env, requestUrl);
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
    requireUserVerification: PASSKEY_USER_VERIFICATION_POLICY.required,
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
  const prepared = await prepareUserSession(
    db,
    resolved.identity.id,
    resolveMemberSessionTtlHours(env.MEMBER_SESSION_TTL_HOURS),
  );
  const capacities: Array<"admin" | "member" | "sponsor" | "identity_invitation" | "event_participant" | "identity"> = [
    ...(resolved.staff ? ["admin" as const] : []),
    ...(resolved.memberships.length > 0 ? ["member" as const] : []),
    ...(resolved.sponsors.length > 0 ? ["sponsor" as const] : []),
    ...(resolved.pendingIdentityCount > 0 ? ["identity_invitation" as const] : []),
    ...(resolved.eventParticipation ? ["event_participant" as const] : []),
    ...(resolved.hasActiveIdentity ? ["identity" as const] : []),
  ];

  const lastUsedAt = nowIso();
  const challenge = toPasskeyChallengeUse(claims);
  const persistAuthentication = async (input: {
    actorType: "user";
    actorId: string;
    auditSessionId: string;
    expiresAt: string;
    capacities: Array<"admin" | "member" | "sponsor" | "identity_invitation" | "event_participant" | "identity">;
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
        ...signInCapacityAuthorizationEvidence(resolved, normalizeEmail(resolved.identity.email)).map((evidence) =>
          prepareAuthorizationGuard(db, evidence),
        ),
        ...prepared.statements,
        prepareExpiredPasskeyChallengeCleanup(db, lastUsedAt),
      ]);
    } catch (error) {
      if (await wasPasskeyChallengeConsumed(db, challenge.challengeId)) {
        throw passkeyChallengeAlreadyUsedError();
      }
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(403, "AUTH_FORBIDDEN", "This account's sign-in authority changed while authenticating");
      }
      if (isAuditChangeGuardFailure(error)) {
        throw new AppError(
          400,
          "PASSKEY_SIGN_COUNT_REUSED",
          "Passkey sign count did not increase; possible replay or clone",
        );
      }
      throw error;
    }
  };

  recordAuditActingIdentity(resolved.identity.id, resolveSessionActingIdentityId(resolved.actingIdentities, null));
  await persistAuthentication({
    actorType: "user",
    actorId: credentialRow.user_id,
    auditSessionId: prepared.sessionId,
    expiresAt: prepared.expiresAt,
    capacities,
  });
  const session: UserSessionResult = await createEstablishedUserSessionResult(db, prepared, {
    identity: resolved.identity,
    staff: resolved.staff,
    memberships: resolved.memberships,
    sponsors: resolved.sponsors,
    pendingIdentityCount: resolved.pendingIdentityCount,
    eventParticipation: resolved.eventParticipation,
    actingIdentities: resolved.actingIdentities,
  });
  const token = await signUserSessionToken(signingSecret, {
    sub: resolved.identity.id,
    sid: prepared.sessionId,
    exp: sessionExpiresAtToExp(prepared.expiresAt),
    identityId: session.actingIdentityId,
  });
  return { session, token };
}
