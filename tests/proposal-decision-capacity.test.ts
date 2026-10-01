import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { queryAll, registrationAdmissionRole } from "./helpers/context";
import {
  inviteSpeakerAndSubmitCapacityProposal,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration, confirmRegistrationByToken } from "../functions/_lib/services/registrations";

describe("proposal decision capacity for a registered panel", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])("coordinates registered panel capacity (concurrent change: %s)", async (concurrentChange) => {
    const { eventId, adminSessionToken } = await setupProposalSpeakerCapacityWorkflow();
    const { proposalId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await env.DB.prepare(
      "UPDATE proposal_speakers SET role = CASE role WHEN 'proposer' THEN 'moderator' ELSE 'panelist' END WHERE proposal_id = ?",
    )
      .bind(proposalId)
      .run();
    const dayDates = ["2026-12-01", "2026-12-02", "2026-12-03"];
    await env.DB.batch(
      dayDates.map((dayDate) =>
        env.DB.prepare(
          `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 800, 0, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
        ).bind(crypto.randomUUID(), eventId, dayDate, dayDate),
      ),
    );
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const speakers = await queryAll<{ user_id: string; role: string }>(
      env.DB,
      "SELECT user_id, role FROM proposal_speakers WHERE proposal_id = ?",
      [proposalId],
    );
    const registrationIds: string[] = [];
    for (const speaker of speakers) {
      const registration = await createRegistration(env.DB, {
        event,
        userId: speaker.user_id,
        attendanceType: "in_person",
        dayAttendance: dayDates.map((dayDate) => ({ dayDate, attendanceType: "in_person" })),
        sourceType: "direct",
        confirmationTtlHours: 48,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
      });
      await confirmRegistrationByToken(env.DB, {
        token: registration.confirmationToken!,
        waitlistClaimWindowHours: 24,
        signingSecret: env.INTERNAL_SIGNING_SECRET!,
      });
      registrationIds.push(registration.registration.id);
    }
    const beforeDays = await queryAll<{ id: string; capacity_revision: number }>(
      env.DB,
      "SELECT id, capacity_revision FROM event_days WHERE event_id = ? ORDER BY id",
      [eventId],
    );
    if (concurrentChange) {
      // Invalidate the capacity snapshot immediately before its guard runs.
      // D1 must roll back the decision, history, audit, and queued emails together.
      await env.DB.prepare(
        `CREATE TRIGGER invalidate_panel_capacity AFTER INSERT ON proposal_decisions
        BEGIN UPDATE event_days SET capacity_revision = capacity_revision + 1; END;`,
      ).run();
    }
    const executionContext = createExecutionContext();
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/decisions`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminSessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ finalStatus: "accepted" }),
      }),
      { ...env, DEFAULT_MIN_PROPOSAL_REVIEWS: "0" },
      executionContext,
    );
    await waitOnExecutionContext(executionContext);
    const body = await response.json();
    if (concurrentChange) {
      expect(response.status).toBe(409);
      expect(body).toMatchObject({ error: { code: "DAY_CAPACITY_CHANGED" } });
      await expect(
        queryAll(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId]),
      ).resolves.toEqual([{ status: "submitted" }]);
      await expect(
        queryAll(env.DB, "SELECT id FROM proposal_decision_history WHERE proposal_id = ?", [proposalId]),
      ).resolves.toHaveLength(0);
      await expect(
        queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'proposal_decision_recorded'", [
          proposalId,
        ]),
      ).resolves.toHaveLength(0);
      await expect(
        queryAll(
          env.DB,
          "SELECT id FROM email_outbox WHERE json_extract(payload_json, '$.proposalId') = ? AND idempotency_key LIKE 'proposal-decision:%'",
          [proposalId],
        ),
      ).resolves.toHaveLength(0);
      await expect(
        queryAll(env.DB, "SELECT id, capacity_revision FROM event_days WHERE event_id = ? ORDER BY id", [eventId]),
      ).resolves.toEqual(beforeDays);
      await env.DB.prepare("DROP TRIGGER invalidate_panel_capacity").run();
      return;
    }
    expect(response.status, JSON.stringify(body)).toBe(200);
    await expect(queryAll(env.DB, "SELECT status FROM session_proposals WHERE id = ?", [proposalId])).resolves.toEqual([
      { status: "accepted" },
    ]);
    await expect(
      queryAll(env.DB, "SELECT id FROM proposal_decision_history WHERE proposal_id = ?", [proposalId]),
    ).resolves.toHaveLength(1);
    for (const [index, registrationId] of registrationIds.entries()) {
      await expect(registrationAdmissionRole(env.DB, registrationId)).resolves.toBe(speakers[index].role);
    }
    await expect(
      queryAll(env.DB, "SELECT id, capacity_revision FROM event_days WHERE event_id = ? ORDER BY id", [eventId]),
    ).resolves.toEqual(beforeDays.map((day) => ({ ...day, capacity_revision: day.capacity_revision + 1 })));
  });
});
