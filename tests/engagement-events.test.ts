import { confirmWorkRegistration, createPendingRegistration } from "./helpers/registration-confirmation";
import { signInRegistrant } from "./helpers/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { callApi } from "./helpers/app";
import { recordEngagement } from "../functions/_lib/services/engagement";
import { stubSuccessfulMxLookup } from "./helpers/mx-lookup";
import { seedSessionAttendanceDays } from "./helpers/session-attendance-days";

describe("engagement events", () => {
  beforeEach(async () => {
    await resetDb();
    stubSuccessfulMxLookup();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records registration lifecycle points", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await seedSessionAttendanceDays(env.DB, eventId, ["2026-12-01"], "virtual");

    const { headers, identityId } = await signInRegistrant(env.DB, "jamie@pkic.org", {
      firstName: "Jamie",
      lastName: "Example",
      organization: "PKI Consortium",
    });
    const createResponse = await callApi(env, "/api/v1/events/pqc-2026/registrations", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        firstName: "Jamie",
        lastName: "Example",
        email: "jamie@pkic.org",
        identityId,
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
        sourceType: "direct",
        consents: [
          { termKey: "privacy-policy", version: "v1" },
          { termKey: "code-of-conduct", version: "v1" },
        ],
      }),
    });

    expect(createResponse.status, await createResponse.clone().text()).toBe(200);

    const createdActions = await queryAll<{ action_type: string }>(
      env.DB,
      "SELECT action_type FROM engagement_events WHERE action_type = 'registration_created'",
    );
    expect(createdActions.length).toBe(1);
    // The session proved the mailbox, so the signed-in registration is confirmed, and earns that point, at once.
    expect(
      await queryAll(env.DB, "SELECT action_type FROM engagement_events WHERE action_type = 'registration_confirmed'"),
    ).toHaveLength(1);

    // A registration still awaiting its mailbox proof earns its confirmation point when confirmed.
    const { confirmationToken: token } = await createPendingRegistration(env.DB, { email: "pending@pkic.org" });

    const confirmResponse = await confirmWorkRegistration(env, token);

    expect(confirmResponse.status).toBe(200);

    const confirmedActions = await queryAll<{ action_type: string }>(
      env.DB,
      "SELECT action_type FROM engagement_events WHERE action_type = 'registration_confirmed'",
    );
    expect(confirmedActions.length).toBe(2);
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

  it("deduplicates one-shot engagement by its domain idempotency key", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    const payload = {
      userId: admin.id,
      subjectType: "invite" as const,
      subjectRef: "invite-retry",
      actionType: "invite_accepted",
      points: 3,
      sourceType: "invite",
      sourceRef: "invite-retry",
      idempotencyKey: "invite_accepted:invite:invite-retry",
    };

    await Promise.all([recordEngagement(env.DB, payload), recordEngagement(env.DB, payload)]);

    const rows = await queryAll<{ count: number; points: number }>(
      env.DB,
      `SELECT COUNT(*) AS count, COALESCE(SUM(points), 0) AS points
       FROM engagement_events WHERE idempotency_key = ?`,
      [payload.idempotencyKey],
    );
    expect(rows[0]).toEqual({ count: 1, points: 3 });
  });
});
