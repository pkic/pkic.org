import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { adminUserUpdateSchema } from "../assets/shared/schemas/admin-users";
import { registrationManageSchema } from "../assets/shared/schemas/registration";
import { first, run } from "../functions/_lib/db/queries";
import { confirmRegistrationByToken, createRegistration } from "../functions/_lib/services/registrations";
import { findOrCreateUser } from "../functions/_lib/services/users";
import { nowIso } from "../functions/_lib/utils/time";
import { uuid } from "../functions/_lib/utils/ids";
import { resetDb } from "./helpers/reset-db";

async function createEvent(): Promise<string> {
  const id = uuid();
  const now = nowIso();
  await run(
    env.DB,
    `INSERT INTO events
       (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
     VALUES (?, ?, 'Identity boundary test', 'Europe/Amsterdam', 'invite_or_open', 5, '{}', ?, ?)`,
    [id, `identity-${id.slice(0, 8)}`, now, now],
  );
  return id;
}

describe("primary email identity boundary", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("does not accept primary email changes through registration or generic admin profile contracts", () => {
    expect(registrationManageSchema.safeParse({ action: "update", email: "attacker@example.test" }).success).toBe(
      false,
    );
    expect(adminUserUpdateSchema.safeParse({ email: "replacement@example.test" }).success).toBe(false);
  });

  it("enforces primary-email immutability at the D1 boundary", async () => {
    const user = await findOrCreateUser(env.DB, { email: "stable@example.test" });

    await expect(
      run(env.DB, "UPDATE users SET email = ?, normalized_email = ? WHERE id = ?", [
        "replacement@example.test",
        "replacement@example.test",
        user.id,
      ]),
    ).rejects.toThrow("PRIMARY_EMAIL_IMMUTABLE");

    expect(await first<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [user.id])).toEqual({
      email: "stable@example.test",
    });
  });

  it("allows only the canonical redaction transition and cannot repopulate that identity", async () => {
    const user = await findOrCreateUser(env.DB, { email: "retire@example.test" });
    const redactedEmail = `redacted-${user.id}@anonymized.invalid`;

    await run(
      env.DB,
      "UPDATE users SET email = ?, normalized_email = ?, pii_redacted_at = datetime('now') WHERE id = ?",
      [redactedEmail, redactedEmail, user.id],
    );
    await expect(
      run(env.DB, "UPDATE users SET email = ?, normalized_email = ? WHERE id = ?", [
        "repopulated@example.test",
        "repopulated@example.test",
        user.id,
      ]),
    ).rejects.toThrow("PRIMARY_EMAIL_IMMUTABLE");
  });

  it("abandons a legacy pending change without transferring the identity", async () => {
    const eventId = await createEvent();
    const user = await findOrCreateUser(env.DB, { email: "canonical@example.test" });
    const created = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: user.id,
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 24,
      signingSecret: "test-signing-secret",
    });
    await run(
      env.DB,
      "UPDATE users SET pending_email = ?, pending_email_expires_at = datetime('now', '+1 day') WHERE id = ?",
      ["legacy-target@example.test", user.id],
    );

    await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      signingSecret: "test-signing-secret",
      waitlistClaimWindowHours: 24,
    });

    expect(
      await first<{ email: string; pending_email: string | null }>(
        env.DB,
        "SELECT email, pending_email FROM users WHERE id = ?",
        [user.id],
      ),
    ).toEqual({ email: "canonical@example.test", pending_email: null });
    expect(
      await first<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_type = 'user' AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
        [user.id],
      ),
    ).toEqual({ action: "legacy_primary_email_change_abandoned" });
  });
});
