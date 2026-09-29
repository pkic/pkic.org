import { AppError } from "../errors";
import { first } from "../db/queries";
import { uuid } from "../utils/ids";
import { signJwt, verifyJwt } from "../utils/jwt";
import type { DatabaseLike } from "../types";

const CHALLENGE_TTL_SECONDS = 300;
const CHALLENGE_TOKEN_TYPE = "passkey-challenge";
const CHALLENGE_CLEANUP_LIMIT = 100;

export type PasskeyChallengePurpose = "registration" | "authentication";

export interface PasskeyChallengeClaims {
  typ: typeof CHALLENGE_TOKEN_TYPE;
  purpose: PasskeyChallengePurpose;
  challenge: string;
  challengeId: string;
  userId?: string;
  exp: number;
}

export interface PasskeyChallengeUse {
  challengeId: string;
  purpose: PasskeyChallengePurpose;
  expiresAt: string;
}

function isPasskeyChallengeClaims(claims: object): claims is PasskeyChallengeClaims {
  const candidate = claims as Partial<PasskeyChallengeClaims>;
  return (
    candidate.typ === CHALLENGE_TOKEN_TYPE &&
    (candidate.purpose === "registration" || candidate.purpose === "authentication") &&
    typeof candidate.challenge === "string" &&
    typeof candidate.challengeId === "string" &&
    (candidate.userId === undefined || typeof candidate.userId === "string") &&
    typeof candidate.exp === "number"
  );
}

export async function issuePasskeyChallengeToken(
  secret: string,
  purpose: PasskeyChallengePurpose,
  challenge: string,
  userId?: string,
): Promise<string> {
  const claims: PasskeyChallengeClaims = {
    typ: CHALLENGE_TOKEN_TYPE,
    purpose,
    challenge,
    challengeId: uuid(),
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
  };
  if (userId) claims.userId = userId;
  return signJwt(secret, claims as unknown as Record<string, unknown>);
}

export async function verifyPasskeyChallengeToken(
  secret: string,
  token: string,
  purpose: PasskeyChallengePurpose,
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

export function toPasskeyChallengeUse(claims: PasskeyChallengeClaims): PasskeyChallengeUse {
  return {
    challengeId: claims.challengeId,
    purpose: claims.purpose,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

export function prepareConsumePasskeyChallenge(db: DatabaseLike, challenge: PasskeyChallengeUse, usedAt: string) {
  return db
    .prepare(
      `INSERT INTO passkey_challenge_uses (challenge_id, purpose, used_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(challenge.challengeId, challenge.purpose, usedAt, challenge.expiresAt);
}

export function prepareExpiredPasskeyChallengeCleanup(db: DatabaseLike, now: string) {
  return db
    .prepare(
      `DELETE FROM passkey_challenge_uses
       WHERE challenge_id IN (
         SELECT challenge_id
         FROM passkey_challenge_uses
         WHERE expires_at <= ?
         ORDER BY expires_at ASC, challenge_id ASC
         LIMIT ?
       )`,
    )
    .bind(now, CHALLENGE_CLEANUP_LIMIT);
}

export async function wasPasskeyChallengeConsumed(db: DatabaseLike, challengeId: string): Promise<boolean> {
  return Boolean(
    await first<{ consumed: number }>(
      db,
      "SELECT 1 AS consumed FROM passkey_challenge_uses WHERE challenge_id = ? LIMIT 1",
      [challengeId],
    ),
  );
}

export function passkeyChallengeAlreadyUsedError(): AppError {
  return new AppError(400, "PASSKEY_CHALLENGE_INVALID", "Passkey challenge has already been used");
}
