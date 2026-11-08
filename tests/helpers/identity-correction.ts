import { env } from "cloudflare:workers";
import { identityCorrectionSchema } from "../../assets/shared/schemas/identity";
import { nowIso } from "../../functions/_lib/utils/time";
import { proposalIdentityFixture } from "./proposal-identity";
import { callApi } from "./app";
import { createAdminSession } from "./auth";

export type IdentityCorrectionFixture = Awaited<ReturnType<typeof proposalIdentityFixture>>;
export function requestIdentityCorrection(
  f: IdentityCorrectionFixture,
  token = f.token,
  replacement = f.secondIdentityId,
  machine = false,
) {
  return callApi(
    env,
    `/api/v1/users/${f.userId}/identities/${f.identityId}/corrections`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(machine ? { "x-pkic-machine-auth": "mcp" } : {}),
      },
      body: JSON.stringify(
        identityCorrectionSchema.parse({
          replacementIdentityId: replacement,
          reason: "The organization was associated incorrectly.",
        }),
      ),
    },
    { maxRoundTrips: 1 },
  );
}
export async function createIdentityRegistration(f: IdentityCorrectionFixture) {
  const id = crypto.randomUUID();
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO registrations(id,event_id,user_id,status,source_type,manage_link_secret,registration_identity_id,created_at,updated_at)
    VALUES(?,?,?,'registered','test',?,?,?,?)`)
    .bind(id, f.eventId, f.userId, crypto.randomUUID(), f.identityId, at, at)
    .run();
  return id;
}
export async function createStaffSession() {
  const id = (await env.DB.prepare("SELECT id FROM users WHERE normalized_email='admin@pkic.org'").first<string>(
    "id",
  ))!;
  return { id, token: await createAdminSession(env.DB, id, crypto.randomUUID()) };
}

export async function requestIdentityDeletion(
  f: IdentityCorrectionFixture,
  token: string,
  identityId = f.identityId,
  machine = false,
) {
  return callApi(
    env,
    `/api/v1/users/${f.userId}/identities/${identityId}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, ...(machine ? { "x-pkic-machine-auth": "mcp" } : {}) },
    },
    { maxRoundTrips: 1 },
  );
}
