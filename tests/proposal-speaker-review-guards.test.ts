import { createProposal, addProposalSpeaker } from "../functions/_lib/services/proposals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { administratorGrants } from "./helpers/administrator";
import { independentCapacityFixture } from "./helpers/independent-capacity";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { setupProposalSpeakerCapacityWorkflow } from "./helpers/proposal-speaker-capacity";
import {
  createSpeakerResponseFixture,
  decideSpeakerResponse,
  expireSpeakerInvitation,
  respondToSpeakerInvitation,
  speakerResponseState,
  speakerResponseNotices,
  speakerResponseConsents,
  type SpeakerResponseFixture,
} from "./helpers/speaker-response";
import { speakerSelfProfilePatchSchema } from "../assets/shared/schemas/proposal-management";
import {
  speakerProfileUpdateResponseSchema,
  speakerSelfServiceReadResponseSchema,
} from "../assets/shared/schemas/speaker-self-service";
import { acceptSpeakerParticipationByManager } from "../functions/_lib/services/proposal-speaker-confirmation";
import { rejectLateSpeakerParticipation } from "../functions/_lib/services/proposal-speaker-late-decision";
import { queryAll } from "./helpers/context";

describe("late speaker review guards", () => {
  let eventId: string;
  let adminUserId: string;
  let adminSessionToken: string;
  beforeEach(async () => {
    await resetDb();
    ({ eventId, adminUserId, adminSessionToken } = await setupProposalSpeakerCapacityWorkflow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });
  afterEach(() => vi.unstubAllGlobals());
  const actor = () => ({
    identityType: "user" as const,
    id: adminUserId,
    email: "admin@pkic.org",
    grants: administratorGrants,
  });
  const decide = (f: SpeakerResponseFixture, decision = "approve") =>
    decideSpeakerResponse(f, adminSessionToken, decision);
  async function pending() {
    const f = await createSpeakerResponseFixture(adminSessionToken);
    await expireSpeakerInvitation(f);
    expect((await respondToSpeakerInvitation(f)).status).toBe(200);
    return f;
  }
  async function expectPendingWithoutDecision(
    f: SpeakerResponseFixture,
    before: Awaited<ReturnType<typeof speakerResponseNotices>>,
  ) {
    expect(await speakerResponseState(f)).toMatchObject({ status: "pending", confirmed_at: null });
    expect(await speakerResponseNotices()).toEqual(before);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action IN ('speaker_late_response_approved','speaker_late_response_rejected')",
      ),
    ).toEqual([]);
  }
  it("lets a first-time late responder select an identity, respond, and withdraw through mounted session routes", async () => {
    const f = await createSpeakerResponseFixture(adminSessionToken, false);
    await expireSpeakerInvitation(f);
    const path = `/api/v1/proposals/${f.proposalId}/participation`;
    const headers = { authorization: `Bearer ${f.token}`, "content-type": "application/json" };
    const before = await callApi(env, path, { headers });
    expect(before.status).toBe(200);
    expect(speakerSelfServiceReadResponseSchema.parse(await before.json()).currentRepresentation).toBeNull();
    expect((await callApi(env, `${path}/identities`, { headers })).status).toBe(200);
    const selected = await callApi(env, `${path}/profile`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(
        speakerSelfProfilePatchSchema.parse({
          actingIdentityId: null,
          unaffiliatedAttestation: true,
          independentCapacity: independentCapacityFixture(),
        }),
      ),
    });
    expect(selected.status, JSON.stringify(await selected.clone().json())).toBe(200);
    expect(
      speakerProfileUpdateResponseSchema.parse(await selected.json()).currentRepresentation?.actingIdentitySelection,
    ).toBe("individual");
    expect((await respondToSpeakerInvitation(f)).status).toBe(200);
    expect(await speakerResponseState(f)).toMatchObject({ status: "pending" });
    expect((await respondToSpeakerInvitation(f, { status: "declined" })).status).toBe(200);
    expect(await speakerResponseState(f)).toMatchObject({ status: "declined" });
  });
  it.each([false, true])("retains the last speaker when rejecting a late response (race: %s)", async (race) => {
    const f = await pending();
    const before = await speakerResponseNotices();
    const removeOthers = () =>
      env.DB.prepare("UPDATE proposal_speakers SET status='declined' WHERE proposal_id=? AND user_id<>?")
        .bind(f.proposalId, f.coSpeakerUserId)
        .run();
    if (race) {
      const db = mutateBeforeMatchingQuery(env.DB, (sql) => sql.includes("SET status='declined'"), removeOthers);
      await expect(
        rejectLateSpeakerParticipation(db, actor(), f.proposalId, f.coSpeakerUserId, "https://app.test"),
      ).rejects.toMatchObject({ status: 409, code: "LAST_SPEAKER_REQUIRED" });
    } else {
      await removeOthers();
      const response = await decide(f, "reject");
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "LAST_SPEAKER_REQUIRED" } });
    }
    await expectPendingWithoutDecision(f, before);
  });
  it.each(["replacement", "missing evidence"])(
    "refuses approval without current speaker consent (%s)",
    async (change) => {
      const f = await pending();
      const before = await speakerResponseNotices();
      if (change === "replacement")
        await env.DB.prepare("UPDATE event_terms SET version='v2' WHERE event_id=? AND audience_type='speaker'")
          .bind(eventId)
          .run();
      else
        await env.DB.prepare(
          "DELETE FROM consent_acceptances WHERE proposal_id=? AND user_id=? AND audience_type='speaker'",
        )
          .bind(f.proposalId, f.coSpeakerUserId)
          .run();
      const response = await decide(f);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "SPEAKER_CONSENT_REQUIRED", message: expect.stringContaining("Send a new invitation") },
      });
      await expectPendingWithoutDecision(f, before);
    },
  );
  it.each(["replacement", "missing evidence"])(
    "rolls back approval when consent changes at commit (%s)",
    async (change) => {
      const f = await pending();
      const before = await speakerResponseNotices();
      const db = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("SET response_invite_generation"),
        () =>
          change === "replacement"
            ? env.DB.prepare("UPDATE event_terms SET version='v2' WHERE event_id=? AND audience_type='speaker'")
                .bind(eventId)
                .run()
            : env.DB.prepare(
                "DELETE FROM consent_acceptances WHERE proposal_id=? AND user_id=? AND audience_type='speaker'",
              )
                .bind(f.proposalId, f.coSpeakerUserId)
                .run(),
      );
      await expect(
        acceptSpeakerParticipationByManager(db, actor(), f.proposalId, f.coSpeakerUserId, "https://app.test"),
      ).rejects.toMatchObject({ status: 409 });
      await expectPendingWithoutDecision(f, before);
    },
  );
  it("gives organizers an actionable next step when a late speaker's representation no longer resolves", async () => {
    const f = await pending();
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.coSpeakerUserId)
      .run();
    const response = await decide(f);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SPEAKER_REPRESENTATION_REQUIRED", message: expect.stringContaining("Send a new invitation") },
    });
  });
  it("reuses current event consent first recorded on another proposal", async () => {
    const f = await pending();
    const { proposal } = await createProposal(env.DB, {
      eventId,
      proposerUserId: adminUserId,
      proposalType: "talk",
      title: "Another proposal with the same terms",
      abstract: "A synthetic proposal sharing event consent.",
    });
    await addProposalSpeaker(env.DB, {
      proposalId: proposal.id,
      userId: f.coSpeakerUserId,
      role: "co_speaker",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    await env.DB.prepare(
      "UPDATE consent_acceptances SET proposal_id=? WHERE event_id=? AND user_id=? AND audience_type='speaker'",
    )
      .bind(proposal.id, eventId, f.coSpeakerUserId)
      .run();
    expect((await decide(f)).status).toBe(200);
    const consent = await queryAll(
      env.DB,
      "SELECT proposal_id FROM consent_acceptances WHERE event_id=? AND user_id=? AND audience_type='speaker'",
      [eventId, f.coSpeakerUserId],
    );
    expect(consent).toEqual([{ proposal_id: proposal.id }]);
  });

  it("sends approval to managers, the proposer, and the speaker with links each can open", async () => {
    const f = await pending();
    expect((await decide(f)).status).toBe(200);
    const approval = (await speakerResponseNotices()).filter((row) => JSON.parse(row.payload_json).approved);
    const proposer = await env.DB.prepare("SELECT proposer_user_id FROM session_proposals WHERE id=?")
      .bind(f.proposalId)
      .first<{ proposer_user_id: string }>();
    expect(approval.map((row) => row.recipient_user_id)).toEqual(
      expect.arrayContaining([adminUserId, f.coSpeakerUserId, proposer!.proposer_user_id]),
    );
    const speaker = JSON.parse(approval.find((row) => row.recipient_user_id === f.coSpeakerUserId)!.payload_json);
    expect(speaker).toMatchObject({ approved: true, recipientIsSpeaker: true });
    expect(speaker.proposalUrl).toContain(`/proposals/${f.proposalId}/participation?speaker=${f.coSpeakerUserId}`);
    const manager = JSON.parse(approval.find((row) => row.recipient_user_id === adminUserId)!.payload_json);
    expect(manager.proposalUrl).toMatch(
      new RegExp(`/groups/[^/]+/events/${eventId}/proposals/${f.proposalId}/speakers$`),
    );
    expect(
      (
        await callApi(env, `/api/v1/proposals/${f.proposalId}/participation`, {
          headers: { authorization: `Bearer ${f.token}` },
        })
      ).status,
    ).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT term_version FROM consent_acceptances WHERE proposal_id=? AND user_id=? AND audience_type='speaker'",
        [f.proposalId, f.coSpeakerUserId],
      ),
    ).toEqual([{ term_version: speakerResponseConsents[0].version }]);
  });
});
