import type { env } from "cloudflare:workers";
import { prepareIndividualIdentityStatement } from "../../functions/_lib/services/users";
import { nowIso } from "../../functions/_lib/utils/time";
import { callApi } from "./app";
import { createMemberSession } from "./auth";
import { queryAll } from "./context";
import { insertUser } from "./membership";

/** A signed-in person on the join page, and whether they attest the individual capacity. */
export interface JoinApplicant {
  userId: string;
  cookie: string;
  unaffiliatedAttestation: boolean;
}

/**
 * Signs in the account that holds `email`, creating it the way the shared
 * sign-in card leaves a new one: a proved primary address and an individual
 * identity. The session acts as that individual identity.
 */
export async function signInJoinApplicant(
  testEnv: typeof env,
  email: string,
  unaffiliatedAttestation = false,
): Promise<JoinApplicant> {
  const [existing] = await queryAll<{ id: string }>(testEnv.DB, "SELECT id FROM users WHERE normalized_email=?", [
    email,
  ]);
  const userId = existing?.id ?? (await insertUser(testEnv.DB, email));
  const at = nowIso();
  await testEnv.DB.batch([
    testEnv.DB.prepare("UPDATE users SET email_verified_at=COALESCE(email_verified_at,?) WHERE id=?").bind(at, userId),
    prepareIndividualIdentityStatement(testEnv.DB, userId, at),
  ]);
  const [identity] = await queryAll<{ id: string }>(
    testEnv.DB,
    `SELECT id FROM identities WHERE user_id=? AND organization_id IS NULL
      AND started_at IS NOT NULL AND ended_at IS NULL AND blocked_at IS NULL`,
    [userId],
  );
  const token = await createMemberSession(testEnv.DB, userId, `join-${crypto.randomUUID()}`, undefined, identity!.id);
  return { userId, cookie: `pkic_session=${token}`, unaffiliatedAttestation };
}

/** Asks for the signed-in applicant's membership path, with what they chose on the way. */
export function joinPath(
  testEnv: typeof env,
  applicant: JoinApplicant,
  choice: Record<string, unknown> = {},
): Promise<Response> {
  return callApi(testEnv, "/api/v1/members/join/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.25", cookie: applicant.cookie },
    body: JSON.stringify({ unaffiliatedAttestation: applicant.unaffiliatedAttestation, ...choice }),
  });
}
