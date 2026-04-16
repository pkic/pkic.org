/**
 * reminder-cycle.test.ts
 *
 * Covers runReminderCycle in functions/_lib/services/reminders.ts:
 *  - Attendee invite reminders (token refreshed, inviters fetched, email queued, state updated)
 *  - Attendee invite filtered out when event has already started
 *  - Co-speaker invite reminders (manage token refreshed, email queued, state updated)
 *  - Presentation upload reminders
 *  - Registration confirmation reminders (new token issued, state updated)
 *  - Dry-run: preview populated, no DB writes performed
 *  - Limit budget respected across sections
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { runReminderCycle } from "../functions/_lib/services/reminders";
import type { Env } from "../functions/_lib/types";

const db = (env as unknown as Env).DB;

const BASE_URL = "https://app.test";
const BASE_PAYLOAD = {
  appBaseUrl: BASE_URL,
  reminderIntervalDays: 0, // cutoff = now → any past communication is eligible
  maxInviteReminders: 3,
  maxPresentationReminders: 3,
  limit: 100,
};

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function insertUser(
  id: string,
  email: string,
  firstName = "Test",
  lastName = "User",
  org: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, organization_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
    )
    .bind(id, email, email.toLowerCase(), firstName, lastName, org)
    .run();
}

async function insertAttendeeInvite(
  id: string,
  eventId: string,
  email: string,
  opts: { reminderCount?: number; expiresAt?: string } = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invites
         (id, event_id, invitee_email, invitee_first_name, invitee_last_name, invite_type, token_hash,
          status, reminder_count, last_communication_at, expires_at, source_type, max_uses, used_count, created_at)
       VALUES (?, ?, ?, 'Alice', 'Attendee', 'attendee', ?, 'sent', ?, datetime('now', '-2 days'), ?, 'direct', 1, 0, datetime('now', '-2 days'))`,
    )
    .bind(id, eventId, email, `initial-hash-${id}`, opts.reminderCount ?? 0, opts.expiresAt ?? null)
    .run();
}

async function insertProposalAndSpeaker(opts: {
  proposalId: string;
  speakerId: string;
  userId: string;
  eventId: string;
  proposalStatus?: string;
  speakerStatus?: string;
  speakerRole?: string;
  reminderCount?: number;
  presentationDeadline?: string | null;
}): Promise<void> {
  const proposerId = opts.userId;
  const proposalStatus = opts.proposalStatus ?? "submitted";

  await db
    .prepare(
      `INSERT INTO session_proposals
         (id, event_id, proposer_user_id, status, proposal_type, title, abstract,
          manage_token_hash, submitted_at, updated_at)
       VALUES (?, ?, ?, ?, 'talk', 'Test Proposal', 'Abstract text.',
               ?, datetime('now', '-3 days'), datetime('now', '-3 days'))`,
    )
    .bind(opts.proposalId, opts.eventId, proposerId, proposalStatus, `proposal-manage-hash-${opts.proposalId}`)
    .run();

  await db
    .prepare(
      `INSERT INTO proposal_speakers
         (id, proposal_id, user_id, role, status, manage_token_hash,
          speaker_invite_reminder_count, presentation_reminder_count, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, datetime('now', '-2 days'))`,
    )
    .bind(
      opts.speakerId,
      opts.proposalId,
      opts.userId,
      opts.speakerRole ?? "co_speaker",
      opts.speakerStatus ?? "invited",
      opts.reminderCount ?? 0,
      opts.reminderCount ?? 0,
    )
    .run();

  if (opts.presentationDeadline !== undefined) {
    await db
      .prepare(`UPDATE session_proposals SET presentation_deadline = ? WHERE id = ?`)
      .bind(opts.presentationDeadline, opts.proposalId)
      .run();
  }
}

async function insertPendingRegistration(opts: {
  regId: string;
  eventId: string;
  userId: string;
  /** ISO string — must be within the next 24 h to trigger the reminder */
  confirmationExpiresAt: string;
}): Promise<void> {
  const hash = `conf-hash-${opts.regId}`;
  const manageHash = `manage-hash-${opts.regId}`;
  await db
    .prepare(
      `INSERT INTO registrations
         (id, event_id, user_id, status, attendance_type, source_type,
          confirmation_token_hash, confirmation_token_expires_at, manage_token_hash,
          created_at, updated_at)
       VALUES (?, ?, ?, 'pending_email_confirmation', 'virtual', 'open',
               ?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .bind(opts.regId, opts.eventId, opts.userId, hash, opts.confirmationExpiresAt, manageHash)
    .run();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runReminderCycle", () => {
  let eventId: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(db));
    // The seeded event starts at 2026-12-01 — well in the future.
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Section 1: Attendee invites ──────────────────────────────────────────────

  it("queues an email and updates state for an eligible attendee invite", async () => {
    const userId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    await insertUser(userId, "alice@example.test", "Alice", "Attendee");
    await insertAttendeeInvite(inviteId, eventId, "alice@example.test");

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.inviteRemindersQueued).toBe(1);
    expect(result.preview.attendeeInvites).toHaveLength(1);
    expect(result.preview.attendeeInvites[0].recipientEmail).toBe("alice@example.test");

    // Token must have been refreshed (hash changed)
    const invite = (
      await queryAll<{ token_hash: string; reminder_count: number; last_communication_at: string }>(
        db,
        "SELECT token_hash, reminder_count, last_communication_at FROM invites WHERE id = ?",
        inviteId,
      )
    )[0];
    expect(invite.token_hash).not.toBe(`initial-hash-${inviteId}`);
    expect(invite.reminder_count).toBe(1);
    expect(invite.last_communication_at).not.toBeNull();

    // Email queued in outbox
    const outbox = await queryAll<{ template_key: string; recipient_email: string }>(
      db,
      "SELECT template_key, recipient_email FROM email_outbox",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].template_key).toBe("attendee_invite");
    expect(outbox[0].recipient_email).toBe("alice@example.test");
  });

  it("includes inviter name in the queued email payload when invite_inviters exist", async () => {
    const userId = crypto.randomUUID();
    const inviterId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    await insertUser(userId, "alice@example.test", "Alice", "Attendee");
    await insertUser(inviterId, "inviter@example.test", "Bob", "Inviter", "Acme Inc");
    await insertAttendeeInvite(inviteId, eventId, "alice@example.test");

    // Record the inviter
    await db
      .prepare(
        `INSERT INTO invite_inviters (id, invite_id, inviter_user_id, source_type, invited_at)
         VALUES (?, ?, ?, 'direct', datetime('now'))`,
      )
      .bind(crypto.randomUUID(), inviteId, inviterId)
      .run();

    await runReminderCycle(db, BASE_PAYLOAD);

    const outbox = await queryAll<{ payload_json: string }>(
      db,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'attendee_invite'",
    );
    expect(outbox).toHaveLength(1);
    const payload = JSON.parse(outbox[0].payload_json) as Record<string, string>;
    expect(payload.inviterName).toContain("Bob Inviter");
  });

  it("skips attendee invite when the event has already started", async () => {
    // Override the seeded event to be in the past
    await db.prepare("UPDATE events SET starts_at = datetime('now', '-1 day') WHERE id = ?").bind(eventId).run();

    const inviteId = crypto.randomUUID();
    await insertAttendeeInvite(inviteId, eventId, "past@example.test");

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.inviteRemindersQueued).toBe(0);
    expect(result.preview.attendeeInvites).toHaveLength(0);
    const outbox = await queryAll(db, "SELECT id FROM email_outbox");
    expect(outbox).toHaveLength(0);
  });

  it("skips attendee invite that has reached the reminder limit", async () => {
    const inviteId = crypto.randomUUID();
    await insertAttendeeInvite(inviteId, eventId, "capped@example.test", { reminderCount: 3 });

    const result = await runReminderCycle(db, { ...BASE_PAYLOAD, maxInviteReminders: 3 });

    expect(result.inviteRemindersQueued).toBe(0);
  });

  // ── Section 2: Co-speaker invite reminders ───────────────────────────────────

  it("queues an email and updates state for an eligible co-speaker invite", async () => {
    const proposerId = crypto.randomUUID();
    const coSpeakerId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const speakerRowId = crypto.randomUUID();

    await insertUser(proposerId, "proposer@example.test", "Sam", "Proposer");
    await insertUser(coSpeakerId, "cospeaker@example.test", "Jo", "Speaker");
    await insertProposalAndSpeaker({
      proposalId,
      speakerId: speakerRowId,
      userId: coSpeakerId,
      eventId,
      proposalStatus: "submitted",
      speakerStatus: "invited",
      speakerRole: "co_speaker",
    });
    // Set proposer_user_id to proposerId on the proposal
    await db
      .prepare("UPDATE session_proposals SET proposer_user_id = ? WHERE id = ?")
      .bind(proposerId, proposalId)
      .run();

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.speakerInviteRemindersQueued).toBe(1);
    expect(result.preview.coSpeakerInvites).toHaveLength(1);
    expect(result.preview.coSpeakerInvites[0].recipientEmail).toBe("cospeaker@example.test");

    // Manage token must have been set
    const speaker = (
      await queryAll<{ manage_token_hash: string | null; speaker_invite_reminder_count: number }>(
        db,
        "SELECT manage_token_hash, speaker_invite_reminder_count FROM proposal_speakers WHERE id = ?",
        speakerRowId,
      )
    )[0];
    expect(speaker.manage_token_hash).not.toBeNull();
    expect(speaker.speaker_invite_reminder_count).toBe(1);

    // Email queued
    const outbox = await queryAll<{ template_key: string; recipient_email: string }>(
      db,
      "SELECT template_key, recipient_email FROM email_outbox",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].template_key).toBe("co_speaker_invite");
    expect(outbox[0].recipient_email).toBe("cospeaker@example.test");
  });

  it("skips co-speaker reminder when proposal is rejected", async () => {
    const userId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const speakerRowId = crypto.randomUUID();
    await insertUser(userId, "rejected@example.test");
    await insertProposalAndSpeaker({
      proposalId,
      speakerId: speakerRowId,
      userId,
      eventId,
      proposalStatus: "rejected",
      speakerStatus: "invited",
    });

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.speakerInviteRemindersQueued).toBe(0);
  });

  // ── Section 3: Presentation upload reminders ─────────────────────────────────

  it("queues an email and updates state for an eligible presentation reminder", async () => {
    const userId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const speakerRowId = crypto.randomUUID();
    await insertUser(userId, "speaker@example.test", "Sam", "Speaker");
    await insertProposalAndSpeaker({
      proposalId,
      speakerId: speakerRowId,
      userId,
      eventId,
      proposalStatus: "accepted",
      speakerStatus: "confirmed",
      speakerRole: "proposer",
      presentationDeadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.presentationRemindersQueued).toBe(1);
    expect(result.preview.presentationUploads).toHaveLength(1);
    expect(result.preview.presentationUploads[0].recipientEmail).toBe("speaker@example.test");

    const speaker = (
      await queryAll<{ presentation_reminder_count: number; manage_token_hash: string | null }>(
        db,
        "SELECT presentation_reminder_count, manage_token_hash FROM proposal_speakers WHERE id = ?",
        speakerRowId,
      )
    )[0];
    expect(speaker.presentation_reminder_count).toBe(1);
    expect(speaker.manage_token_hash).not.toBeNull();

    const outbox = await queryAll<{ template_key: string }>(db, "SELECT template_key FROM email_outbox");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].template_key).toBe("presentation_upload_request");
  });

  it("skips presentation reminder when slide has already been uploaded", async () => {
    const userId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const speakerRowId = crypto.randomUUID();
    await insertUser(userId, "done@example.test");
    await insertProposalAndSpeaker({
      proposalId,
      speakerId: speakerRowId,
      userId,
      eventId,
      proposalStatus: "accepted",
      speakerStatus: "confirmed",
    });
    await db
      .prepare("UPDATE session_proposals SET presentation_uploaded_at = datetime('now') WHERE id = ?")
      .bind(proposalId)
      .run();

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.presentationRemindersQueued).toBe(0);
  });

  // ── Section 4: Registration confirmation reminders ────────────────────────────

  it("queues an email, refreshes the token, and marks reminder sent for a pending confirmation", async () => {
    const userId = crypto.randomUUID();
    const regId = crypto.randomUUID();
    await insertUser(userId, "confirm@example.test", "Chris", "Reg");
    // Token expires in 12 hours — within the <24 h window
    const expiresAt = new Date(Date.now() + 12 * 3_600_000).toISOString();
    await insertPendingRegistration({ regId, eventId, userId, confirmationExpiresAt: expiresAt });

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.confirmationRemindersQueued).toBe(1);
    expect(result.preview.registrationConfirmations).toHaveLength(1);
    expect(result.preview.registrationConfirmations[0].recipientEmail).toBe("confirm@example.test");

    // Token hash must have changed and reminder timestamp set
    const reg = (
      await queryAll<{
        confirmation_token_hash: string;
        confirmation_reminder_sent_at: string | null;
        confirmation_token_expires_at: string;
      }>(
        db,
        "SELECT confirmation_token_hash, confirmation_reminder_sent_at, confirmation_token_expires_at FROM registrations WHERE id = ?",
        regId,
      )
    )[0];
    expect(reg.confirmation_token_hash).not.toBe(`conf-hash-${regId}`);
    expect(reg.confirmation_reminder_sent_at).not.toBeNull();
    // Expiry must have been extended to ~48 h from now
    expect(new Date(reg.confirmation_token_expires_at).getTime()).toBeGreaterThan(Date.now() + 40 * 3_600_000);

    const outbox = await queryAll<{ template_key: string }>(db, "SELECT template_key FROM email_outbox");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].template_key).toBe("registration_confirmation_reminder");
  });

  it("skips confirmation reminder when expiry is more than 24 h away", async () => {
    const userId = crypto.randomUUID();
    const regId = crypto.randomUUID();
    await insertUser(userId, "early@example.test");
    // Expires in 48 h — outside the reminder window
    const expiresAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    await insertPendingRegistration({ regId, eventId, userId, confirmationExpiresAt: expiresAt });

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.confirmationRemindersQueued).toBe(0);
  });

  it("skips confirmation reminder when it has already been sent", async () => {
    const userId = crypto.randomUUID();
    const regId = crypto.randomUUID();
    await insertUser(userId, "already@example.test");
    const expiresAt = new Date(Date.now() + 12 * 3_600_000).toISOString();
    await insertPendingRegistration({ regId, eventId, userId, confirmationExpiresAt: expiresAt });
    await db
      .prepare("UPDATE registrations SET confirmation_reminder_sent_at = datetime('now') WHERE id = ?")
      .bind(regId)
      .run();

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.confirmationRemindersQueued).toBe(0);
  });

  // ── Dry-run ───────────────────────────────────────────────────────────────────

  it("dry-run returns preview candidates without writing to the DB", async () => {
    const inviteId = crypto.randomUUID();
    await insertAttendeeInvite(inviteId, eventId, "dryrun@example.test");

    const initialHash = (
      await queryAll<{ token_hash: string }>(db, "SELECT token_hash FROM invites WHERE id = ?", inviteId)
    )[0].token_hash;

    const result = await runReminderCycle(db, { ...BASE_PAYLOAD, dryRun: true });

    expect(result.inviteRemindersQueued).toBe(1);
    expect(result.preview.attendeeInvites).toHaveLength(1);

    // No DB writes: token unchanged, count unchanged, no outbox rows
    const invite = (
      await queryAll<{ token_hash: string; reminder_count: number }>(
        db,
        "SELECT token_hash, reminder_count FROM invites WHERE id = ?",
        inviteId,
      )
    )[0];
    expect(invite.token_hash).toBe(initialHash);
    expect(invite.reminder_count).toBe(0);

    const outbox = await queryAll(db, "SELECT id FROM email_outbox");
    expect(outbox).toHaveLength(0);
  });

  // ── Limit ─────────────────────────────────────────────────────────────────────

  it("respects the limit — stops queueing once the budget is exhausted", async () => {
    // Add 5 attendee invites
    for (let i = 0; i < 5; i++) {
      await insertAttendeeInvite(crypto.randomUUID(), eventId, `limited${i}@example.test`);
    }

    const result = await runReminderCycle(db, { ...BASE_PAYLOAD, limit: 3 });

    expect(result.inviteRemindersQueued).toBe(3);
    const outbox = await queryAll(db, "SELECT id FROM email_outbox");
    expect(outbox).toHaveLength(3);
  });

  // ── Multiple sections in one cycle ───────────────────────────────────────────

  it("processes all four reminder types in a single cycle", async () => {
    // Attendee invite
    await insertAttendeeInvite(crypto.randomUUID(), eventId, "att@example.test");

    // Co-speaker invite
    const coproposerId = crypto.randomUUID();
    const coUserId = crypto.randomUUID();
    const coProposalId = crypto.randomUUID();
    await insertUser(coproposerId, "coproposer@example.test", "CP", "Proposer");
    await insertUser(coUserId, "cospeaker2@example.test", "CS", "Speaker");
    await insertProposalAndSpeaker({
      proposalId: coProposalId,
      speakerId: crypto.randomUUID(),
      userId: coUserId,
      eventId,
      proposalStatus: "submitted",
      speakerStatus: "invited",
    });
    await db
      .prepare("UPDATE session_proposals SET proposer_user_id = ? WHERE id = ?")
      .bind(coproposerId, coProposalId)
      .run();

    // Presentation reminder
    const presUserId = crypto.randomUUID();
    const presProposalId = crypto.randomUUID();
    await insertUser(presUserId, "pres@example.test", "Pres", "Speaker");
    await insertProposalAndSpeaker({
      proposalId: presProposalId,
      speakerId: crypto.randomUUID(),
      userId: presUserId,
      eventId,
      proposalStatus: "accepted",
      speakerStatus: "confirmed",
      presentationDeadline: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });

    // Registration confirmation
    const confUserId = crypto.randomUUID();
    const confRegId = crypto.randomUUID();
    await insertUser(confUserId, "conf2@example.test", "Conf", "User");
    await insertPendingRegistration({
      regId: confRegId,
      eventId,
      userId: confUserId,
      confirmationExpiresAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });

    const result = await runReminderCycle(db, BASE_PAYLOAD);

    expect(result.inviteRemindersQueued).toBe(1);
    expect(result.speakerInviteRemindersQueued).toBe(1);
    expect(result.presentationRemindersQueued).toBe(1);
    expect(result.confirmationRemindersQueued).toBe(1);
    expect(result.processed).toBe(4);

    const outbox = await queryAll(db, "SELECT template_key FROM email_outbox");
    expect(outbox).toHaveLength(4);
    const keys = outbox.map((r) => (r as { template_key: string }).template_key).sort();
    expect(keys).toEqual(
      [
        "attendee_invite",
        "co_speaker_invite",
        "presentation_upload_request",
        "registration_confirmation_reminder",
      ].sort(),
    );
  });
});
