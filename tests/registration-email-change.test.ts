import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { uuid } from "../functions/_lib/utils/ids";
import { nowIso, addHours } from "../functions/_lib/utils/time";
import { changeRegistrationEmail, finalizeEmailChange } from "../functions/_lib/services/registrations";
import { createRegistration } from "../functions/_lib/services/registrations";
import { findOrCreateUser } from "../functions/_lib/services/users";
import { first, run } from "../functions/_lib/db/queries";

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
          confirmationTtlHours: 24,
          signingSecret: "test-signing-secret",
        }),
      ).rejects.toThrow("Cannot change email on a cancelled registration");
    });
  });

  describe("finalizeEmailChange", () => {
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

      // Set pending email
      const now = nowIso();
      await run(env.DB, `UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?`, [
        "pending@example.com",
        addHours(now, 24),
        user.id,
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
      await run(env.DB, "UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?", [
        "promoted@example.com",
        addHours(nowIso(), 24),
        user.id,
      ]);

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
      await run(env.DB, `UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?`, [
        "expired@example.com",
        addHours(now, -1),
        user.id,
      ]);

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
      await expect(
        run(env.DB, `UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?`, [
          "merge2@example.com",
          addHours(now, 24),
          user1.id,
        ]),
      ).rejects.toThrow("EMAIL_TAKEN");

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
      await expect(
        run(env.DB, `UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?`, [
          "taken@example.com",
          addHours(now, 24),
          user4.id,
        ]),
      ).rejects.toThrow("EMAIL_TAKEN");
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
      const now = nowIso();
      await run(env.DB, "UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?", [
        "contested@example.com",
        addHours(now, 24),
        reserver.id,
      ]);

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
      await run(env.DB, "UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?", [
        "validation-new@example.com",
        addHours(now, 24),
        user.id,
      ]);

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
