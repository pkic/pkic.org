/**
 * Phase 3 (PRD §3) passkey (WebAuthn) registration and authentication.
 *
 * The WebAuthn ceremony's server-held challenge is carried statelessly in a
 * short-lived signed JWT rather than a new DB table — see migration 0036's
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
import { all, first, run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { signJwt, verifyJwt } from "../utils/jwt";
import { findEligibleStaffUserById, issueAdminSession } from "../auth/admin";
import { findEligibleMemberById, issueMemberSession } from "../auth/member";
import type { authenticationResponseSchema, registrationResponseSchema } from "../../../assets/shared/schemas/passkeys";
import type { AuthAdmin, AuthMember, DatabaseLike, Env } from "../types";

// The route layer validates the WebAuthn response shape with Zod
// (assets/shared/schemas/passkeys.ts) before it reaches here; that schema is
// deliberately looser than @simplewebauthn/server's own types (e.g.
// `clientExtensionResults` as a generic record), so the verified value is
// cast to the library's precise type at the point it's handed to it.
type RegistrationResponseInput = z.infer<typeof registrationResponseSchema>;
type AuthenticationResponseInput = z.infer<typeof authenticationResponseSchema>;

const CHALLENGE_TTL_SECONDS = 300;
const PASSKEY_SESSION_TTL_HOURS = 8;
// Matches functions/api/v1/auth/member/verify-link.ts's DEFAULT_MEMBER_SESSION_TTL_HOURS —
// members aren't expected to re-authenticate as often as staff.
const DEFAULT_MEMBER_PASSKEY_SESSION_TTL_HOURS = 720;
const CHALLENGE_TOKEN_TYPE = "passkey-challenge";

type ChallengePurpose = "registration" | "authentication";

interface PasskeyChallengeClaims {
  typ: typeof CHALLENGE_TOKEN_TYPE;
  purpose: ChallengePurpose;
  challenge: string;
  userId?: string;
  exp: number;
}

function isPasskeyChallengeClaims(claims: object): claims is PasskeyChallengeClaims {
  const candidate = claims as Partial<PasskeyChallengeClaims>;
  return (
    candidate.typ === CHALLENGE_TOKEN_TYPE &&
    (candidate.purpose === "registration" || candidate.purpose === "authentication") &&
    typeof candidate.challenge === "string" &&
    (candidate.userId === undefined || typeof candidate.userId === "string") &&
    typeof candidate.exp === "number"
  );
}

function requireEnvVar(value: string | undefined, name: string): string {
  if (!value) {
    throw new AppError(500, "WEBAUTHN_CONFIG_MISSING", `${name} is not configured`);
  }
  return value;
}

async function signChallengeToken(
  secret: string,
  purpose: ChallengePurpose,
  challenge: string,
  userId?: string,
): Promise<string> {
  const claims: PasskeyChallengeClaims = {
    typ: CHALLENGE_TOKEN_TYPE,
    purpose,
    challenge,
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
  };
  if (userId) {
    claims.userId = userId;
  }
  return signJwt(secret, claims as unknown as Record<string, unknown>);
}

async function verifyChallengeToken(
  secret: string,
  token: string,
  purpose: ChallengePurpose,
): Promise<PasskeyChallengeClaims> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok || !isPasskeyChallengeClaims(result.claims) || result.claims.purpose !== purpose) {
    throw new AppError(
      400,
      "PASSKEY_CHALLENGE_INVALID",
      result.ok === false && result.reason === "expired" ? "Passkey challenge expired" : "Invalid passkey challenge",
    );
  }
  return result.claims;
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
    "SELECT credential_id FROM passkey_credentials WHERE user_id = ? AND revoked_at IS NULL",
    [actor.id],
  );

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: actor.email,
    userID: new TextEncoder().encode(actor.id),
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({ id: row.credential_id })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const challengeToken = await signChallengeToken(signingSecret, "registration", options.challenge, actor.id);

  return { options: options as unknown as Record<string, unknown>, challengeToken };
}

export async function completePasskeyRegistration(
  db: DatabaseLike,
  env: WebAuthnEnv,
  actor: { id: string },
  payload: { challengeToken: string; response: RegistrationResponseInput; deviceName?: string | null },
): Promise<PasskeySummary> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const origin = requireEnvVar(env.WEBAUTHN_ORIGIN, "WEBAUTHN_ORIGIN");
  const signingSecret = requireEnvVar(env.INTERNAL_SIGNING_SECRET, "INTERNAL_SIGNING_SECRET");

  const claims = await verifyChallengeToken(signingSecret, payload.challengeToken, "registration");
  if (claims.userId !== actor.id) {
    throw new AppError(400, "PASSKEY_CHALLENGE_INVALID", "Passkey challenge does not match the authenticated user");
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

  const duplicate = await first<{ id: string }>(db, "SELECT id FROM passkey_credentials WHERE credential_id = ?", [
    credential.id,
  ]);
  if (duplicate) {
    throw new AppError(409, "PASSKEY_ALREADY_REGISTERED", "This passkey is already registered");
  }

  const id = uuid();
  const now = nowIso();
  const deviceName = payload.deviceName ?? null;

  await run(
    db,
    `INSERT INTO passkey_credentials (
      id, user_id, credential_id, public_key, sign_count, aaguid, device_name, last_used_at, created_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    [
      id,
      actor.id,
      credential.id,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      aaguid,
      deviceName,
      now,
    ],
  );

  return { id, deviceName, aaguid, lastUsedAt: null, createdAt: now };
}

export async function beginPasskeyAuthentication(
  env: Pick<Env, "WEBAUTHN_RP_ID" | "INTERNAL_SIGNING_SECRET">,
): Promise<{ options: Record<string, unknown>; challengeToken: string }> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const signingSecret = requireEnvVar(env.INTERNAL_SIGNING_SECRET, "INTERNAL_SIGNING_SECRET");

  // No `allowCredentials` — a usernameless/discoverable-credential flow per
  // §3.4's "no auth required" begin endpoint. The browser lets the user pick
  // from any resident credential; completePasskeyAuthentication resolves
  // which user it was from the assertion's own credential ID (`response.id`,
  // stored in the clear in passkey_credentials.credential_id — see migration
  // 0036), not from the WebAuthn `userHandle` field.
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "preferred",
  });

  const challengeToken = await signChallengeToken(signingSecret, "authentication", options.challenge);

  return { options: options as unknown as Record<string, unknown>, challengeToken };
}

export type PasskeyAuthenticationResult =
  | { kind: "admin"; admin: AuthAdmin; sessionId: string; expiresAt: string }
  | { kind: "member"; member: AuthMember; sessionId: string; expiresAt: string };

export async function completePasskeyAuthentication(
  db: DatabaseLike,
  env: Pick<Env, "WEBAUTHN_RP_ID" | "WEBAUTHN_ORIGIN" | "INTERNAL_SIGNING_SECRET" | "MEMBER_SESSION_TTL_HOURS">,
  payload: { challengeToken: string; response: AuthenticationResponseInput },
): Promise<PasskeyAuthenticationResult> {
  const rpId = requireEnvVar(env.WEBAUTHN_RP_ID, "WEBAUTHN_RP_ID");
  const origin = requireEnvVar(env.WEBAUTHN_ORIGIN, "WEBAUTHN_ORIGIN");
  const signingSecret = requireEnvVar(env.INTERNAL_SIGNING_SECRET, "INTERNAL_SIGNING_SECRET");

  const claims = await verifyChallengeToken(signingSecret, payload.challengeToken, "authentication");

  const credentialRow = await first<PasskeyCredentialRow>(
    db,
    "SELECT * FROM passkey_credentials WHERE credential_id = ?",
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

  // Clone-attack detection (§3.4/§10.4): a resident/synced authenticator may
  // legitimately report 0 on every assertion (no counter support), so only a
  // *non-increasing* nonzero counter indicates a replayed/cloned credential.
  if (newCounter !== 0 && newCounter <= credentialRow.sign_count) {
    throw new AppError(
      400,
      "PASSKEY_SIGN_COUNT_REUSED",
      "Passkey sign count did not increase; possible replay or clone",
    );
  }

  // A passkey's owner may be eligible via either the staff path or the
  // member path (never both — see functions/_lib/auth/member.ts's header
  // comment on the two being distinct populations) — try staff first since
  // that was this feature's original, still-larger population.
  const staffUser = await findEligibleStaffUserById(db, credentialRow.user_id);
  const member = staffUser ? null : await findEligibleMemberById(db, credentialRow.user_id);
  if (!staffUser && !member) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account is no longer eligible to sign in");
  }

  await run(db, "UPDATE passkey_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?", [
    newCounter,
    nowIso(),
    credentialRow.id,
  ]);

  if (staffUser) {
    const issued = await issueAdminSession(db, staffUser, PASSKEY_SESSION_TTL_HOURS);
    return { kind: "admin", ...issued };
  }

  const parsed = Number.parseInt(env.MEMBER_SESSION_TTL_HOURS ?? "", 10);
  const memberSessionTtlHours =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MEMBER_PASSKEY_SESSION_TTL_HOURS;
  const issued = await issueMemberSession(db, member!, memberSessionTtlHours);
  return { kind: "member", ...issued };
}

export async function listPasskeysForUser(db: DatabaseLike, userId: string): Promise<PasskeySummary[]> {
  const rows = await all<PasskeyCredentialRow>(
    db,
    "SELECT * FROM passkey_credentials WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at ASC",
    [userId],
  );
  return rows.map(toSummary);
}

export async function revokePasskey(db: DatabaseLike, userId: string, passkeyId: string): Promise<void> {
  const row = await first<{ id: string; user_id: string }>(
    db,
    "SELECT id, user_id FROM passkey_credentials WHERE id = ? AND revoked_at IS NULL",
    [passkeyId],
  );

  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Passkey not found");
  }

  if (row.user_id !== userId) {
    throw new AppError(403, "PERMISSION_REQUIRED", "Cannot remove another user's passkey");
  }

  await run(db, "UPDATE passkey_credentials SET revoked_at = ? WHERE id = ?", [nowIso(), passkeyId]);
}
