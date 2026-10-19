/**
 * Moving an accepted speaker's registration between in-person and virtual
 * attendance, from the organizer's day roster and from the speaker's own
 * registration. Speakers may attend remotely; every refusal on the way says
 * what was refused with a machine code and a sentence a person can act on.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { administratorGrants } from "./helpers/administrator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import {
  inviteSpeakerAndSubmitCapacityProposal,
  setupProposalSpeakerCapacityWorkflow,
} from "./helpers/proposal-speaker-capacity";
import { resetDb } from "./helpers/reset-db";
import { finalizeProposalDecision } from "../functions/_lib/services/proposals";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";

interface SpeakerFixture {
  groupId: string;
  coSpeakerUserId: string;
  registrationId: string;
}

let eventId: string;
let adminUserId: string;
let adminSessionToken: string;

function request(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return callApi(env, `https://app.test${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });
}

/** Reads a refusal through the shared error envelope: a code and a message, always. */
async function refusal(response: Response) {
  return apiErrorPayloadSchema.parse(await response.json()).error;
}

/** An accepted talk whose confirmed co-speaker was registered by the decision itself. */
async function acceptedCoSpeaker(): Promise<SpeakerFixture> {
  const { proposalId, coSpeakerUserId } = await inviteSpeakerAndSubmitCapacityProposal(adminSessionToken);
  await env.DB.prepare("UPDATE proposal_speakers SET status = 'confirmed' WHERE proposal_id = ?")
    .bind(proposalId)
    .run();
  await finalizeProposalDecision(env.DB, {
    proposalId,
    actor: { identityType: "user", id: adminUserId, email: "admin@pkic.org", grants: administratorGrants },
    finalStatus: "accepted",
    minReviewsRequired: 0,
  });
  const [row] = await queryAll<{ registration_id: string; group_id: string }>(
    env.DB,
    `SELECT r.id AS registration_id, e.owner_group_id AS group_id
       FROM registrations r JOIN events e ON e.id = r.event_id
      WHERE r.event_id = ? AND r.user_id = ?`,
    eventId,
    coSpeakerUserId,
  );
  return { groupId: row.group_id, coSpeakerUserId, registrationId: row.registration_id };
}

function changeDays(speaker: SpeakerFixture, body: unknown): Promise<Response> {
  return request(
    adminSessionToken,
    `/api/v1/groups/${speaker.groupId}/events/${eventId}/registrations/${speaker.registrationId}/day-attendance`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

async function heldDays(registrationId: string) {
  return queryAll<{ day_date: string; attendance_type: string }>(
    env.DB,
    `SELECT day.day_date, attendance.attendance_type
       FROM registration_day_attendance attendance JOIN event_days day ON day.id = attendance.event_day_id
      WHERE attendance.registration_id = ? ORDER BY day.day_date`,
    registrationId,
  );
}

/** A required registration question the decision-made speaker registration never answered. */
async function requireRegistrationQuestion(groupId: string): Promise<void> {
  await env.DB.prepare("UPDATE events SET source_mode = 'portal' WHERE id = ?").bind(eventId).run();
  const [event] = await queryAll<{ updated_at: string }>(env.DB, "SELECT updated_at FROM events WHERE id = ?", eventId);
  const response = await request(
    adminSessionToken,
    `/api/v1/groups/${groupId}/events/${eventId}/forms/event_registration`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedUpdatedAt: event.updated_at,
        definition: {
          key: `speaker-attendance-${crypto.randomUUID()}`,
          title: "Registration questions",
          fields: [{ key: "country", label: "Country", fieldType: "text", required: true, sortOrder: 0 }],
        },
      }),
    },
  );
  expect(response.status, await response.clone().text()).toBe(201);
}

describe("changing an accepted speaker's attendance", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId, adminUserId, adminSessionToken } = await setupProposalSpeakerCapacityWorkflow());
    await env.DB.prepare(
      `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
       VALUES ('speaker-day-one', ?, '2026-12-01', 'Conference', 10, 0, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z'),
              ('speaker-day-two', ?, '2026-12-02', 'Workshop', 10, 1, '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z')`,
    )
      .bind(eventId, eventId)
      .run();
  });

  it("lets an organizer move a co-speaker to virtual attendance", async () => {
    const speaker = await acceptedCoSpeaker();
    expect(await heldDays(speaker.registrationId)).toEqual([
      { day_date: "2026-12-01", attendance_type: "in_person" },
      { day_date: "2026-12-02", attendance_type: "in_person" },
    ]);

    const response = await changeDays(speaker, { action: "virtual", dayDates: ["2026-12-01", "2026-12-02"] });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await heldDays(speaker.registrationId)).toEqual([
      { day_date: "2026-12-01", attendance_type: "virtual" },
      { day_date: "2026-12-02", attendance_type: "virtual" },
    ]);
  });

  it("changes one day although another held day's method is no longer offered", async () => {
    const speaker = await acceptedCoSpeaker();
    // The organizer later narrowed the workshop to in-person and on-demand.
    // The speaker's held workshop day is left as it was, not re-judged.
    await changeDays(speaker, { action: "virtual", dayDates: ["2026-12-02"] });
    await env.DB.prepare("UPDATE event_days SET attendance_options_json = ? WHERE id = 'speaker-day-two'")
      .bind(
        JSON.stringify([
          { value: "in_person", label: "In-person", capacity: 10 },
          { value: "on_demand", label: "On-demand", capacity: null },
        ]),
      )
      .run();

    const response = await changeDays(speaker, { action: "virtual", dayDates: ["2026-12-01"] });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await heldDays(speaker.registrationId)).toEqual([
      { day_date: "2026-12-01", attendance_type: "virtual" },
      { day_date: "2026-12-02", attendance_type: "virtual" },
    ]);

    // Choosing the withdrawn method afresh is refused, by name.
    const moved = await changeDays(speaker, { action: "on_demand", dayDates: ["2026-12-02"] });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const back = await changeDays(speaker, { action: "virtual", dayDates: ["2026-12-02"] });
    expect(back.status).toBe(400);
    expect(await refusal(back)).toMatchObject({
      code: "DAY_ATTENDANCE_TYPE_NOT_CONFIGURED",
      message: "Workshop does not offer virtual attendance. Choose another way to attend that day.",
    });
  });

  it("names each refusal of an organizer's day change", async () => {
    const speaker = await acceptedCoSpeaker();

    const unknownDay = await changeDays(speaker, { action: "virtual", dayDates: ["2026-12-09"] });
    expect(unknownDay.status).toBe(400);
    expect(await refusal(unknownDay)).toMatchObject({
      code: "DAY_NOT_CONFIGURED",
      message: "2026-12-09 is not a day of this event. Reload the page and choose from the event's days.",
    });

    await env.DB.prepare("UPDATE event_days SET in_person_capacity = NULL WHERE id = 'speaker-day-two'").run();
    const noQueue = await changeDays(speaker, { action: "waitlist", dayDates: ["2026-12-02"] });
    expect(noQueue.status).toBe(409);
    expect(await refusal(noQueue)).toMatchObject({
      code: "DAY_CAPACITY_UNLIMITED",
      message: "Workshop has no seat limit, so there is no waitlist to join.",
    });

    const malformed = await changeDays(speaker, { action: "virtual", dayDates: [] });
    expect(malformed.status).toBe(400);
    const contract = await refusal(malformed);
    expect(contract.code).toBe("VALIDATION_ERROR");
    expect(contract.details).toMatchObject({ fieldErrors: { dayDates: [expect.any(String)] } });

    await request(
      adminSessionToken,
      `/api/v1/groups/${speaker.groupId}/events/${eventId}/registrations/${speaker.registrationId}`,
      { method: "PATCH", body: JSON.stringify({ action: "cancel" }) },
    );
    const cancelled = await changeDays(speaker, { action: "virtual", dayDates: ["2026-12-01"] });
    expect(cancelled.status).toBe(409);
    expect(await refusal(cancelled)).toMatchObject({
      code: "REGISTRATION_CANCELLED",
      message: "This registration is cancelled. Restore it before changing its days.",
    });
  });

  it("lets the speaker switch their own days to virtual without re-answering registration questions", async () => {
    const speaker = await acceptedCoSpeaker();
    await requireRegistrationQuestion(speaker.groupId);
    const speakerToken = await createAdminSession(env.DB, speaker.coSpeakerUserId, `speaker-${crypto.randomUUID()}`);
    const path = `/api/v1/registrations/${speaker.registrationId}`;

    const days = await request(speakerToken, path, {
      method: "PATCH",
      body: JSON.stringify({
        action: "update",
        dayAttendance: [
          { dayDate: "2026-12-01", attendanceType: "virtual" },
          { dayDate: "2026-12-02", attendanceType: "virtual" },
        ],
      }),
    });
    expect(days.status, await days.clone().text()).toBe(200);
    expect((await heldDays(speaker.registrationId)).map((day) => day.attendance_type)).toEqual(["virtual", "virtual"]);

    // Saving the details form is where the unanswered question is asked,
    // and the refusal names it on its own field.
    const details = await request(speakerToken, path, {
      method: "PATCH",
      body: JSON.stringify({
        action: "update",
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
        customAnswers: {},
      }),
    });
    expect(details.status).toBe(400);
    expect(await refusal(details)).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Answer the highlighted questions.",
      details: { fieldErrors: { country: ["Country is required"] } },
    });

    const scalarOnly = await request(speakerToken, path, {
      method: "PATCH",
      body: JSON.stringify({ action: "update", attendanceType: "virtual" }),
    });
    expect(scalarOnly.status).toBe(400);
    expect(await refusal(scalarOnly)).toMatchObject({
      code: "DAY_ATTENDANCE_REQUIRED",
      message: "Choose how you attend each day of this event.",
    });
  });
});
