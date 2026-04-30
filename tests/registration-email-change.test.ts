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
      });

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "newemail@example.com",
        confirmationTtlHours: 24,
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
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "original@example.com",
          confirmationTtlHours: 24,
        }),
      ).rejects.toThrow("The new email address is the same as the current one");
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
      });

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "another@example.com",
        confirmationTtlHours: 24,
      });

      expect(result.registration.status).toBe("pending_email_confirmation");
      expect(result.registration.confirmation_token_hash).toBeTruthy();
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
      });
      await run(env.DB, "UPDATE registrations SET status = 'cancelled' WHERE id = ?", [reg.id]);

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "cancelled-recovery@example.com",
        confirmationTtlHours: 24,
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
      });
      await run(env.DB, "UPDATE registrations SET status = 'cancelled' WHERE id = ?", [reg.id]);

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "test@example.com",
          confirmationTtlHours: 24,
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
      expect(result.mergedWithRegistrationId).toBeNull();

      const dbUser = await first<{ email: string; pending_email: string | null }>(
        env.DB,
        "SELECT email, pending_email FROM users WHERE id = ?",
        [user.id],
      );
      expect(dbUser?.email).toBe("pending@example.com");
      expect(dbUser?.pending_email).toBeNull();
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

    it("merges registrations if pending email has another registration for same event", async () => {
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
      });
      const { registration: reg2 } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user2.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      // Set user1's pending email to user2's email
      const now = nowIso();
      await run(env.DB, `UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?`, [
        "merge2@example.com",
        addHours(now, 24),
        user1.id,
      ]);

      const result = await finalizeEmailChange(env.DB, {
        userId: user1.id,
        eventId,
        registrationId: reg1.id,
      });

      expect(result.mergedWithRegistrationId).toBe(reg2.id);

      // Verify reg2 was cancelled
      const cancelled = await first<{ status: string }>(env.DB, "SELECT status FROM registrations WHERE id = ?", [
        reg2.id,
      ]);
      expect(cancelled?.status).toBe("cancelled");

      // Verify user1 now has the email
      const dbUser = await first<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [user1.id]);
      expect(dbUser?.email).toBe("merge2@example.com");
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
      });

      const now = nowIso();
      await run(env.DB, `UPDATE users SET pending_email = ?, pending_email_expires_at = ? WHERE id = ?`, [
        "taken@example.com",
        addHours(now, 24),
        user4.id,
      ]);

      await expect(
        finalizeEmailChange(env.DB, {
          userId: user4.id,
          eventId,
          registrationId: reg4.id,
        }),
      ).rejects.toThrow("This email address is already in use");
    });
  });

  describe("Full workflow", () => {
    it("completes full email change and merge flow", async () => {
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
      });
      const { registration: dupeReg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: dupeUser.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      // Original user initiates email change to duplicate user's email
      const changeResult = await changeRegistrationEmail(env.DB, {
        registrationId: origReg.id,
        newEmail: "workflow-dupe@example.com",
        confirmationTtlHours: 24,
      });

      expect(changeResult.pendingEmail).toBe("workflow-dupe@example.com");

      // User confirms email
      const finalResult = await finalizeEmailChange(env.DB, {
        userId: origUser.id,
        eventId,
        registrationId: origReg.id,
      });

      // Should have merged
      expect(finalResult.mergedWithRegistrationId).toBe(dupeReg.id);

      // Verify dupe registration was cancelled
      const dupeAfterMerge = await first<{ status: string }>(env.DB, "SELECT status FROM registrations WHERE id = ?", [
        dupeReg.id,
      ]);
      expect(dupeAfterMerge?.status).toBe("cancelled");

      // Verify original user now has the dupe email
      const finalUser = await first<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [origUser.id]);
      expect(finalUser?.email).toBe("workflow-dupe@example.com");
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
      });

      const user = await findOrCreateUser(env.DB, { email: "victim@example.com" });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "squatter@example.com",
          confirmationTtlHours: 24,
        }),
      ).rejects.toThrow("This email address is already in use by another account");

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
      });

      await expect(
        changeRegistrationEmail(env.DB, {
          registrationId: reg.id,
          newEmail: "contested@example.com",
          confirmationTtlHours: 24,
        }),
      ).rejects.toThrow("currently being claimed by another account");
    });

    it("allows initiation when target email belongs to a user with same-event registration", async () => {
      const eventId = await createTestEvent();
      const dupe = await findOrCreateUser(env.DB, { email: "dupe@example.com" });
      await createRegistration(env.DB, {
        event: { id: eventId },
        userId: dupe.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      const user = await findOrCreateUser(env.DB, { email: "primary@example.com" });
      const { registration: reg } = await createRegistration(env.DB, {
        event: { id: eventId },
        userId: user.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "dupe@example.com",
        confirmationTtlHours: 24,
      });
      expect(result.pendingEmail).toBe("dupe@example.com");
    });
  });

  describe("Safe merge behavior", () => {
    it("re-points loser's other-event registrations to surviving user where no conflict exists", async () => {
      const sharedEventId = await createTestEvent();
      const loserOnlyEventId = await createTestEvent();

      const survivor = await findOrCreateUser(env.DB, { email: "survivor@example.com" });
      const loser = await findOrCreateUser(env.DB, { email: "loser@example.com" });

      // Both have a registration on the shared event (this drives the merge).
      const { registration: survivorReg } = await createRegistration(env.DB, {
        event: { id: sharedEventId },
        userId: survivor.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });
      await createRegistration(env.DB, {
        event: { id: sharedEventId },
        userId: loser.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      // Loser also has an exclusive registration on another event.
      const { registration: loserOnlyReg } = await createRegistration(env.DB, {
        event: { id: loserOnlyEventId },
        userId: loser.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      // Initiate + finalize the merge.
      await changeRegistrationEmail(env.DB, {
        registrationId: survivorReg.id,
        newEmail: "loser@example.com",
        confirmationTtlHours: 24,
      });
      const result = await finalizeEmailChange(env.DB, {
        userId: survivor.id,
        eventId: sharedEventId,
        registrationId: survivorReg.id,
      });

      expect(result.mergedFromUserId).toBe(loser.id);

      // Loser's exclusive registration is now owned by the survivor.
      const repointed = await first<{ user_id: string }>(env.DB, "SELECT user_id FROM registrations WHERE id = ?", [
        loserOnlyReg.id,
      ]);
      expect(repointed?.user_id).toBe(survivor.id);

      // Loser is anonymized with sentinel email + merged_into_user_id set.
      const loserAfter = await first<{
        email: string;
        normalized_email: string;
        merged_into_user_id: string | null;
      }>(env.DB, "SELECT email, normalized_email, merged_into_user_id FROM users WHERE id = ?", [loser.id]);
      expect(loserAfter?.merged_into_user_id).toBe(survivor.id);
      expect(loserAfter?.email).toBe(`merged-${loser.id}@deleted.invalid`);
    });

    it("leaves loser's same-event registrations attached to loser when survivor already has one", async () => {
      const sharedEventId = await createTestEvent();
      const otherSharedEventId = await createTestEvent();

      const survivor = await findOrCreateUser(env.DB, { email: "survivor2@example.com" });
      const loser = await findOrCreateUser(env.DB, { email: "loser2@example.com" });

      const { registration: survivorReg } = await createRegistration(env.DB, {
        event: { id: sharedEventId },
        userId: survivor.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });
      await createRegistration(env.DB, {
        event: { id: sharedEventId },
        userId: loser.id,
        attendanceType: "in_person",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      // Both have a registration on a SECOND shared event -- repointing the
      // loser's row would violate UNIQUE(event_id, user_id), so it must stay.
      await createRegistration(env.DB, {
        event: { id: otherSharedEventId },
        userId: survivor.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
      });
      const { registration: loserOtherShared } = await createRegistration(env.DB, {
        event: { id: otherSharedEventId },
        userId: loser.id,
        attendanceType: "virtual",
        sourceType: "web",
        confirmationTtlHours: 24,
      });

      await changeRegistrationEmail(env.DB, {
        registrationId: survivorReg.id,
        newEmail: "loser2@example.com",
        confirmationTtlHours: 24,
      });
      await finalizeEmailChange(env.DB, {
        userId: survivor.id,
        eventId: sharedEventId,
        registrationId: survivorReg.id,
      });

      const stillLoser = await first<{ user_id: string }>(env.DB, "SELECT user_id FROM registrations WHERE id = ?", [
        loserOtherShared.id,
      ]);
      expect(stillLoser?.user_id).toBe(loser.id);
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
      });

      const result = await changeRegistrationEmail(env.DB, {
        registrationId: reg.id,
        newEmail: "  MIXED.Case@Example.COM  ",
        confirmationTtlHours: 24,
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
