import { staffingFixture } from "./helpers/agenda-staffing";
import {
  agendaScheduleProposalSchema,
  agendaScheduleReviewSchema,
  agendaScheduleConflictDetailsSchema,
  agendaScheduleConflictProposalSchema,
} from "../assets/shared/schemas/event-agenda-schedule";
import { applyAgendaSchedule } from "../functions/_lib/services/event-agenda/schedule";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import { AppError } from "../functions/_lib/errors";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  agendaSettingsSchema,
  agendaOccurrenceCreateSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

describe("canonical person availability across event agendas", () => {
  beforeEach(resetDb);
  async function fixture() {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [person] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const otherId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,visibility,settings_json,created_at,updated_at)
      VALUES(?,'private-meeting','Private board meeting','Europe/Amsterdam',
        '2026-12-01T08:00:00.000Z','2026-12-03T18:00:00.000Z','invitation_only','{}',?,?)`,
    )
      .bind(otherId, now, now)
      .run();
    const token = await createAdminSession(env.DB, person.id, "cross-event-agenda");
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    async function post(slug: string, suffix: string, body: unknown) {
      return callApi(env, `/api/v1/events/${slug}/agenda/${suffix}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }
    async function talk(
      slug: string,
      revision: number,
      startAt = "2026-12-01T09:00:00.000Z",
      endAt = "2026-12-01T10:00:00.000Z",
    ) {
      return post(
        slug,
        "occurrences",
        agendaOccurrenceCreateSchema.parse({
          expectedRevision: revision,
          title: slug === "private-meeting" ? "Confidential merger discussion" : "Public talk",
          startAt,
          endAt,
          roomId: null,
          speakerUserIds: [person.id],
        }),
      );
    }
    return { eventId, otherId, person, post, talk, headers };
  }

  it("chooses another eligible host when one is speaking in a private event", async () => {
    const { talk, person, post } = await fixture();
    expect((await talk("private-meeting", 0)).status).toBe(200);
    const block = {
      id: crypto.randomUUID(),
      name: "Public morning",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: null,
      roles: ["mc"],
      roleRequirements: [],
    };
    const member = (userId: string) => ({
      userId,
      displayName: "Host",
      roles: ["mc"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
      seniority: "senior" as const,
      attendanceMode: "physical" as const,
    });
    expect(
      (
        await post(
          "pqc-2026",
          "staffing",
          staffingFixture({
            expectedRevision: 0,
            shifts: [block],
            roleMembers: [member(person.id)],
            assignments: [],
          }),
        )
      ).status,
    ).toBe(200);
    const unavailable = await post("pqc-2026", "allocations", {
      expectedRevision: 1,
      seed: "external",
      strategy: "balanced",
    });
    expect(unavailable.status).toBe(200);
    const shortfall = agendaSnapshotSchema.parse(await unavailable.json());
    expect(shortfall.assignments).toEqual([]);
    expect(shortfall.staffingReport?.uncovered[0].reasons).toContainEqual({ reason: "external_conflict", people: 1 });
    expect(JSON.stringify(shortfall)).not.toContain("Confidential merger");
    const alternate = await insertUser(env.DB, `alternate-${crypto.randomUUID()}@example.test`);
    expect(
      (
        await post(
          "pqc-2026",
          "staffing",
          staffingFixture({
            expectedRevision: 2,
            shifts: [block],
            roleMembers: [member(person.id), member(alternate)],
            assignments: [],
          }),
        )
      ).status,
    ).toBe(200);
    const generated = await post("pqc-2026", "allocations", {
      expectedRevision: 3,
      seed: "external",
      strategy: "balanced",
    });
    expect(generated.status).toBe(200);
    expect(await generated.json()).toMatchObject({
      assignments: [{ shiftId: block.id, userId: alternate, role: "mc" }],
    });
  });
  it("rejects simultaneous saves across independent revisions atomically", async () => {
    const { talk } = await fixture();
    const results = await Promise.all([talk("pqc-2026", 0), talk("private-meeting", 0)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const failedIndex = results.findIndex((response) => response.status === 409);
    const failure = apiErrorPayloadSchema.parse(await results[failedIndex]!.json());
    expect(failure.error.code).toBe("AGENDA_SCHEDULE_CONFLICT");
    const details = agendaScheduleConflictDetailsSchema.parse(failure.error.details);
    expect(details.proposal?.occurrences).toHaveLength(1);
    expect(details.proposal?.occurrences[0]).toMatchObject({
      title: failedIndex === 0 ? "Public talk" : "Confidential merger discussion",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: null,
    });
    // The attempted resource is readable by this event's editor; the other commitment stays private.
    const serialized = JSON.stringify(failure);
    expect(serialized).not.toContain(failedIndex === 0 ? "Confidential merger discussion" : "Public talk");
    expect(serialized).not.toContain("Private board meeting");
    expect(serialized).not.toContain("private-meeting");
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_occurrences")).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_schedule_guards")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT event_id FROM event_agenda_state WHERE revision=1")).toHaveLength(1);
  });

  it("round-trips event duration rules and rolls back stale or unauthorized settings writes atomically", async () => {
    const { post, eventId, headers } = await fixture();
    await env.DB.prepare(
      "UPDATE events SET settings_json=json_set(settings_json,'$.syntheticOther',json(?),'$.agenda.otherRule',?) WHERE id=?",
    )
      .bind(JSON.stringify({ keep: true }), "retained", eventId)
      .run();
    const rules = { defaultMinutes: 40, quickMinutes: [20, 40, 80] };
    const response = await post(
      "pqc-2026",
      "settings",
      agendaSettingsSchema.parse({ expectedRevision: 0, travelMinutes: 5, durationRules: rules }),
    );
    expect(response.status).toBe(200);
    expect(agendaSnapshotSchema.parse(await response.json())).toMatchObject({ revision: 1, durationRules: rules });
    const read = await callApi(env, "/api/v1/events/pqc-2026/agenda", { headers });
    expect(read.status).toBe(200);
    expect(agendaSnapshotSchema.parse(await read.json()).durationRules).toEqual(rules);
    const [stored] = await queryAll<{ settings_json: string }>(
      env.DB,
      "SELECT settings_json FROM events WHERE id=?",
      eventId,
    );
    expect(JSON.parse(stored!.settings_json)).toMatchObject({
      syntheticOther: { keep: true },
      agenda: { otherRule: "retained", durationRules: rules },
    });
    const state = await queryAll(
      env.DB,
      "SELECT revision,travel_minutes FROM event_agenda_state WHERE event_id=?",
      eventId,
    );
    const audits = await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id");
    expect(state).toEqual([{ revision: 1, travel_minutes: 5 }]);
    const refusedBody = agendaSettingsSchema.parse({
      expectedRevision: 0,
      travelMinutes: 9,
      durationRules: { defaultMinutes: 60, quickMinutes: [30, 60] },
    });
    const stale = await post("pqc-2026", "settings", refusedBody);
    expect(stale.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await stale.json()).error.code).toBe("AGENDA_AUTHORIZATION_CHANGED");
    const unauthorized = await callApi(env, "/api/v1/events/pqc-2026/agenda/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...refusedBody, expectedRevision: 1 }),
    });
    expect(unauthorized.status).toBe(401);
    expect(await queryAll(env.DB, "SELECT settings_json FROM events WHERE id=?", eventId)).toEqual([
      { settings_json: stored!.settings_json },
    ]);
    expect(
      await queryAll(env.DB, "SELECT revision,travel_minutes FROM event_agenda_state WHERE event_id=?", eventId),
    ).toEqual(state);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id")).toEqual(audits);
  });

  it("allows exact half-open boundaries and enforces the larger cross-event travel buffer", async () => {
    const { talk, post, eventId } = await fixture();
    expect((await talk("pqc-2026", 0)).status).toBe(200);
    expect((await post("pqc-2026", "settings", { expectedRevision: 1, travelMinutes: 10 })).status).toBe(200);
    const insufficient = await talk("private-meeting", 0, "2026-12-01T10:05:00.000Z", "2026-12-01T11:00:00.000Z");
    expect(insufficient.status).toBe(409);
    expect((await talk("private-meeting", 0, "2026-12-01T10:10:00.000Z", "2026-12-01T11:00:00.000Z")).status).toBe(200);
    const changed = await post("pqc-2026", "settings", { expectedRevision: 2, travelMinutes: 11 });
    expect(changed.status).toBe(409);
    expect(
      await queryAll(env.DB, "SELECT travel_minutes,revision FROM event_agenda_state WHERE event_id=?", eventId),
    ).toEqual([{ travel_minutes: 10, revision: 2 }]);
  });

  it("guards pinned MC assignments against speaking in another private event", async () => {
    const { talk, post, person, otherId } = await fixture();
    expect((await talk("pqc-2026", 0)).status).toBe(200);
    const response = await post(
      "private-meeting",
      "staffing",
      staffingFixture({
        expectedRevision: 0,
        shifts: [
          {
            id: "private-opening",
            name: "Opening",
            startAt: "2026-12-01T09:00:00.000Z",
            endAt: "2026-12-01T10:00:00.000Z",
            roomId: null,
            roles: ["mc"],
          },
        ],
        roleMembers: [
          {
            userId: person.id,
            displayName: "MC",
            roles: ["mc"],
            availableFrom: null,
            availableUntil: null,
            maxMinutes: null,
          },
        ],
        assignments: [{ shiftId: "private-opening", role: "mc", userId: person.id, pinned: true }],
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("AGENDA_SCHEDULE_CONFLICT");
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_shifts WHERE event_id=?", otherId)).toEqual([]);
    expect(await queryAll(env.DB, "SELECT event_id FROM event_agenda_state WHERE event_id=?", otherId)).toEqual([]);
  });

  it("rolls back a swap that would create an external conflict without changing either session", async () => {
    const { talk, post, headers } = await fixture();
    const firstResponse = await talk("pqc-2026", 0);
    const first = agendaSnapshotSchema.parse(await firstResponse.json()).occurrences[0];
    const secondResponse = await post(
      "pqc-2026",
      "occurrences",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 1,
        title: "Later session",
        startAt: "2026-12-01T10:00:00.000Z",
        endAt: "2026-12-01T11:00:00.000Z",
        roomId: null,
      }),
    );
    const second = agendaSnapshotSchema
      .parse(await secondResponse.json())
      .occurrences.find((item) => item.id !== first.id)!;
    const proposal = agendaScheduleProposalSchema.parse({
      expectedRevision: 2,
      changes: [
        [first, second],
        [second, first],
      ].map(([session, target]) => ({
        id: session.id,
        startAt: target.startAt,
        endAt: new Date(
          Date.parse(target.startAt!) + Date.parse(session.endAt!) - Date.parse(session.startAt!),
        ).toISOString(),
        roomId: target.roomId,
        additionalRoomIds: target.additionalRoomIds ?? [],
      })),
    });
    const reviewResponse = await post("pqc-2026", "schedule/reviews", proposal);
    expect(reviewResponse.status, await reviewResponse.clone().text()).toBe(200);
    const review = agendaScheduleReviewSchema.parse(await reviewResponse.json());
    const beforeApply = agendaSnapshotSchema.parse(
      await (await callApi(env, "/api/v1/events/pqc-2026/agenda", { headers })).json(),
    );
    expect(beforeApply.revision).toBe(2);
    expect(beforeApply.occurrences.find((item) => item.id === first.id)?.startAt).toBe(first.startAt);
    expect(beforeApply.occurrences.find((item) => item.id === second.id)?.startAt).toBe(second.startAt);
    // A new external commitment after review must still be checked atomically during apply.
    expect((await talk("private-meeting", 0, second.startAt!, second.endAt!)).status).toBe(200);
    const swapped = await post("pqc-2026", "schedule", { ...proposal, reviewHash: review.reviewHash });
    expect(swapped.status).toBe(409);
    const refusal = apiErrorPayloadSchema.parse(await swapped.json());
    expect(refusal.error.code).toBe("AGENDA_SCHEDULE_CONFLICT");
    const details = agendaScheduleConflictDetailsSchema.parse(refusal.error.details);
    expect(details.proposal).toEqual(
      agendaScheduleConflictProposalSchema.parse({
        timeZone: beforeApply.timeZone,
        occurrences: review.affected.map((item) => item.after),
      }),
    );
    expect(JSON.stringify(refusal)).not.toContain("Confidential merger discussion");
    expect(JSON.stringify(refusal)).not.toContain("private-meeting");
    const current = await callApi(env, "/api/v1/events/pqc-2026/agenda", { headers });
    const snapshot = agendaSnapshotSchema.parse(await current.json());
    expect(snapshot.revision).toBe(2);
    expect(snapshot.occurrences.find((item) => item.id === first.id)?.startAt).toBe(first.startAt);
    expect(snapshot.occurrences.find((item) => item.id === second.id)?.startAt).toBe(second.startAt);
  });

  it("identifies the owned edited session and proposed time on a mounted room-equipment refusal", async () => {
    const { post, headers, eventId } = await fixture();
    let snapshot = agendaSnapshotSchema.parse(
      await (
        await post("pqc-2026", "rooms", {
          expectedRevision: 0,
          name: "Equipped",
          capacity: 20,
          setupMinutes: 0,
          equipment: ["projector"],
        })
      ).json(),
    );
    const equipped = snapshot.rooms[0]!.id;
    snapshot = agendaSnapshotSchema.parse(
      await (
        await post("pqc-2026", "rooms", {
          expectedRevision: 1,
          name: "Other",
          capacity: 20,
          setupMinutes: 0,
          equipment: [],
        })
      ).json(),
    );
    const other = snapshot.rooms.find((room) => room.name === "Other")!.id;
    snapshot = agendaSnapshotSchema.parse(
      await (
        await post("pqc-2026", "occurrences", {
          expectedRevision: 2,
          title: "Projector demo",
          startAt: "2026-12-01T09:00:00.000Z",
          endAt: "2026-12-01T10:00:00.000Z",
          roomId: equipped,
          requiredEquipment: ["projector"],
        })
      ).json(),
    );
    const occurrence = snapshot.occurrences[0]!;
    const audits = await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id");
    const response = await callApi(env, `/api/v1/events/pqc-2026/agenda/occurrences/${occurrence.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expectedRevision: snapshot.revision, roomId: other }),
    });
    expect(response.status).toBe(409);
    const refusal = apiErrorPayloadSchema.parse(await response.json());
    expect(refusal.error.code).toBe("AGENDA_SCHEDULE_CONFLICT");
    const details = agendaScheduleConflictDetailsSchema.parse(refusal.error.details);
    expect(details.conflicts).toContain("Projector demo: Other does not provide projector");
    expect(details.proposal).toEqual(
      agendaScheduleConflictProposalSchema.parse({
        timeZone: snapshot.timeZone,
        occurrences: [{ ...occurrence, roomId: other }],
      }),
    );
    const current = await callApi(env, "/api/v1/events/pqc-2026/agenda", { headers });
    expect(agendaSnapshotSchema.parse(await current.json())).toEqual(snapshot);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id")).toEqual(audits);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests WHERE resource_id=?", eventId)).toEqual([]);
  });

  it("retains proposed owned resources on a final-batch cross-event conflict with no dependent writes", async () => {
    const { eventId, person, post, talk, headers, otherId } = await fixture();
    const snapshot = agendaSnapshotSchema.parse(await (await talk("pqc-2026", 0)).json());
    const occurrence = snapshot.occurrences[0]!;
    const proposal = agendaScheduleProposalSchema.parse({
      expectedRevision: snapshot.revision,
      changes: [
        {
          id: occurrence.id,
          startAt: "2026-12-01T11:00:00.000Z",
          endAt: "2026-12-01T12:00:00.000Z",
          roomId: null,
        },
      ],
    });
    const reviewed = await post("pqc-2026", "schedule/reviews", proposal);
    expect(reviewed.status).toBe(200);
    const review = agendaScheduleReviewSchema.parse(await reviewed.json());
    const effects = async () => ({
      audit: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
      outbox: await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id"),
      requests: await queryAll(env.DB, "SELECT id FROM site_publication_requests ORDER BY id"),
    });
    let before = await effects();
    let foreignOccurrenceId: string | undefined;
    const racing = mutateBeforeNextBatch(env.DB, async () => {
      const external = await talk("private-meeting", 0, proposal.changes[0]!.startAt!, proposal.changes[0]!.endAt!);
      expect(external.status).toBe(200);
      foreignOccurrenceId = agendaSnapshotSchema.parse(await external.json()).occurrences[0]!.id;
      before = await effects();
    });
    const error = await applyAgendaSchedule(
      racing,
      eventId,
      "pqc-2026",
      { ...proposal, reviewHash: review.reviewHash },
      person.id,
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AppError);
    if (!(error instanceof AppError)) throw new Error("Expected an atomic schedule refusal");
    expect(error).toMatchObject({ status: 409, code: "AGENDA_SCHEDULE_CONFLICT" });
    const details = agendaScheduleConflictDetailsSchema.parse(error.details);
    expect(details.proposal).toEqual(
      agendaScheduleConflictProposalSchema.parse({
        timeZone: snapshot.timeZone,
        occurrences: review.affected.map((item) => item.after),
      }),
    );
    expect(details.conflicts).toEqual([
      "A speaker or assigned staff member has another session or duty, or needs travel time.",
    ]);
    expect(JSON.stringify(error.details)).not.toContain(otherId);
    expect(foreignOccurrenceId).toBeDefined();
    expect(JSON.stringify(error.details)).not.toContain(foreignOccurrenceId!);
    expect(JSON.stringify(error.details)).not.toContain("Confidential merger discussion");
    expect(JSON.stringify(error.details)).not.toContain("private-meeting");
    expect(await effects()).toEqual(before);
    const current = await callApi(env, "/api/v1/events/pqc-2026/agenda", { headers });
    expect(agendaSnapshotSchema.parse(await current.json())).toEqual(snapshot);
    expect(await queryAll(env.DB, "SELECT id FROM event_agenda_schedule_guards")).toEqual([]);
  });
});
