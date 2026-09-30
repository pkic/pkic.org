import { mutateBeforeNextBatch } from "./helpers/database-races";
import { createExecutionContext } from "cloudflare:test";
import { createRegistration } from "../functions/_lib/services/registrations/create";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  inviteSpeakerAndSubmitCapacityProposal,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";
import { finalizeProposalDecision } from "../functions/_lib/services/proposals";
import { eventProposalsResponseSchema } from "../assets/shared/schemas/event-proposals";

describe("accepted proposal speaker registration", () => {
  let eventId: string;
  let adminUserId: string;
  let adminSessionToken: string;
  beforeEach(async () => {
    await resetDb();
    ({ eventId, adminUserId, adminSessionToken } = await setupProposalSpeakerCapacityWorkflow());
    await env.DB.prepare(
      `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES ('speaker-day-one', ?, '2026-12-01', 'Conference', 1, 0, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z'),
             ('speaker-day-two', ?, '2026-12-02', 'Workshop', 1, 1, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z')`,
    )
      .bind(eventId, eventId)
      .run();
  });
  const accept = (proposalId: string) =>
    finalizeProposalDecision(env.DB, {
      proposalId,
      actor: { identityType: "user", id: adminUserId, email: "admin@pkic.org", role: "admin" },
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });

  it("registers every speaker on every configured day, bypasses capacity, and exposes the bounded overview", async () => {
    const { proposalId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await accept(proposalId);
    const registrations = await queryAll<{ id: string; status: string; attendance_type: string }>(
      env.DB,
      "SELECT id, status, attendance_type FROM registrations WHERE event_id = ?",
      eventId,
    );
    expect(registrations).toHaveLength(2);
    expect(registrations.every((row) => row.status === "registered" && row.attendance_type === "in_person")).toBe(true);
    expect(await queryAll(env.DB, "SELECT id FROM registration_day_attendance")).toHaveLength(4);
    expect(
      await queryAll(env.DB, "SELECT id FROM event_day_waitlist_entries WHERE status IN ('waiting', 'offered')"),
    ).toHaveLength(0);
    const response = await app.fetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals?limit=1", {
        headers: { authorization: `Bearer ${adminSessionToken}` },
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    const body = eventProposalsResponseSchema.parse(await response.json());
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0].speakers).toHaveLength(2);
    expect(
      body.proposals[0].speakers.every(
        (speaker) => speaker.registrationStatus === "registered" && speaker.days.length === 2,
      ),
    ).toBe(true);
    const missingResponse = await app.fetch(
      new Request("https://app.test/api/v1/events/pqc-2026/proposals?speakerRegistration=missing", {
        headers: { authorization: `Bearer ${adminSessionToken}` },
      }),
      env,
      createExecutionContext(),
    );
    const missing = eventProposalsResponseSchema.parse(await missingResponse.json());
    expect(missing.proposals).toEqual([]);
    expect(missing.page.total).toBe(0);
    await expect(accept(proposalId)).rejects.toMatchObject({ code: "PROPOSAL_DECISION_CONFLICT" });
    expect(await queryAll(env.DB, "SELECT id FROM registrations WHERE event_id = ?", eventId)).toHaveLength(2);
  });

  it("does not register declined speakers and uses virtual attendance for online days", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE user_id = ?")
      .bind(coSpeakerUserId)
      .run();
    await env.DB.prepare(
      `UPDATE event_days SET attendance_options_json = '[{"value":"virtual","label":"Virtual"}]' WHERE event_id = ?`,
    )
      .bind(eventId)
      .run();
    await accept(proposalId);
    const rows = await queryAll<{ attendance_type: string }>(
      env.DB,
      "SELECT attendance_type FROM registrations WHERE event_id = ?",
      eventId,
    );
    expect(rows).toEqual([{ attendance_type: "virtual" }]);
  });
  it("confirms a pending registration while preserving selected days, organization and form answers", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const { registration } = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: coSpeakerUserId,
      attendanceType: "virtual",
      dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "virtual" }],
      sourceType: "public",
      customAnswersJson: '{"diet":"vegetarian"}',
      eventOrganizationName: "Example Organization",
    });
    expect(registration.status).toBe("pending_email_confirmation");
    await accept(proposalId);
    expect(
      await queryAll(
        env.DB,
        `SELECT status, custom_answers_json, registration_organization_name,
      confirmation_link_secret FROM registrations WHERE id = ?`,
        registration.id,
      ),
    ).toEqual([
      {
        status: "registered",
        custom_answers_json: '{"diet":"vegetarian"}',
        registration_organization_name: "Example Organization",
        confirmation_link_secret: null,
      },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ?",
        registration.id,
      ),
    ).toEqual([{ attendance_type: "virtual" }]);
  });

  it("reactivates a canceled speaker registration without duplicating it", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const { registration } = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: coSpeakerUserId,
      attendanceType: "virtual",
      sourceType: "public",
      customAnswersJson: '{"diet":"vegetarian"}',
      eventOrganizationName: "Example Organization",
      dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "virtual" }],
    });
    await env.DB.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").bind(registration.id).run();
    await accept(proposalId);
    expect(await queryAll(env.DB, "SELECT id, status FROM registrations WHERE user_id = ?", coSpeakerUserId)).toEqual([
      { id: registration.id, status: "registered" },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT custom_answers_json, registration_organization_name, source_type FROM registrations WHERE id = ?",
        registration.id,
      ),
    ).toEqual([
      {
        custom_answers_json: '{"diet":"vegetarian"}',
        registration_organization_name: "Example Organization",
        source_type: "public",
      },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT attendance_type FROM registration_day_attendance WHERE registration_id = ?",
        registration.id,
      ),
    ).toEqual([{ attendance_type: "virtual" }]);
  });
  it("rolls back acceptance if a speaker registers concurrently, then succeeds on retry", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    await env.DB.prepare("UPDATE event_days SET in_person_capacity = NULL WHERE event_id = ?").bind(eventId).run();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      createRegistration(env.DB, {
        event: { id: eventId },
        userId: coSpeakerUserId,
        attendanceType: "virtual",
        sourceType: "public",
        dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "virtual" }],
      }),
    );
    await expect(
      finalizeProposalDecision(racingDb, {
        proposalId,
        actor: { identityType: "user", id: adminUserId, email: "admin@pkic.org", role: "admin" },
        finalStatus: "accepted",
        minReviewsRequired: 0,
      }),
    ).rejects.toMatchObject({ status: 409, code: "REGISTRATION_CHANGED" });
    expect(await queryAll(env.DB, "SELECT status FROM session_proposals WHERE id = ?", proposalId)).toEqual([
      { status: "submitted" },
    ]);
    expect(
      await queryAll(env.DB, "SELECT id FROM proposal_decision_history WHERE proposal_id = ?", proposalId),
    ).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM registrations WHERE event_id = ?", eventId)).toHaveLength(1);
    await accept(proposalId);
    expect(
      await queryAll(env.DB, "SELECT id FROM registrations WHERE event_id = ? AND status = 'registered'", eventId),
    ).toHaveLength(2);
  });
  it("preserves a canceled scalar-only virtual registration without adding days", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const { registration } = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: coSpeakerUserId,
      attendanceType: "virtual",
      sourceType: "public",
    });
    await env.DB.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ?").bind(registration.id).run();
    await accept(proposalId);
    expect(
      await queryAll(env.DB, "SELECT status, attendance_type FROM registrations WHERE id = ?", registration.id),
    ).toEqual([{ status: "registered", attendance_type: "virtual" }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM registration_day_attendance WHERE registration_id = ?", registration.id),
    ).toEqual([]);
  });

  it("does not clear an unauthorized-registration report during proposal acceptance", async () => {
    const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
    const { registration } = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: coSpeakerUserId,
      attendanceType: "virtual",
      sourceType: "public",
    });
    await env.DB.prepare(
      "UPDATE registrations SET status = 'cancelled', cancellation_reason_code = 'unauthorized_registration' WHERE id = ?",
    )
      .bind(registration.id)
      .run();
    await expect(accept(proposalId)).rejects.toMatchObject({
      status: 409,
      code: "UNAUTHORIZED_REGISTRATION_REVIEW_REQUIRED",
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT status, cancellation_reason_code FROM registrations WHERE id = ?",
        registration.id,
      ),
    ).toEqual([{ status: "cancelled", cancellation_reason_code: "unauthorized_registration" }]);
    expect(await queryAll(env.DB, "SELECT status FROM session_proposals WHERE id = ?", proposalId)).toEqual([
      { status: "submitted" },
    ]);
    expect(
      await queryAll(env.DB, "SELECT id FROM proposal_decision_history WHERE proposal_id = ?", proposalId),
    ).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM registrations WHERE event_id = ?", eventId)).toHaveLength(1);
  });
});
