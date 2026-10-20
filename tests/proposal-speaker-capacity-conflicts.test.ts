import { declineSpeakerParticipation } from "../functions/_lib/services/proposal-speaker-decline";
import { createAdminSession } from "./helpers/auth";
import { selectIndividualSpeakerRepresentation } from "./helpers/proposal-proof";
import { ADMINISTRATOR_FIXTURE_USER_SQL, administratorGrants } from "./helpers/administrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import type { DatabaseLike } from "../functions/_lib/types";
import {
  addProposalSpeaker,
  createProposal,
  finalizeProposalDecision,
  getProposalByManageToken,
} from "../functions/_lib/services/proposals";
import { persistConsents } from "../functions/_lib/services/consent";
import {
  acceptSpeakerParticipationByManager,
  confirmSpeakerParticipation,
} from "../functions/_lib/services/proposal-speaker-confirmation";
import {
  getProposerManagedSpeakerContext,
  updateProposalSpeakerRoleByProposer,
} from "../functions/_lib/services/proposer-speaker-profile";
import { resetDb } from "./helpers/reset-db";
import { queryAll, registrationAdmissionRole } from "./helpers/context";
import { findOrCreateUser } from "../functions/_lib/services/users";
import {
  inviteSpeakerAndSubmitCapacityProposal,
  seedAcceptedSpeakerRegistration,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";

const requestOptions = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

function raceBeforeFirstBatch(action: () => Promise<void>): DatabaseLike {
  const baseDb: DatabaseLike = env.DB;
  let raced = false;
  return {
    prepare: (query) => baseDb.prepare(query),
    async batch(statements) {
      if (!raced) {
        raced = true;
        await action();
      }
      return baseDb.batch(statements);
    },
  };
}

describe("proposal speaker capacity conflicts", () => {
  let adminSessionToken: string;
  let eventId: string;
  let adminUserId: string;

  beforeEach(async () => {
    await resetDb();
    ({ adminSessionToken, eventId, adminUserId } = await setupProposalSpeakerCapacityWorkflow());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });

  afterEach(() => vi.unstubAllGlobals());

  async function acceptanceFixture() {
    const speaker = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents: [{ termKey: "speaker-terms", version: "v1" }],
      speakerManagementToken: speaker.speakerManageToken,
    });
    return speaker;
  }
  function acceptRequest(proposalId: string, userId: string, token: string | null = adminSessionToken, body = {}) {
    return app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${userId}/acceptance`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }),
      env,
      requestOptions,
    );
  }
  async function recordSpeakerConsent(proposalId: string, userId: string) {
    await persistConsents(env.DB, {
      eventId,
      proposalId,
      userId,
      audienceType: "speaker",
      accepted: [{ termKey: "speaker-terms", version: "v1" }],
      ip: null,
      userAgent: null,
      secret: env.INTERNAL_SIGNING_SECRET!,
    });
  }

  it("accepts for a speaker with existing identity and terms without creating personal consent", async () => {
    const { proposalId, coSpeakerUserId } = await acceptanceFixture();
    await recordSpeakerConsent(proposalId, coSpeakerUserId);
    const before = await queryAll(env.DB, "SELECT id, accepted_at FROM consent_acceptances WHERE proposal_id=?", [
      proposalId,
    ]);
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT status, terms_accepted_at FROM proposal_speakers WHERE proposal_id=? AND user_id=?",
        [proposalId, coSpeakerUserId],
      ),
    ).toEqual([{ status: "confirmed", terms_accepted_at: null }]);
    expect(
      await queryAll(env.DB, "SELECT id, accepted_at FROM consent_acceptances WHERE proposal_id=?", [proposalId]),
    ).toEqual(before);
    expect(
      await queryAll(env.DB, "SELECT actor_id FROM audit_log WHERE action='speaker_confirmed_by_organizer'"),
    ).toEqual([{ actor_id: adminUserId }]);
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT actor_id FROM audit_log WHERE action='speaker_confirmed_by_organizer'"),
    ).toHaveLength(1);
  });

  it("reuses event speaker consent originally accepted on another proposal", async () => {
    const original = await acceptanceFixture();
    await recordSpeakerConsent(original.proposalId, original.coSpeakerUserId);
    const { proposal } = await createProposal(env.DB, {
      eventId,
      proposerUserId: adminUserId,
      proposalType: "talk",
      title: "Another talk at the same event",
      abstract: "A second proposal sharing the same speaker and event terms.",
    });
    const { manageToken } = await addProposalSpeaker(env.DB, {
      proposalId: proposal.id,
      userId: original.coSpeakerUserId,
      role: "co_speaker",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents: [{ termKey: "speaker-terms", version: "v1" }],
      speakerManagementToken: manageToken,
    });
    const later = { proposalId: proposal.id, coSpeakerUserId: original.coSpeakerUserId };
    expect(later.proposalId).not.toBe(original.proposalId);
    expect(later.coSpeakerUserId).toBe(original.coSpeakerUserId);
    await recordSpeakerConsent(later.proposalId, later.coSpeakerUserId);
    const before = await queryAll(
      env.DB,
      "SELECT id, proposal_id, accepted_at FROM consent_acceptances WHERE user_id=? AND audience_type='speaker'",
      [later.coSpeakerUserId],
    );
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ proposal_id: original.proposalId });
    expect((await acceptRequest(later.proposalId, later.coSpeakerUserId)).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id=? AND user_id=?", [
        later.proposalId,
        later.coSpeakerUserId,
      ]),
    ).toEqual([{ status: "confirmed" }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id, proposal_id, accepted_at FROM consent_acceptances WHERE user_id=? AND audience_type='speaker'",
        [later.coSpeakerUserId],
      ),
    ).toEqual(before);
  });

  it("requires the speaker's existing identity and current terms, plus an authenticated organizer", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    expect((await acceptRequest(proposalId, coSpeakerUserId, null)).status).toBe(401);
    expect((await acceptRequest(proposalId, coSpeakerUserId, adminSessionToken, { consents: [] })).status).toBe(400);
    const noIdentity = await acceptRequest(proposalId, coSpeakerUserId);
    expect(noIdentity.status).toBe(409);
    expect(await noIdentity.json()).toMatchObject({ error: { code: "SPEAKER_REPRESENTATION_REQUIRED" } });
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents: [{ termKey: "speaker-terms", version: "v1" }],
      speakerManagementToken: speakerManageToken,
    });
    const noConsent = await acceptRequest(proposalId, coSpeakerUserId);
    expect(noConsent.status).toBe(409);
    expect(await noConsent.json()).toMatchObject({ error: { code: "SPEAKER_CONSENT_REQUIRED" } });
    expect(
      await queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id=? AND user_id=?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).toEqual([{ status: "invited" }]);
  });

  it("authorizes event-scoped management but refuses reviewers and declined or closed participation", async () => {
    const { proposalId, coSpeakerUserId } = await acceptanceFixture();
    await recordSpeakerConsent(proposalId, coSpeakerUserId);
    const reviewer = await findOrCreateUser(env.DB, {
      email: "acceptance-reviewer@example.test",
      firstName: "Review",
      lastName: "Only",
    });
    await env.DB.prepare(`INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,created_at)
      VALUES (?,?,'proposals:score','event',?,?)`)
      .bind(crypto.randomUUID(), reviewer.id, eventId, new Date().toISOString())
      .run();
    const reviewerToken = await createAdminSession(env.DB, reviewer.id, "acceptance-reviewer");
    expect((await acceptRequest(proposalId, coSpeakerUserId, reviewerToken)).status).toBe(403);
    await env.DB.prepare("UPDATE permission_grants SET permission='proposals:manage' WHERE user_id=?")
      .bind(reviewer.id)
      .run();
    expect((await acceptRequest(proposalId, coSpeakerUserId, reviewerToken)).status).toBe(200);
    await env.DB.prepare("UPDATE proposal_speakers SET status='declined' WHERE proposal_id=? AND user_id=?")
      .bind(proposalId, coSpeakerUserId)
      .run();
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(409);
    await env.DB.prepare("UPDATE proposal_speakers SET status='invited' WHERE proposal_id=? AND user_id=?")
      .bind(proposalId, coSpeakerUserId)
      .run();
    await env.DB.prepare("UPDATE session_proposals SET status='withdrawn' WHERE id=?").bind(proposalId).run();
    expect((await acceptRequest(proposalId, coSpeakerUserId)).status).toBe(409);
  });

  it("rolls back organizer acceptance if the speaker consent disappears before the batch", async () => {
    const { proposalId, coSpeakerUserId } = await acceptanceFixture();
    await recordSpeakerConsent(proposalId, coSpeakerUserId);
    const db = raceBeforeFirstBatch(async () => {
      await env.DB.prepare("DELETE FROM consent_acceptances WHERE proposal_id=? AND user_id=?")
        .bind(proposalId, coSpeakerUserId)
        .run();
    });
    await expect(
      acceptSpeakerParticipationByManager(
        db,
        { identityType: "user", id: adminUserId, email: "admin@pkic.org", grants: administratorGrants },
        proposalId,
        coSpeakerUserId,
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    expect(
      await queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id=? AND user_id=?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).toEqual([{ status: "invited" }]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='speaker_confirmed_by_organizer'")).toEqual(
      [],
    );
  });

  it("blocks self-service decline of the final non-declined speaker", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const [proposal] = await queryAll<{ proposer_user_id: string }>(
      env.DB,
      "SELECT proposer_user_id FROM session_proposals WHERE id = ?",
      [proposalId],
    );
    const { manageToken } = await addProposalSpeaker(env.DB, {
      proposalId,
      userId: proposal.proposer_user_id,
      role: "proposer",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ? AND user_id = ?")
      .bind(proposalId, coSpeakerUserId)
      .run();

    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/speakers/access/${encodeURIComponent(manageToken)}/participation`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "declined", reason: "Unavailable" }),
        },
      ),
      env,
      requestOptions,
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "LAST_SPEAKER_REQUIRED" } });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        proposal.proposer_user_id,
      ]),
    ).resolves.toEqual([{ status: "confirmed" }]);
  });

  it("lets the proposer remove an already-declined roster entry when another speaker remains", async () => {
    const { proposalId, proposalManageToken, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ? AND user_id = ?")
      .bind(proposalId, coSpeakerUserId)
      .run();

    const response = await app.fetch(
      new Request(
        `https://app.test/api/v1/proposals/access/${encodeURIComponent(proposalManageToken)}/speakers/${coSpeakerUserId}`,
        { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" },
      ),
      env,
      requestOptions,
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([]);
  });

  it("lets an admin remove an already-declined roster entry when another speaker remains", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ? AND user_id = ?")
      .bind(proposalId, coSpeakerUserId)
      .run();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${coSpeakerUserId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
        body: "{}",
      }),
      env,
      requestOptions,
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([]);
  });

  it("rolls back decline fallout when the speaker compare-and-set loses", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    const racingDb = raceBeforeFirstBatch(async () => {
      await env.DB.prepare("UPDATE proposal_speakers SET role = 'panelist' WHERE proposal_id = ? AND user_id = ?")
        .bind(proposalId, coSpeakerUserId)
        .run();
    });

    await expect(
      declineSpeakerParticipation(racingDb, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        appBaseUrl: "https://app.test",
        reason: "Unavailable",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "invited" }]);
    await expect(registrationAdmissionRole(env.DB, registrationId)).resolves.toBe("panelist");
  });

  it("rolls back consent when confirmation loses to a concurrent decline", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents: [{ termKey: "speaker-terms", version: "v1" }],
      speakerManagementToken: speakerManageToken,
    });
    const racingDb = raceBeforeFirstBatch(async () => {
      await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ? AND user_id = ?")
        .bind(proposalId, coSpeakerUserId)
        .run();
    });

    await expect(
      confirmSpeakerParticipation(racingDb, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        consents: [{ termKey: "speaker-terms", version: "v1" }],
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "declined" }]);
    await expect(
      queryAll(env.DB, "SELECT COUNT(*) AS count FROM consent_acceptances WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it("does not restore capacity or consent when confirmation loses to concurrent removal", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents: [{ termKey: "speaker-terms", version: "v1" }],
      speakerManagementToken: speakerManageToken,
    });
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    const racingDb = raceBeforeFirstBatch(async () => {
      const removal = await app.fetch(
        new Request(`https://app.test/api/v1/proposals/${proposalId}/speakers/${coSpeakerUserId}`, {
          method: "DELETE",
          headers: { "content-type": "application/json", authorization: `Bearer ${adminSessionToken}` },
          body: "{}",
        }),
        env,
        requestOptions,
      );
      expect(removal.status).toBe(200);
    });

    await expect(
      confirmSpeakerParticipation(racingDb, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        consents: [{ termKey: "speaker-terms", version: "v1" }],
        ip: null,
        userAgent: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([]);
    await expect(
      queryAll(env.DB, "SELECT COUNT(*) AS count FROM consent_acceptances WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ count: 0 }]);
    await expect(registrationAdmissionRole(env.DB, registrationId)).resolves.toBeNull();
  });

  it("reconciles accepted-proposal capacity when a speaker confirms", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await selectIndividualSpeakerRepresentation({
      environment: env,
      eventSlug: "pqc-2026",
      email: "cospeaker@example.test",
      consents: [{ termKey: "speaker-terms", version: "v1" }],
      speakerManagementToken: speakerManageToken,
    });
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });

    await expect(
      confirmSpeakerParticipation(env.DB, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        consents: [{ termKey: "speaker-terms", version: "v1" }],
        ip: null,
        userAgent: null,
      }),
    ).resolves.toBeUndefined();
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "confirmed" }]);
    await expect(registrationAdmissionRole(env.DB, registrationId)).resolves.toBe("speaker");
  });

  it("returns a stable registration conflict and leaves decline state unchanged", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    const racingDb = raceBeforeFirstBatch(async () => {
      await env.DB.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").bind(registrationId).run();
    });

    await expect(
      declineSpeakerParticipation(racingDb, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        appBaseUrl: "https://app.test",
        reason: "Unavailable",
      }),
    ).rejects.toMatchObject({ status: 409, code: "REGISTRATION_CHANGED" });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "invited" }]);
  });

  it("rolls back self-service role fallout when the speaker compare-and-set loses", async () => {
    const { proposalManageToken, proposalId, coSpeakerUserId } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const proposal = await getProposalByManageToken(env.DB, proposalManageToken, env.INTERNAL_SIGNING_SECRET!);
    const context = await getProposerManagedSpeakerContext(
      env.DB,
      proposalManageToken,
      coSpeakerUserId,
      env.INTERNAL_SIGNING_SECRET!,
    );
    const racingDb = raceBeforeFirstBatch(async () => {
      await env.DB.prepare("UPDATE proposal_speakers SET role = 'moderator' WHERE proposal_id = ? AND user_id = ?")
        .bind(proposalId, coSpeakerUserId)
        .run();
    });

    await expect(
      updateProposalSpeakerRoleByProposer(racingDb, { proposal, speaker: context.speaker, role: "panelist" }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT role FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ role: "moderator" }]);
  });

  it("rolls back acceptance when a concurrent speaker removal changes the enumerated roster", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const [admin] = await queryAll<{ id: string; email: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
    const racingDb = raceBeforeFirstBatch(async () => {
      await env.DB.prepare("DELETE FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?")
        .bind(proposalId, coSpeakerUserId)
        .run();
    });

    await expect(
      finalizeProposalDecision(racingDb, {
        proposalId,
        actor: { identityType: "user", id: admin.id, email: admin.email, grants: administratorGrants },
        finalStatus: "accepted",
        minReviewsRequired: 0,
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_DECISION_CONFLICT" });
    await expect(queryAll(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId])).resolves.toEqual([
      { status: "submitted" },
    ]);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decisions WHERE proposal_id = ?", [proposalId]),
    ).resolves.toEqual([]);
  });

  it("rolls back acceptance when a concurrent speaker addition changes the enumerated roster", async () => {
    const { proposalId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const [admin] = await queryAll<{ id: string; email: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
    const racingDb = raceBeforeFirstBatch(async () => {
      const lateSpeaker = await findOrCreateUser(env.DB, {
        email: "late-roster-speaker@example.test",
        firstName: "Late",
        lastName: "Speaker",
      });
      await addProposalSpeaker(env.DB, { proposalId, userId: lateSpeaker.id, role: "speaker" });
    });

    await expect(
      finalizeProposalDecision(racingDb, {
        proposalId,
        actor: { identityType: "user", id: admin.id, email: admin.email, grants: administratorGrants },
        finalStatus: "accepted",
        minReviewsRequired: 0,
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_DECISION_CONFLICT" });
    await expect(queryAll(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId])).resolves.toEqual([
      { status: "submitted" },
    ]);
    await expect(
      queryAll(
        env.DB,
        `SELECT status
         FROM event_participant_role_sources
         WHERE event_id = ? AND source_type = 'proposal' AND source_ref = ?`,
        [eventId, proposalId],
      ),
    ).resolves.toSatisfy(
      (rows: Array<{ status: string }>) => rows.length > 0 && rows.every((row) => row.status === "inactive"),
    );
  });

  it("rolls back a speaker decline when another accepted proposal changes the same source set", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    const [admin] = await queryAll<{ id: string; email: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
    const { proposal: secondProposal } = await createProposal(env.DB, {
      eventId,
      proposerUserId: admin.id,
      proposalType: "talk",
      title: "Concurrent source proposal",
      abstract: "A second accepted proposal used to exercise the source-set revision guard.",
    });
    await addProposalSpeaker(env.DB, { proposalId: secondProposal.id, userId: admin.id, role: "proposer" });
    const { manageToken: secondSpeakerToken } = await addProposalSpeaker(env.DB, {
      proposalId: secondProposal.id,
      userId: coSpeakerUserId,
      role: "co_speaker",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    await finalizeProposalDecision(env.DB, {
      proposalId: secondProposal.id,
      actor: { identityType: "user", id: admin.id, email: admin.email, grants: administratorGrants },
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

    const racingDb = raceBeforeFirstBatch(async () => {
      await declineSpeakerParticipation(env.DB, secondSpeakerToken, env.INTERNAL_SIGNING_SECRET!, {
        appBaseUrl: "https://app.test",
        reason: "Concurrent schedule conflict",
      });
    });
    await expect(
      declineSpeakerParticipation(racingDb, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        appBaseUrl: "https://app.test",
        reason: "Primary schedule conflict",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "invited" }]);
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        secondProposal.id,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "declined" }]);
    await expect(registrationAdmissionRole(env.DB, registrationId)).resolves.toBe("speaker");
  });

  it("rolls back a speaker decline when a concurrent manual source changes capacity eligibility", async () => {
    const { proposalId, coSpeakerUserId, speakerManageToken } =
      await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const registrationId = await seedAcceptedSpeakerRegistration({
      eventId,
      proposalId,
      speakerUserId: coSpeakerUserId,
    });
    const racingDb = raceBeforeFirstBatch(async () => {
      await env.DB.prepare(
        `INSERT INTO event_participants
             (id, event_id, user_id, role, status, source_type, source_ref, created_at, updated_at)
           VALUES (?, ?, ?, 'organizer', 'active', 'manual', 'manual-race', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), eventId, coSpeakerUserId)
        .run();
    });
    await expect(
      declineSpeakerParticipation(racingDb, speakerManageToken, env.INTERNAL_SIGNING_SECRET!, {
        appBaseUrl: "https://app.test",
        reason: "Primary schedule conflict",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROPOSAL_SPEAKER_CONFLICT" });
    await expect(
      queryAll(env.DB, "SELECT status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?", [
        proposalId,
        coSpeakerUserId,
      ]),
    ).resolves.toEqual([{ status: "invited" }]);
    await expect(registrationAdmissionRole(env.DB, registrationId)).resolves.toBe("organizer");
  });
});
