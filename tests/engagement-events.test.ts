import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { onRequestPost as createRegistration } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequestGet as confirmRegistration } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { recordEngagement } from "../functions/_lib/services/engagement";

describe("engagement events", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("records registration lifecycle points", async () => {
    await seedEventAndAdmin(env.DB);

    const createResponse = await createRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/events/pqc-2026/registrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            firstName: "Jamie",
            lastName: "Example",
            email: "jamie@example.test",
            attendanceType: "virtual",
            sourceType: "direct",
            consents: [
              { termKey: "privacy-policy", version: "v1" },
              { termKey: "code-of-conduct", version: "v1" },
            ],
          }),
        }),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(createResponse.status).toBe(200);

    const createdActions = await queryAll<{ action_type: string }>(
      env.DB,
      "SELECT action_type FROM engagement_events WHERE action_type = 'registration_created'",
    );
    expect(createdActions.length).toBe(1);

    const payload = (
      await queryAll<{ payload_json: string }>(
        env.DB,
        "SELECT payload_json FROM email_outbox WHERE template_key = 'registration_confirm_email' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];

    const confirmationUrl = (JSON.parse(payload.payload_json) as { confirmationUrl: string }).confirmationUrl;
    const token = new URL(confirmationUrl).searchParams.get("token");
    expect(token).toBeTruthy();

    const confirmResponse = await confirmRegistration(
      createContext(
        env,
        new Request(
          `https://app.test/api/v1/events/pqc-2026/registrations/confirm-email?token=${encodeURIComponent(token as string)}`,
        ),
        { eventSlug: "pqc-2026" },
      ),
    );

    expect(confirmResponse.status).toBe(200);

    const confirmedActions = await queryAll<{ action_type: string }>(
      env.DB,
      "SELECT action_type FROM engagement_events WHERE action_type = 'registration_confirmed'",
    );
    expect(confirmedActions.length).toBe(1);
  });

  it("supports community engagement without event scope", async () => {
    await seedEventAndAdmin(env.DB);

    const admin = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    await recordEngagement(env.DB, {
      userId: admin.id,
      subjectType: "community",
      subjectRef: "profile_completion",
      actionType: "profile_completed",
      points: 2,
      sourceType: "onboarding",
      sourceRef: "wizard",
      data: { step: "links" },
    });

    const rows = await queryAll<{
      event_id: string | null;
      subject_type: string;
      subject_ref: string | null;
      action_type: string;
    }>(
      env.DB,
      "SELECT event_id, subject_type, subject_ref, action_type FROM engagement_events WHERE action_type = 'profile_completed' LIMIT 1",
    );

    expect(rows.length).toBe(1);
    expect(rows[0].event_id).toBeNull();
    expect(rows[0].subject_type).toBe("community");
    expect(rows[0].subject_ref).toBe("profile_completion");
  });
});
