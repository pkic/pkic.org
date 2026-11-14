import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { proposalCreateResponseSchema, proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import { proposalEntryContextSchema } from "../assets/shared/schemas/proposal-entry";
import { createInvite, findInviteByToken } from "../functions/_lib/services/invites";
import { createReferralCode } from "../functions/_lib/services/referrals";
import { getEventBySlug } from "../functions/_lib/services/events";
import { submitProposal } from "../functions/_lib/services/proposal-submission";
import { withIndependentCapacity } from "./helpers/independent-capacity";
import { signInProposer } from "./helpers/proposal-proof";

beforeEach(resetDb);
const consents = [{ termKey: "speaker-terms", version: "v1" }];
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
  // A colleague of the invited person, signed in with their own account.
  const colleague = await signInProposer({ environment: env, email: "colleague@example.test" });
  const body = proposalCreateSchema.parse({
    ...entry,
    ...withIndependentCapacity({ unaffiliatedAttestation: true }),
    proposer: { firstName: "Colleague", lastName: "Submitter", actingIdentityId: null },
    proposal: {
      type: "Talk",
      title: "A delegated invited conference proposal",
      abstract:
        "A detailed proposal discussing a colleague's deliberate submission through an existing speaker invitation, preserving its original referral context through sign-in and an atomic submission.",
    },
    consents,
  });
  return { eventId, adminId: adminId!, invitation, entry, colleague, body };
}
const submit = (f: Awaited<ReturnType<typeof fixture>>) =>
  callApi(env, "/api/v1/events/pqc-2026/proposals", {
    method: "POST",
    headers: { "content-type": "application/json", ...f.colleague.headers },
    body: JSON.stringify(f.body),
  });
const invitationState = (inviteId: string) =>
  queryAll(env.DB, "SELECT status,used_count FROM invites WHERE id=?", [inviteId]);

describe("proposal entry context of a signed-in proposer", () => {
  it("preserves delegation, referral conversion, and atomic invite acceptance", async () => {
    const f = await fixture();
    const response = await submit(f);
    expect(response.status, await response.clone().text()).toBe(200);
    const { proposalId } = proposalCreateResponseSchema.parse(await response.json());
    expect(await invitationState(f.invitation.invite.id)).toEqual([{ status: "accepted", used_count: 1 }]);
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
  });

  it.each([
    ["rotated", "UPDATE invites SET link_secret='rotated' WHERE id=?", 404],
    ["revoked", "UPDATE invites SET status='revoked' WHERE id=?", 409],
    ["expired", "UPDATE invites SET expires_at='2020-01-01T00:00:00.000Z' WHERE id=?", 410],
  ] as const)("refuses a %s invitation at submission and stores nothing", async (_change, sql, status) => {
    const f = await fixture();
    await env.DB.prepare(sql).bind(f.invitation.invite.id).run();
    const response = await submit(f);
    expect(response.status, await response.clone().text()).toBe(status);
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT conversions FROM referral_codes WHERE code=?", [f.entry.referralCode]),
    ).toEqual([{ conversions: 0 }]);
  });

  it("rolls back the proposal and referral when the invitation changes at the final batch", async () => {
    const f = await fixture();
    const invite = await findInviteByToken(env.DB, f.body.inviteToken!, env.INTERNAL_SIGNING_SECRET!, f.body.inviteId);
    const session = await env.DB.prepare("SELECT id,expires_at FROM sessions WHERE user_id=?")
      .bind(f.colleague.userId)
      .first<{ id: string; expires_at: string }>();
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE invites SET link_secret='rotated' WHERE id=?").bind(invite.id).run(),
    );
    await expect(
      submitProposal(db, {
        event: await getEventBySlug(env.DB, "pqc-2026"),
        body: f.body,
        actor: {
          userId: f.colleague.userId,
          email: "colleague@example.test",
          sessionId: session!.id,
          expiresAt: session!.expires_at,
        },
        acceptedInvite: invite,
        appBaseUrl: "https://app.test",
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
        referralCodeLength: 8,
        proposalDetails: {},
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT first_name,last_name FROM users WHERE id=?", [f.colleague.userId])).toEqual([
      { first_name: null, last_name: null },
    ]);
    expect(
      await queryAll(env.DB, "SELECT conversions FROM referral_codes WHERE code=?", [f.entry.referralCode]),
    ).toEqual([{ conversions: 0 }]);
    expect(await invitationState(invite.id)).toEqual([{ status: "sent", used_count: 0 }]);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key='proposal_submitted'")).toHaveLength(
      0,
    );
  });
});
