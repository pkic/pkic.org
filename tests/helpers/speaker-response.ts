import { env } from "cloudflare:workers";
import { callApi } from "./app";
import { createAdminSession } from "./auth";
import { queryAll } from "./context";
import { selectIndividualSpeakerRepresentation } from "./proposal-proof";
import { inviteSpeakerAndSubmitCapacityProposal } from "./proposal-speaker-capacity";

export const speakerResponseConsents = [{ termKey: "speaker-terms", version: "v1" }];
const consents = speakerResponseConsents;
export async function createSpeakerResponseFixture(adminSessionToken: string, selectIdentity = true) {
  const seeded = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
  if (selectIdentity)
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents,
      speakerManagementToken: seeded.speakerManageToken,
    });
  const token = await createAdminSession(env.DB, seeded.coSpeakerUserId, crypto.randomUUID());
  return { ...seeded, token };
}
export type SpeakerResponseFixture = Awaited<ReturnType<typeof createSpeakerResponseFixture>>;
export const respondToSpeakerInvitation = (
  f: SpeakerResponseFixture,
  body: unknown = { status: "confirmed", consents },
) =>
  callApi(env, `/api/v1/proposals/${f.proposalId}/participation`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${f.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
export const decideSpeakerResponse = (f: SpeakerResponseFixture, token: string, decision = "approve") =>
  callApi(env, `/api/v1/proposals/${f.proposalId}/speakers/${f.coSpeakerUserId}/acceptance`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
export const expireSpeakerInvitation = (f: SpeakerResponseFixture) =>
  env.DB.prepare(
    "UPDATE proposal_speakers SET invite_expires_at='2020-01-01T00:00:00.000Z' WHERE proposal_id=? AND user_id=?",
  )
    .bind(f.proposalId, f.coSpeakerUserId)
    .run();
export const speakerResponseState = (f: SpeakerResponseFixture) =>
  env.DB.prepare(
    "SELECT status,confirmed_at,terms_accepted_at,invite_generation,response_invite_generation FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
  )
    .bind(f.proposalId, f.coSpeakerUserId)
    .first();
export const speakerResponseNotices = () =>
  queryAll<{ recipient_user_id: string; payload_json: string }>(
    env.DB,
    "SELECT recipient_user_id,payload_json FROM email_outbox WHERE template_key='proposal_speaker_response' ORDER BY recipient_user_id",
  );
