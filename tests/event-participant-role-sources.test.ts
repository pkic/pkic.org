import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EVENT_PARTICIPANT_ROLES,
  eventParticipantRoleSchema,
  socialBadgeRoleSchema,
  type ProposalSpeakerRole,
} from "../assets/shared/schemas/participant-roles";
import { participantRoleForProposalRole } from "../functions/_lib/services/proposal-role-capacity";
import { addProposalSpeaker } from "../functions/_lib/services/proposal-speakers";
import { createProposal } from "../functions/_lib/services/proposals";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

async function seedUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

async function acceptedProposal(eventId: string, proposerUserId: string, title: string): Promise<string> {
  const { proposal } = await createProposal(env.DB, {
    eventId,
    proposerUserId,
    proposalType: "talk",
    title,
    abstract: `A sufficiently detailed abstract for ${title}.`,
  });
  await env.DB.prepare("UPDATE session_proposals SET status = 'accepted' WHERE id = ?").bind(proposal.id).run();
  return proposal.id;
}

describe("event participant role sources", () => {
  beforeEach(resetDb);

  it("preserves proposal and direct source multiplicity while deriving one effective role", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
    const speakerId = await seedUser("multi-source-speaker@example.test");
    const firstProposalId = await acceptedProposal(eventId, adminId, "First source proposal");
    const secondProposalId = await acceptedProposal(eventId, adminId, "Second source proposal");
    await addProposalSpeaker(env.DB, { proposalId: firstProposalId, userId: speakerId, role: "co_speaker" });
    await addProposalSpeaker(env.DB, { proposalId: secondProposalId, userId: speakerId, role: "co_speaker" });

    const manualSourceId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event_participants
         (id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at)
       VALUES (?, ?, ?, 'speaker', 'co_speaker', 'active', 'manual', ?, datetime('now'), datetime('now'))`,
    )
      .bind(manualSourceId, eventId, speakerId, manualSourceId)
      .run();

    const sources = await queryAll<{ source_kind: string; source_ref: string; status: string }>(
      env.DB,
      `SELECT source_kind, source_ref, status
       FROM event_participant_role_sources
       WHERE event_id = ? AND user_id = ? AND role = 'speaker' AND subrole = 'co_speaker'
       ORDER BY source_kind, source_ref`,
      [eventId, speakerId],
    );
    expect(sources).toEqual([
      { source_kind: "event_participant", source_ref: manualSourceId, status: "active" },
      ...[firstProposalId, secondProposalId]
        .sort()
        .map((sourceRef) => ({ source_kind: "proposal_speaker", source_ref: sourceRef, status: "active" })),
    ]);
    await expect(
      queryAll(
        env.DB,
        "SELECT source_count, active_source_count, status FROM effective_event_participant_roles WHERE event_id = ? AND user_id = ? AND role = 'speaker' AND subrole = 'co_speaker'",
        [eventId, speakerId],
      ),
    ).resolves.toEqual([{ source_count: 3, active_source_count: 3, status: "active" }]);
    await expect(
      queryAll(env.DB, "SELECT id FROM event_participants WHERE event_id = ? AND user_id = ?", [eventId, speakerId]),
    ).resolves.toEqual([{ id: manualSourceId }]);

    await env.DB.batch([
      env.DB.prepare("UPDATE session_proposals SET status = 'withdrawn' WHERE id = ?").bind(firstProposalId),
      env.DB.prepare("UPDATE session_proposals SET status = 'withdrawn' WHERE id = ?").bind(secondProposalId),
      env.DB.prepare("UPDATE event_participants SET status = 'inactive' WHERE id = ?").bind(manualSourceId),
    ]);
    await expect(
      queryAll(
        env.DB,
        "SELECT source_count, active_source_count, status FROM effective_event_participant_roles WHERE event_id = ? AND user_id = ? AND role = 'speaker' AND subrole = 'co_speaker'",
        [eventId, speakerId],
      ),
    ).resolves.toEqual([{ source_count: 3, active_source_count: 0, status: "inactive" }]);
  });

  it("keeps proposal-role mapping aligned with the persisted event-role contract", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [{ id: adminId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin'");
    const proposalId = await acceptedProposal(eventId, adminId, "Role mapping proposal");
    const roles = ["proposer", "speaker", "co_speaker", "moderator", "panelist"] as const;
    for (const role of roles) {
      const userId = await seedUser(`${role}@role-mapping.example.test`);
      await addProposalSpeaker(env.DB, { proposalId, userId, role });
    }

    const mapped = await queryAll<{ source_role: string; role: string; subrole: string | null }>(
      env.DB,
      `SELECT ps.role AS source_role, eps.role, eps.subrole
       FROM event_participant_role_sources eps
       JOIN proposal_speakers ps ON ps.id = eps.source_id
       WHERE eps.source_kind = 'proposal_speaker' AND eps.source_ref = ?
       ORDER BY ps.role`,
      [proposalId],
    );
    expect(mapped).toEqual([
      { source_role: "co_speaker", role: "speaker", subrole: "co_speaker" },
      { source_role: "moderator", role: "moderator", subrole: null },
      { source_role: "panelist", role: "panelist", subrole: null },
      { source_role: "proposer", role: "speaker", subrole: "proposer" },
      { source_role: "speaker", role: "speaker", subrole: "speaker" },
    ]);
    for (const mapping of mapped) {
      expect(participantRoleForProposalRole(mapping.source_role as ProposalSpeakerRole)).toEqual({
        role: mapping.role,
        subrole: mapping.subrole,
      });
    }
    expect(() => participantRoleForProposalRole("facilitator" as ProposalSpeakerRole)).toThrow(
      "Unsupported proposal participant role",
    );
    expect(EVENT_PARTICIPANT_ROLES).toEqual(["attendee", "speaker", "moderator", "panelist", "organizer", "staff"]);
    expect(eventParticipantRoleSchema.safeParse("proposer").success).toBe(false);
    expect(eventParticipantRoleSchema.safeParse("co_speaker").success).toBe(false);
    expect(socialBadgeRoleSchema.safeParse("proposer").success).toBe(true);
    expect(socialBadgeRoleSchema.safeParse("co_speaker").success).toBe(true);
  });

  it("derives attendee state from registration changes and ignores legacy attendee projections", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const userId = await seedUser("derived-attendee@example.test");
    const registrationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
      ).bind(registrationId, eventId, userId, crypto.randomUUID()),
      env.DB.prepare(
        `INSERT INTO event_participants
           (id, event_id, user_id, role, subrole, status, source_type, created_at, updated_at)
         VALUES (?, ?, ?, 'attendee', 'virtual', 'active', 'direct', datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), eventId, userId),
    ]);

    await expect(
      queryAll(
        env.DB,
        "SELECT source_kind, subrole, status FROM event_participant_role_sources WHERE event_id = ? AND user_id = ? AND role = 'attendee'",
        [eventId, userId],
      ),
    ).resolves.toEqual([{ source_kind: "registration", subrole: "virtual", status: "active" }]);
    await env.DB.prepare("UPDATE registrations SET attendance_type = 'in_person' WHERE id = ?")
      .bind(registrationId)
      .run();
    await expect(
      queryAll(
        env.DB,
        "SELECT source_kind, subrole, status FROM event_participant_role_sources WHERE event_id = ? AND user_id = ? AND role = 'attendee'",
        [eventId, userId],
      ),
    ).resolves.toEqual([{ source_kind: "registration", subrole: "in_person", status: "active" }]);
    await env.DB.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").bind(registrationId).run();
    await expect(
      queryAll(
        env.DB,
        "SELECT status FROM effective_event_participant_roles WHERE event_id = ? AND user_id = ? AND role = 'attendee'",
        [eventId, userId],
      ),
    ).resolves.toEqual([{ status: "inactive" }]);
  });

  it("retains a standalone attendee source when no registration exists", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const userId = await seedUser("standalone-attendee@example.test");
    const sourceId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event_participants
         (id, event_id, user_id, role, subrole, status, source_type, created_at, updated_at)
       VALUES (?, ?, ?, 'attendee', 'virtual', 'active', 'import', datetime('now'), datetime('now'))`,
    )
      .bind(sourceId, eventId, userId)
      .run();

    await expect(
      queryAll(
        env.DB,
        `SELECT source_kind, source_id, role, subrole, status
         FROM event_participant_role_sources
         WHERE event_id = ? AND user_id = ?`,
        [eventId, userId],
      ),
    ).resolves.toEqual([
      {
        source_kind: "event_participant",
        source_id: sourceId,
        role: "attendee",
        subrole: "virtual",
        status: "active",
      },
    ]);
  });

  it("keeps person-scoped source reads index-backed", async () => {
    await seedEventAndAdmin(env.DB);
    const userId = await seedUser("role-plan@example.test");
    const plan = await queryAll<{ detail: string }>(
      env.DB,
      `EXPLAIN QUERY PLAN
       SELECT source_kind, role, status
       FROM event_participant_role_sources
       WHERE user_id = ?`,
      [userId],
    );
    const details = plan.map((row) => row.detail).join("\n");
    expect(details).toContain("idx_event_participants_user_event_status_role");
    expect(details).toContain("idx_registrations_user_event_status");
    expect(details).toContain("idx_proposal_speakers_user_proposal_status_role");
    expect(details).not.toMatch(/SCAN (?:ep|r|ps)(?:\s|$)/);
  });
});
