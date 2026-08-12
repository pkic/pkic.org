import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { getEventBySlug } from "../functions/_lib/services/events";
import { listCampaignRecipients } from "../functions/_lib/services/admin-email-campaign";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";

describe("admin email campaign recipients", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loads attendee details for a large event without per-recipient query batches", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const users = Array.from({ length: 101 }, (_, index) => ({
      id: `campaign-user-${index}`,
      email: `campaign-user-${index}@example.test`,
      manageTokenHash: `campaign-manage-token-${index}`,
      registrationId: `campaign-registration-${index}`,
    }));

    await env.DB.batch(
      users.map((user) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(user.id, user.email, user.email, "Campaign", `User ${user.id.split("-").pop()}`),
      ),
    );
    await env.DB.batch(
      users.map((user) =>
        env.DB.prepare(
          `INSERT INTO registrations (
               id, event_id, user_id, status, attendance_type, source_type,
               manage_token_hash, created_at, updated_at
             ) VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
        ).bind(user.registrationId, eventId, user.id, user.manageTokenHash),
      ),
    );

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const recipients = await listCampaignRecipients(env.DB, event, "https://app.test", {
      audience: "attendees",
      attendeeStatus: "registered",
      dayWaitlistStatus: "all",
    });

    expect(recipients).toHaveLength(users.length);
    expect(recipients[0].templateData.dayWaitlist).toEqual([]);
  });
});
