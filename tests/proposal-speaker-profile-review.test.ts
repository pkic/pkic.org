import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { setupProposalSpeakerCapacityWorkflow } from "./helpers/proposal-speaker-capacity";
import { independentCapacityFixture } from "./helpers/independent-capacity";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import {
  createSpeakerResponseFixture,
  expireSpeakerInvitation,
  respondToSpeakerInvitation,
  speakerResponseNotices,
} from "./helpers/speaker-response";
import { speakerSelfProfilePatchSchema } from "../assets/shared/schemas/proposal-management";
import { getSpeakerByProposalUser } from "../functions/_lib/services/proposals-speaker-capability";
import { updateSpeakerProfile } from "../functions/_lib/services/proposals-speaker-profile";
import {
  isLateSpeakerResponseAwaitingReview,
  lateSpeakerResponseAwaitingReviewSql,
} from "../assets/shared/proposal-speaker-acceptance";

const selection = () => ({
  actingIdentityId: null,
  unaffiliatedAttestation: true,
  independentCapacity: independentCapacityFixture(),
});

describe("speaker identity selection expiry and review", () => {
  let adminToken: string;
  beforeEach(async () => {
    await resetDb();
    ({ adminSessionToken: adminToken } = await setupProposalSpeakerCapacityWorkflow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });
  afterEach(() => vi.unstubAllGlobals());
  type Fixture = Awaited<ReturnType<typeof createSpeakerResponseFixture>>;
  const patch = (f: Fixture, body: unknown) =>
    callApi(env, `/api/v1/proposals/${f.proposalId}/participation/profile`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${f.token}`, "content-type": "application/json" },
      body: JSON.stringify(speakerSelfProfilePatchSchema.parse(body)),
    });
  const profile = (f: Fixture) =>
    env.DB.prepare(`SELECT ps.acting_identity_id,ps.acting_identity_selected_at,u.first_name,u.last_name
    FROM proposal_speakers ps JOIN users u ON u.id=ps.user_id WHERE ps.proposal_id=? AND ps.user_id=?`)
      .bind(f.proposalId, f.coSpeakerUserId)
      .first();

  it.each([
    { firstName: "Changed" },
    { lastName: "Changed" },
    { organizationName: "Changed organization", continuationToken: "synthetic-proof-".repeat(3) },
    { jobTitle: "Changed title", continuationToken: "synthetic-proof-".repeat(3) },
    { consents: [] },
    { continuationToken: "synthetic-proof-".repeat(3) },
  ])("refuses unrelated expired edits even when bundled with identity selection (%j)", async (extra) => {
    const f = await createSpeakerResponseFixture(adminToken);
    await expireSpeakerInvitation(f);
    const before = await profile(f);
    const response = await patch(f, { ...selection(), ...extra });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: { code: "SPEAKER_INVITATION_EXPIRED" } });
    expect(await profile(f)).toEqual(before);
  });

  it.each([false, true])(
    "locks the reviewed identity even if the deadline is extended (extended: %s)",
    async (extended) => {
      const f = await createSpeakerResponseFixture(adminToken);
      await expireSpeakerInvitation(f);
      expect((await respondToSpeakerInvitation(f)).status).toBe(200);
      if (extended)
        await env.DB.prepare(
          "UPDATE proposal_speakers SET invite_expires_at='2099-12-01T00:00:00.000Z' WHERE proposal_id=? AND user_id=?",
        )
          .bind(f.proposalId, f.coSpeakerUserId)
          .run();
      const before = await profile(f);
      const notices = await speakerResponseNotices();
      const response = await patch(f, selection());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "SPEAKER_RESPONSE_AWAITING_REVIEW" } });
      expect(await profile(f)).toEqual(before);
      expect(await speakerResponseNotices()).toEqual(notices);
    },
  );

  it("rolls back identity and audit writes if a legacy pending row receives a late response at commit", async () => {
    const f = await createSpeakerResponseFixture(adminToken);
    await expireSpeakerInvitation(f);
    await env.DB.prepare(
      "UPDATE proposal_speakers SET status='pending',response_invite_generation=NULL WHERE proposal_id=? AND user_id=?",
    )
      .bind(f.proposalId, f.coSpeakerUserId)
      .run();
    const before = await profile(f);
    const { speaker, proposal, user } = await getSpeakerByProposalUser(env.DB, f.proposalId, f.coSpeakerUserId);
    const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL LIMIT 1")
      .bind(user.id)
      .first<{ id: string }>();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("SET invite_generation = invite_generation"),
      () =>
        env.DB.prepare("UPDATE proposal_speakers SET response_invite_generation=invite_generation WHERE id=?")
          .bind(speaker.id)
          .run(),
    );
    await expect(
      updateSpeakerProfile(db, selection(), {
        proposalSpeakerId: speaker.id,
        proposalId: proposal.id,
        proposalStatus: proposal.status,
        proposalUpdatedAt: proposal.updated_at,
        userId: user.id,
        currentStatus: speaker.status,
        responseInviteGeneration: speaker.response_invite_generation,
        inviteGeneration: speaker.invite_generation,
        expectedActingIdentityId: speaker.acting_identity_id,
        expectedActingIdentitySelectedAt: speaker.acting_identity_selected_at,
        authority: { resourceId: proposal.id, userId: user.id, sessionId: session!.id },
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    expect(await profile(f)).toEqual(before);
  });

  it("keeps the SQL and TypeScript review policies in agreement, including null and stale generations", async () => {
    const cases = [
      { status: "pending", responseGeneration: null, generation: 1 },
      { status: "pending", responseGeneration: 1, generation: 2 },
      { status: "pending", responseGeneration: 2, generation: 2 },
      { status: "confirmed", responseGeneration: 2, generation: 2 },
      { status: "declined", responseGeneration: 2, generation: 2 },
      { status: "invited", responseGeneration: 2, generation: 2 },
    ];
    for (const row of cases) {
      const result = await env.DB.prepare(
        `SELECT ${lateSpeakerResponseAwaitingReviewSql("ps")} AS awaiting_review FROM (SELECT ? AS status, ? AS response_invite_generation, ? AS invite_generation) ps`,
      )
        .bind(row.status, row.responseGeneration, row.generation)
        .first<{ awaiting_review: number }>();
      expect(Boolean(result!.awaiting_review)).toBe(
        isLateSpeakerResponseAwaitingReview(row.status, row.responseGeneration, row.generation),
      );
    }
  });
});
