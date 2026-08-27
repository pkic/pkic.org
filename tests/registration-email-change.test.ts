import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { uuid } from "../functions/_lib/utils/ids";
import { nowIso, addHours } from "../functions/_lib/utils/time";
import {
  changeRegistrationEmail,
  confirmRegistrationByToken,
  createRegistration,
  finalizeEmailChange,
  updateRegistrationById,
  updateRegistrationByManageToken,
} from "../functions/_lib/services/registrations";
import { findOrCreateUser } from "../functions/_lib/services/users";
import {
  materializeQueuedCapabilityLinks,
  signCapabilityToken,
  verifyDatabaseCapability,
} from "../functions/_lib/services/capability-links";
import { getRegistrationConfirmationInfo } from "../functions/_lib/services/registrations/confirmation-info";
import { confirmRegistrationWithNotification } from "../functions/_lib/services/registrations/confirmation-workflow";
import { getEventById } from "../functions/_lib/services/events";
import { first, run } from "../functions/_lib/db/queries";
import { getRegistrationByManageToken } from "../functions/_lib/services/registrations/queries";
import { queueRegistrationStatusEmail } from "../functions/_lib/services/registrations/status-notifications";

describe("Registration Email Change", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // Helper to create test event
  async function createTestEvent(db: any = env.DB): Promise<string> {
    const eventId = uuid();
    const now = nowIso();
    await run(
      db,
      `INSERT INTO events (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, `event-${eventId.slice(0, 8)}`, "Test Event", "Europe/Amsterdam", "invite_or_open", 5, "{}", now, now],
    );
    return eventId;
  }

  async function reservePendingEmail(
    userId: string,
    registrationId: string,
    email: string,
    expiresAt: string,
  ): Promise<void> {
    await run(
      env.DB,
      `UPDATE users
          SET pending_email = ?, pending_email_expires_at = ?, pending_email_change_registration_id = ?
        WHERE id = ?`,
      [email, expiresAt, registrationId, userId],
    );
  }

  describe("changeRegistrationEmail", () => {
    it("stores pending email on user without creating new user", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, {
        email: "original@example.com",
        firstName: "John",
        lastName: "Doe",
      });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "newemail@example.com",
        authority: { kind: "event_manager", actorUserId: reg.user_id },
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      expect(result.userId).toBe(user.id);
      expect(result.pendingEmail).toBe("newemail@example.com");
      expect(result.confirmationToken).toBeTruthy();
      expect(result.previousEmail).toBe("original@example.com");

      // Verify user still has original email
      const dbUser = await first<{ email: string; pending_email: string }>(
        env.DB,
        "SELECT email, pending_email FROM users WHERE id = ?",
        [user.id],
      );
      expect(dbUser?.email).toBe("original@example.com");
      expect(dbUser?.pending_email).toBe("newemail@example.com");
    });

    it("sends confirmation to the new address and only a notice to the old address", async () => {
      const eventId = await createTestEvent();
      const event = await getEventById(env.DB, eventId);
      const user = await findOrCreateUser(env.DB, { email: "current-proof@example.com" });
      const { registration } = await createRegistration(env.DB, {
        event,
        userId: user.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: registration.id,
        newEmail: "attacker-controlled@example.com",
        authority: { kind: "event_manager", actorUserId: registration.user_id },
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
        confirmationEmail: { event, appBaseUrl: "https://app.test", confirmationTtlHours: 24 },
      });

      expect(
        await first<{ recipient_email: string; template_key: string }>(
          env.DB,
          "SELECT recipient_email, template_key FROM email_outbox WHERE id = ?",
          [result.outboxId],
        ),
      ).toEqual({ recipient_email: "attacker-controlled@example.com", template_key: "registration_email_change" });
      expect(
        await first<{ recipient_email: string; template_key: string; payload_json: string }>(
          env.DB,
          "SELECT recipient_email, template_key, payload_json FROM email_outbox WHERE id = ?",
          [result.outboxIds[1]],
        ),
      ).toEqual({
        recipient_email: "current-proof@example.com",
        template_key: "registration_email_change_notice",
        payload_json: expect.not.stringContaining("__capabilityLinks"),
      });
    });

    it("rejects if new email is same as current", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, {
        email: "original@example.com",
      });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "original@example.com",
          authority: { kind: "event_manager", actorUserId: reg.user_id },
          confirmationTtlHours: 24,
          signingSecret: "test-signing-secret",
        }),
      ).rejects.toThrow("The new email address is the same as the current one");
    });

    it("rejects an address reserved as another user's secondary email", async () => {
      const eventId = await createTestEvent();
      const owner = await findOrCreateUser(env.DB, { email: "alias-owner@example.com" });
      await run(
        env.DB,
        "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)",
        [uuid(), owner.id, "reserved-alias@example.com", "reserved-alias@example.com", nowIso()],
      );
      const user = await findOrCreateUser(env.DB, { email: "alias-claimant@example.com" });
      const { registration } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: registration.id,
          newEmail: "reserved-alias@example.com",
          authority: { kind: "event_manager", actorUserId: registration.user_id },
          confirmationTtlHours: 24,
          signingSecret: "test-signing-secret",
        }),
      ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    });

    it("resets registration to pending confirmation", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, {
        email: "test@example.com",
      });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "another@example.com",
        authority: { kind: "event_manager", actorUserId: reg.user_id },
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      expect(result.registration.status).toBe("pending_email_confirmation");
      expect(result.registration.confirmation_link_secret).toBeTruthy();
      expect(result.registration.confirmed_at).toBeNull();
    });

    it("allows email change on cancelled registration with allowCancelled flag", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, {
        email: "test@example.com",
      });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      await run(env.DB, "UPDATE registrations SET status = 'cancelled' WHERE id = ?", [reg.id]);

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "cancelled-recovery@example.com",
        authority: { kind: "event_manager", actorUserId: reg.user_id },
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
        allowCancelled: true,
      });

      expect(result.registration.status).toBe("pending_email_confirmation");
    });

    it("rejects email change on cancelled registration without allowCancelled", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, {
        email: "test@example.com",
      });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      await run(env.DB, "UPDATE registrations SET status = 'cancelled' WHERE id = ?", [reg.id]);

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "test@example.com",
          authority: { kind: "event_manager", actorUserId: reg.user_id },
          confirmationTtlHours: 24,
          signingSecret: "test-signing-secret",
        }),
      ).rejects.toThrow("Cannot change email on a cancelled registration");
    });
  });

  describe("registration ownership", () => {
    it("keeps self-service attendance edits pending until email confirmation", async () => {
      const signingSecret = "test-signing-secret";
      const eventId = await createTestEvent();
      const dayDate = "2026-12-01";
      await run(
        env.DB,
        `INSERT INTO event_days
           (id, event_id, day_date, label, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'Conference day', 1, datetime('now'), datetime('now'))`,
        [uuid(), eventId, dayDate],
      );
      const user = await findOrCreateUser(env.DB, { email: "pending-edit@example.com" });
      const created = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret,
      });
      const manageToken = await signCapabilityToken({
        signingSecret,
        linkSecret: created.registration.manage_link_secret,
        purpose: "registration_manage",
        resourceId: created.registration.id,
      });

      const updated = await updateRegistrationByManageToken(env.DB, {
        manageToken,
        signingSecret,
        action: "update",
        attendanceType: "in_person",
        dayAttendance: [{ dayDate, attendanceType: "in_person" }],
      });

      expect(updated.status).toBe("pending_email_confirmation");
      expect(
        await first<{ status: string; confirmation_link_secret: string | null }>(
          env.DB,
          "SELECT status, confirmation_link_secret FROM registrations WHERE id = ?",
          [created.registration.id],
        ),
      ).toEqual({
        status: "pending_email_confirmation",
        confirmation_link_secret: created.registration.confirmation_link_secret,
      });
    });

    it("allows only the owning registration confirmation to promote the pending email", async () => {
      const signingSecret = "test-signing-secret";
      const ownerEventId = await createTestEvent();
      const otherEventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, { email: "bound-original@example.com" });
      const owner = await createRegistration(env.DB, {
        event: { id: ownerEventId },
        userId: user.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret,
      });
      const other = await createRegistration(env.DB, {
        event: { id: otherEventId },
        userId: user.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret,
      });
      const ownerEvent = await getEventById(env.DB, ownerEventId);
      const oldManageToken = await signCapabilityToken({
        signingSecret,
        linkSecret: owner.registration.manage_link_secret,
        purpose: "registration_manage",
        resourceId: owner.registration.id,
      });
      const siblingManageToken = await signCapabilityToken({
        signingSecret,
        linkSecret: other.registration.manage_link_secret,
        purpose: "registration_manage",
        resourceId: other.registration.id,
      });
      const delayedStatus = await queueRegistrationStatusEmail(env.DB, {
        event: ownerEvent,
        registrationId: owner.registration.id,
        appBaseUrl: "https://app.test",
        templateKey: "registration_updated",
        subject: "Delayed status update",
      });
      const change = await changeRegistrationEmail(env.DB, {
        registrationId: owner.registration.id,
        newEmail: "bound-new@example.com",
        authority: { kind: "event_manager", actorUserId: owner.registration.user_id },
        confirmationTtlHours: 24,
        signingSecret,
      });
      expect(other.confirmationToken).not.toBeNull();
      expect(
        await getRegistrationConfirmationInfo(env.DB, `event-${ownerEventId.slice(0, 8)}`, owner.registration.id),
      ).toMatchObject({ email: "bound-new@example.com" });
      expect(
        await getRegistrationConfirmationInfo(env.DB, `event-${otherEventId.slice(0, 8)}`, other.registration.id),
      ).toMatchObject({ email: "bound-original@example.com" });

      await confirmRegistrationByToken(env.DB, {
        token: other.confirmationToken!,
        waitlistClaimWindowHours: 24,
        signingSecret,
      });

      expect(
        await first<{
          email: string;
          pending_email: string | null;
          pending_email_change_registration_id: string | null;
        }>(env.DB, "SELECT email, pending_email, pending_email_change_registration_id FROM users WHERE id = ?", [
          user.id,
        ]),
      ).toEqual({
        email: "bound-original@example.com",
        pending_email: "bound-new@example.com",
        pending_email_change_registration_id: owner.registration.id,
      });

      const newAddressConfirmation = await confirmRegistrationWithNotification(env.DB, {
        event: ownerEvent,
        token: change.confirmationToken,
        registrationId: owner.registration.id,
        waitlistClaimWindowHours: 24,
        confirmationTtlHours: 24,
        signingSecret,
        appBaseUrl: "https://app.test",
      });
      expect(newAddressConfirmation.stage).toBe("confirmed");

      await expect(
        confirmRegistrationByToken(env.DB, {
          token: change.confirmationToken,
          waitlistClaimWindowHours: 24,
          signingSecret,
        }),
      ).rejects.toMatchObject({ code: "CONFIRM_TOKEN_INVALID" });

      await expect(getRegistrationByManageToken(env.DB, oldManageToken, signingSecret)).rejects.toMatchObject({
        code: "REGISTRATION_NOT_FOUND",
      });
      await expect(getRegistrationByManageToken(env.DB, siblingManageToken, signingSecret)).rejects.toMatchObject({
        code: "REGISTRATION_NOT_FOUND",
      });
      await expect(
        materializeQueuedCapabilityLinks(
          env.DB,
          env,
          JSON.parse(
            (await first<{ payload_json: string }>(env.DB, "SELECT payload_json FROM email_outbox WHERE id = ?", [
              delayedStatus.outboxId,
            ]))!.payload_json,
          ) as Record<string, unknown>,
        ),
      ).rejects.toMatchObject({ code: "CAPABILITY_RESOURCE_STALE" });
      await expect(
        getRegistrationByManageToken(env.DB, newAddressConfirmation.manageToken, signingSecret),
      ).resolves.toMatchObject({ id: owner.registration.id });
      const freshStatus = await queueRegistrationStatusEmail(env.DB, {
        event: ownerEvent,
        registrationId: owner.registration.id,
        appBaseUrl: "https://app.test",
        templateKey: "registration_updated",
        subject: "Fresh status update",
      });
      const freshPayload = await materializeQueuedCapabilityLinks(
        env.DB,
        env,
        JSON.parse(
          (await first<{ payload_json: string }>(env.DB, "SELECT payload_json FROM email_outbox WHERE id = ?", [
            freshStatus.outboxId,
          ]))!.payload_json,
        ) as Record<string, unknown>,
      );
      const freshToken = new URL(freshPayload.manageUrl as string).searchParams.get("token")!;
      await expect(getRegistrationByManageToken(env.DB, freshToken, signingSecret)).resolves.toMatchObject({
        id: owner.registration.id,
      });

      expect(
        await first<{
          email: string;
          pending_email: string | null;
          pending_email_change_registration_id: string | null;
        }>(env.DB, "SELECT email, pending_email, pending_email_change_registration_id FROM users WHERE id = ?", [
          user.id,
        ]),
      ).toEqual({
        email: "bound-new@example.com",
        pending_email: null,
        pending_email_change_registration_id: null,
      });
    });

    it("does not let cancelling another registration clear the pending email change", async () => {
      const signingSecret = "test-signing-secret";
      const ownerEventId = await createTestEvent();
      const otherEventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, { email: "cancel-original@example.com" });
      const owner = await createRegistration(env.DB, {
        event: { id: ownerEventId },
        userId: user.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret,
      });
      const other = await createRegistration(env.DB, {
        event: { id: otherEventId },
        userId: user.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret,
      });
      await changeRegistrationEmail(env.DB, {
        registrationId: owner.registration.id,
        newEmail: "cancel-new@example.com",
        authority: { kind: "event_manager", actorUserId: owner.registration.user_id },
        confirmationTtlHours: 24,
        signingSecret,
      });

      await updateRegistrationById(
        env.DB,
        { eventId: otherEventId, registrationId: other.registration.id, action: "cancel" },
        "admin",
      );
      expect(
        await first<{ pending_email: string | null; pending_email_change_registration_id: string | null }>(
          env.DB,
          "SELECT pending_email, pending_email_change_registration_id FROM users WHERE id = ?",
          [user.id],
        ),
      ).toEqual({
        pending_email: "cancel-new@example.com",
        pending_email_change_registration_id: owner.registration.id,
      });

      await updateRegistrationById(
        env.DB,
        { eventId: ownerEventId, registrationId: owner.registration.id, action: "cancel" },
        "admin",
      );
      expect(
        await first<{ pending_email: string | null; pending_email_change_registration_id: string | null }>(
          env.DB,
          "SELECT pending_email, pending_email_change_registration_id FROM users WHERE id = ?",
          [user.id],
        ),
      ).toEqual({ pending_email: null, pending_email_change_registration_id: null });
    });

    it("rejects a confirmation through the wrong event before touching the pending change", async () => {
      const signingSecret = "test-signing-secret";
      const eventId = await createTestEvent();
      const wrongEventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, { email: "event-bound-original@example.com" });
      const created = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret,
      });
      const change = await changeRegistrationEmail(env.DB, {
        registrationId: created.registration.id,
        newEmail: "event-bound-new@example.com",
        authority: { kind: "event_manager", actorUserId: created.registration.user_id },
        confirmationTtlHours: 24,
        signingSecret,
      });

      await expect(
        confirmRegistrationByToken(env.DB, {
          token: change.confirmationToken,
          eventId: wrongEventId,
          waitlistClaimWindowHours: 24,
          signingSecret,
        }),
      ).rejects.toMatchObject({ code: "CONFIRM_TOKEN_INVALID" });
      expect(
        await first<{ pending_email: string | null; pending_email_change_registration_id: string | null }>(
          env.DB,
          "SELECT pending_email, pending_email_change_registration_id FROM users WHERE id = ?",
          [user.id],
        ),
      ).toEqual({
        pending_email: "event-bound-new@example.com",
        pending_email_change_registration_id: created.registration.id,
      });
    });
  });

  describe("finalizeEmailChange", () => {
    it("does not require old-mailbox proof after the new address was confirmed", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, { email: "proof-required@example.com" });
      const { registration } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      await reservePendingEmail(user.id, registration.id, "new-confirmed@example.com", addHours(nowIso(), 24));

      await finalizeEmailChange(env.DB, { userId: user.id, eventId, registrationId: registration.id });
      expect(await first<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [user.id])).toEqual({
        email: "new-confirmed@example.com",
      });
    });

    it("finalizes email change and clears pending email", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, {
        email: "finalize-test@example.com",
      });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      const oldManageToken = await signCapabilityToken({
        signingSecret: "test-signing-secret",
        linkSecret: reg.manage_link_secret,
        purpose: "registration_manage",
        resourceId: reg.id,
      });
      const proposalId = uuid();
      const speakerId = uuid();
      const speakerLinkSecret = uuid();
      const speakerToken = await signCapabilityToken({
        signingSecret: "test-signing-secret",
        linkSecret: speakerLinkSecret,
        purpose: "speaker_manage",
        resourceId: speakerId,
      });
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO session_proposals
               (id, event_id, proposer_user_id, status, proposal_type, title, abstract,
                manage_link_secret, submitted_at, updated_at)
             VALUES (?, ?, ?, 'submitted', 'talk', 'Email change', 'Abstract', ?, datetime('now'), datetime('now'))`,
        ).bind(proposalId, eventId, user.id, uuid()),
        env.DB.prepare(
          `INSERT INTO proposal_speakers
               (id, proposal_id, user_id, role, status, manage_link_secret, created_at)
             VALUES (?, ?, ?, 'speaker', 'confirmed', ?, datetime('now'))`,
        ).bind(speakerId, proposalId, user.id, speakerLinkSecret),
      ]);

      // Set pending email
      const now = nowIso();
      await reservePendingEmail(user.id, reg.id, "pending@example.com", addHours(now, 24));
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(uuid(), user.id, `session-${uuid()}`, addHours(now, 24), now),
        env.DB.prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, issued_at, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
        ).bind(uuid(), user.id, `refresh-${uuid()}`, now, addHours(now, 24)),
      ]);

      const result = await finalizeEmailChange(env.DB, {
        userId: user.id,
        eventId,
        registrationId: reg.id,
      });

      expect(result.finalEmail).toBe("pending@example.com");

      const dbUser = await first<{ email: string; pending_email: string | null }>(
        env.DB,
        "SELECT email, pending_email FROM users WHERE id = ?",
        [user.id],
      );
      expect(dbUser?.email).toBe("pending@example.com");
      expect(dbUser?.pending_email).toBeNull();
      await expect(getRegistrationByManageToken(env.DB, oldManageToken, "test-signing-secret")).rejects.toMatchObject({
        code: "REGISTRATION_NOT_FOUND",
      });
      await expect(
        verifyDatabaseCapability({
          db: env.DB,
          signingSecret: "test-signing-secret",
          purpose: "speaker_manage",
          token: speakerToken,
        }),
      ).resolves.toEqual({ ok: false, reason: "invalid" });
      expect(
        await first<{ active_sessions: number; active_refresh_tokens: number }>(
          env.DB,
          `SELECT
             (SELECT COUNT(*) FROM sessions WHERE user_id = ? AND revoked_at IS NULL) AS active_sessions,
             (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL) AS active_refresh_tokens`,
          [user.id, user.id],
        ),
      ).toEqual({ active_sessions: 0, active_refresh_tokens: 0 });
    });

    it("promotes the same user's secondary alias without duplicating ownership", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, { email: "alias-primary@example.com" });
      const { registration } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      await run(
        env.DB,
        "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)",
        [uuid(), user.id, "promoted@example.com", "promoted@example.com", nowIso()],
      );
      await reservePendingEmail(user.id, registration.id, "promoted@example.com", addHours(nowIso(), 24));

      await finalizeEmailChange(env.DB, {
        userId: user.id,
        eventId,
        registrationId: registration.id,
      });

      expect(await first<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [user.id])).toEqual({
        email: "promoted@example.com",
      });
      expect(
        await first(env.DB, "SELECT id FROM user_emails WHERE user_id = ? AND normalized_email = ?", [
          user.id,
          "promoted@example.com",
        ]),
      ).toBeNull();
    });

    it("rejects if pending email has expired", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, {
        email: "expired-test@example.com",
      });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      const now = nowIso();
      await reservePendingEmail(user.id, reg.id, "expired@example.com", addHours(now, -1));

      await expect(
        finalizeEmailChange(env.DB, {
          userId: user.id,
          eventId,
          registrationId: reg.id,
        }),
      ).rejects.toThrow("Email confirmation link has expired");

      // Verify pending email was cleared
      const dbUser = await first<{ pending_email: string | null }>(
        env.DB,
        "SELECT pending_email FROM users WHERE id = ?",
        [user.id],
      );
      expect(dbUser?.pending_email).toBeNull();
    });

    it("rejects another account's email even when both users registered for the same event", async () => {
      const eventId = await createTestEvent();
      const user1 = await findOrCreateUser(env.DB, {
        email: "merge1@example.com",
      });
      const user2 = await findOrCreateUser(env.DB, {
        email: "merge2@example.com",
      });

      const { registration: reg1 } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user1.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      const { registration: reg2 } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user2.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      const now = nowIso();
      await expect(reservePendingEmail(user1.id, reg1.id, "merge2@example.com", addHours(now, 24))).rejects.toThrow(
        "EMAIL_TAKEN",
      );

      expect(await first<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [user1.id])).toEqual({
        email: "merge1@example.com",
      });
      expect(
        await first<{ status: string }>(env.DB, "SELECT status FROM registrations WHERE id = ?", [reg1.id]),
      ).toEqual({ status: "pending_email_confirmation" });
      expect(
        await first<{ status: string }>(env.DB, "SELECT status FROM registrations WHERE id = ?", [reg2.id]),
      ).toEqual({ status: "pending_email_confirmation" });
    });

    it("rejects if another user already has the pending email", async () => {
      const eventId = await createTestEvent();
      await findOrCreateUser(env.DB, {
        email: "taken@example.com",
      });

      const user4 = await findOrCreateUser(env.DB, {
        email: "user4@example.com",
      });
      const { registration: reg4 } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user4.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      const now = nowIso();
      await expect(reservePendingEmail(user4.id, reg4.id, "taken@example.com", addHours(now, 24))).rejects.toThrow(
        "EMAIL_TAKEN",
      );
      expect(
        await first<{ status: string }>(env.DB, "SELECT status FROM registrations WHERE id = ?", [reg4.id]),
      ).toEqual({ status: "pending_email_confirmation" });
    });
  });

  describe("Cross-account collision workflow", () => {
    it("rejects the collision without mutating either identity", async () => {
      const eventId = await createTestEvent();
      const origUser = await findOrCreateUser(env.DB, {
        email: "workflow-orig@example.com",
        firstName: "Original",
      });
      const dupeUser = await findOrCreateUser(env.DB, {
        email: "workflow-dupe@example.com",
        firstName: "Duplicate",
      });

      // Both register for same event
      const { registration: origReg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: origUser.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      const { registration: dupeReg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: dupeUser.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: origReg.id,
          newEmail: "workflow-dupe@example.com",
          authority: { kind: "event_manager", actorUserId: origReg.user_id },
          confirmationTtlHours: 24,
          signingSecret: "test-signing-secret",
        }),
      ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });

      expect(await first<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [origUser.id])).toEqual({
        email: "workflow-orig@example.com",
      });
      expect(
        await first<{ status: string }>(env.DB, "SELECT status FROM registrations WHERE id = ?", [dupeReg.id]),
      ).toEqual({ status: "pending_email_confirmation" });
    });
  });

  describe("Squatting prevention", () => {
    it("rejects at initiation when target email belongs to a user with no same-event registration", async () => {
      const eventId = await createTestEvent();
      const otherEventId = await createTestEvent();

      // Squatter exists but is registered for a different event
      const squatter = await findOrCreateUser(env.DB, { email: "squatter@example.com" });
      await createRegistration(env.DB, {
        event: { id: otherEventId },
        userId: squatter.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      const user = await findOrCreateUser(env.DB, { email: "victim@example.com" });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "squatter@example.com",
          authority: { kind: "event_manager", actorUserId: reg.user_id },
          confirmationTtlHours: 24,
          signingSecret: "test-signing-secret",
        }),
      ).rejects.toThrow("This email address is already reserved by another account");

      // Victim's user record should NOT have a pending_email set after rejection.
      const victim = await first<{ pending_email: string | null }>(
        env.DB,
        "SELECT pending_email FROM users WHERE id = ?",
        [user.id],
      );
      expect(victim?.pending_email).toBeNull();
    });

    it("rejects when another user has reserved the same email via pending_email", async () => {
      const eventId = await createTestEvent();
      const reserver = await findOrCreateUser(env.DB, { email: "reserver@example.com" });
      const { registration: reserverRegistration } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: reserver.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      const now = nowIso();
      await reservePendingEmail(reserver.id, reserverRegistration.id, "contested@example.com", addHours(now, 24));

      const user = await findOrCreateUser(env.DB, { email: "second@example.com" });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "contested@example.com",
          authority: { kind: "event_manager", actorUserId: reg.user_id },
          confirmationTtlHours: 24,
          signingSecret: "test-signing-secret",
        }),
      ).rejects.toThrow("currently being claimed by another account");
    });

    it("rejects initiation when target email belongs to a user with same-event registration", async () => {
      const eventId = await createTestEvent();
      const dupe = await findOrCreateUser(env.DB, { email: "dupe@example.com" });
      await createRegistration(env.DB, {
        event: { id: eventId },
        userId: dupe.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      const user = await findOrCreateUser(env.DB, { email: "primary@example.com" });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "dupe@example.com",
          authority: { kind: "event_manager", actorUserId: reg.user_id },
          confirmationTtlHours: 24,
          signingSecret: "test-signing-secret",
        }),
      ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    });
  });

  describe("finalizeEmailChange validation", () => {
    it("rejects when registration does not belong to the expected event", async () => {
      const eventId = await createTestEvent();
      const otherEventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, { email: "validation@example.com" });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });
      const now = nowIso();
      await reservePendingEmail(user.id, reg.id, "validation-new@example.com", addHours(now, 24));

      await expect(
        finalizeEmailChange(env.DB, {
          userId: user.id,
          eventId: otherEventId,
          registrationId: reg.id,
        }),
      ).rejects.toThrow("Registration does not belong to the expected event");
    });

    it("normalizes the stored pending email", async () => {
      const eventId = await createTestEvent();
      const user = await findOrCreateUser(env.DB, { email: "normalize@example.com" });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "  MIXED.Case@Example.COM  ",
        authority: { kind: "event_manager", actorUserId: reg.user_id },
        confirmationTtlHours: 24,
        signingSecret: "test-signing-secret",
      });

      expect(result.pendingEmail).toBe("mixed.case@example.com");
      const stored = await first<{ pending_email: string | null }>(
        env.DB,
        "SELECT pending_email FROM users WHERE id = ?",
        [user.id],
      );
      expect(stored?.pending_email).toBe("mixed.case@example.com");
    });
  });
});
