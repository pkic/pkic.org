import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  eventProposalProofStartSchema,
  eventProposalProofVerifyResponseSchema,
} from "../assets/shared/schemas/event-proposal-proof";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { proposalEntryContextSchema } from "../assets/shared/schemas/proposal-entry";
import { createInvite, findInviteByToken } from "../functions/_lib/services/invites";
import { createReferralCode } from "../functions/_lib/services/referrals";
import { getEventBySlug } from "../functions/_lib/services/events";
import { submitProposal } from "../functions/_lib/services/proposal-submission";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
const request = (suffix: string, body: unknown) =>
  callApi(env, `/api/v1/events/pqc-2026/proposals${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminId = await env.DB.prepare("SELECT id FROM users WHERE normalized_email='admin@pkic.org'").first<string>(
    "id",
  );
  const invitation = await createInvite(env.DB, {
    eventId,
    inviterUserId: adminId,
    inviteeEmail: "invited@example.test",
    inviteType: "speaker",
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  const referralCode = await createReferralCode(env.DB, {
    eventId,
    ownerType: "registration",
    ownerId: crypto.randomUUID(),
    createdByUserId: adminId,
    length: 8,
  });
  const entry = proposalEntryContextSchema.parse({
    inviteToken: invitation.token,
    inviteId: invitation.invite.id,
    sourceType: "invite",
    sourceRef: "invite",
    referralCode,
  });
  const start = await request(
    "/proof",
    eventProposalProofStartSchema.parse({
      email: "colleague@example.test",
      unaffiliatedAttestation: true,
      consents,
      entryContext: entry,
    }),
  );
  expect(start.status, await start.clone().text()).toBe(200);
  const queued = await env.DB.prepare(
    "SELECT payload_json FROM email_outbox WHERE template_key='event_proposal_verify' AND recipient_email='colleague@example.test'",
  ).first<{ payload_json: string }>();
  expect(queued!.payload_json).not.toContain(invitation.token);
  const delivered = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, env, queued!.payload_json);
  const url = new URL(delivered.verificationUrl);
  expect(url.searchParams.has("invite")).toBe(false);
  expect(url.searchParams.has("ref")).toBe(false);
  const token = new URLSearchParams(url.hash.slice(1)).get("verify")!;
  return { eventId, adminId: adminId!, invitation, entry, token };
}
async function ready(token: string) {
  const response = await request("/proof/verify", { token });
  expect(response.status, await response.clone().text()).toBe(200);
  const proof = eventProposalProofVerifyResponseSchema.parse(await response.json());
  if (proof.status !== "ready" || !proof.entryContext) throw new Error("Expected authoritative proposal entry context");
  return proof;
}
function submission(proof: Awaited<ReturnType<typeof ready>>) {
  return proposalCreateSchema.parse({
    ...proof.entryContext,
    continuationToken: proof.continuationToken,
    unaffiliatedAttestation: true,
    proposer: { firstName: "Colleague", lastName: "Submitter", actingIdentityId: null },
    proposal: {
      type: "Talk",
      title: "A delegated invited conference proposal",
      abstract:
        "A detailed proposal discussing a colleague's deliberate submission through an existing speaker invitation, preserving its original referral context across a real mailbox confirmation and atomic submission.",
    },
    consents,
  });
}

describe("proposal entry context through mailbox proof", () => {
  it("restores an actual invited email return and preserves delegation, referral conversion, and atomic invite acceptance", async () => {
    const f = await fixture();
    const proof = await ready(f.token);
    expect(proof.entryContext).toMatchObject({
      inviteId: f.invitation.invite.id,
      sourceType: "invite",
      sourceRef: "invite",
      referralCode: f.entry.referralCode,
    });
    expect(proof.entryContext!.inviteToken).not.toBe(f.invitation.token);
    const response = await request("", submission(proof));
    expect(response.status, await response.clone().text()).toBe(200);
    const { proposalId } = (await response.json()) as { proposalId: string };
    expect(
      await queryAll(env.DB, "SELECT status,used_count FROM invites WHERE id=?", [f.invitation.invite.id]),
    ).toEqual([{ status: "accepted", used_count: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT user.normalized_email,proposal.referral_code FROM session_proposals proposal JOIN users user ON user.id=proposal.proposer_user_id WHERE proposal.id=?",
        [proposalId],
      ),
    ).toEqual([{ normalized_email: "colleague@example.test", referral_code: f.entry.referralCode }]);
    expect(
      await queryAll(env.DB, "SELECT conversions FROM referral_codes WHERE code=?", [f.entry.referralCode]),
    ).toEqual([{ conversions: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM engagement_events WHERE action_type='invite_accepted' AND subject_ref=? AND user_id=?",
        [f.invitation.invite.id, f.adminId],
      ),
    ).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email='invited@example.test'")).toHaveLength(
      0,
    );
    expect((await request("/proof/verify", { token: f.token })).status).toBe(409);
    expect((await request("", submission(proof))).status).toBe(409);
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(1);
  });

  it.each(["rotated", "revoked", "expired"] as const)(
    "blocks a %s original invitation on the real email return",
    async (change) => {
      const f = await fixture();
      const sql =
        change === "rotated"
          ? "UPDATE invites SET link_secret='rotated' WHERE id=?"
          : change === "revoked"
            ? "UPDATE invites SET status='revoked' WHERE id=?"
            : "UPDATE invites SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=?";
      await env.DB.prepare(sql).bind(f.invitation.invite.id).run();
      expect((await request("/proof/verify", { token: f.token })).status).toBe(410);
      expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM audit_log WHERE idempotency_key LIKE 'event_proposal_proof_consumed:%'"),
      ).toHaveLength(0);
    },
  );

  it("rejects dropping the invitation or changing signed original source/referral context", async () => {
    const f = await fixture();
    const proof = await ready(f.token);
    const body = submission(proof);
    const { inviteToken: _token, inviteId: _id, ...withoutInvite } = body;
    expect((await request("", withoutInvite)).status).toBe(422);
    for (const change of [{ sourceType: "campaign" }, { sourceRef: "changed" }, { referralCode: undefined }])
      expect((await request("", { ...body, ...change })).status).toBe(422);
    expect(
      await queryAll(env.DB, "SELECT status,used_count FROM invites WHERE id=?", [f.invitation.invite.id]),
    ).toEqual([{ status: "sent", used_count: 0 }]);
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
  });

  it("rolls back the proposal, proof, and referral when the original invitation changes at the final batch", async () => {
    const f = await fixture();
    const proof = await ready(f.token);
    const body = submission(proof);
    const invite = await findInviteByToken(env.DB, body.inviteToken!, env.INTERNAL_SIGNING_SECRET!, body.inviteId);
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE invites SET link_secret='rotated' WHERE id=?").bind(invite.id).run(),
    );
    await expect(
      submitProposal(db, {
        event: await getEventBySlug(env.DB, "pqc-2026"),
        body,
        acceptedInvite: invite,
        appBaseUrl: "https://app.test",
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        referralCodeLength: 8,
        proposalDetails: {},
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ code: "PROPOSAL_IDENTITY_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email='colleague@example.test'")).toHaveLength(
      0,
    );
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE idempotency_key LIKE 'event_proposal_proof_consumed:%'"),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT conversions FROM referral_codes WHERE code=?", [f.entry.referralCode]),
    ).toEqual([{ conversions: 0 }]);
    expect(await queryAll(env.DB, "SELECT status,used_count FROM invites WHERE id=?", [invite.id])).toEqual([
      { status: "sent", used_count: 0 },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='proposal_submitted'")).toHaveLength(
      0,
    );
  });
});
