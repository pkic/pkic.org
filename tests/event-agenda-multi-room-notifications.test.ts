import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRevisionSchema,
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
} from "../assets/shared/schemas/event-agenda";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";
import { eventWebPushRegisterSchema, eventWebPushStatusSchema } from "../assets/shared/schemas/event-web-push";
import { agendaOccurrenceRoomIds } from "../assets/shared/event-agenda-rooms";
import { integratedPilot } from "./helpers/agenda-integrated-pilot";
import { createMemberSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll } from "./helpers/context";
import { insertIndividualMember } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { webPushFixture } from "./helpers/web-push";

beforeEach(resetDb);

async function fixture(additionalRoomCount: number) {
  const pilot = await integratedPilot();
  const base = "/api/v1/events/pqc-2026/agenda";
  let snapshot = await pilot.api(base, agendaSnapshotSchema);
  const rooms: string[] = [];
  for (const name of ["Primary", "Overflow", "Extra"]) {
    snapshot = await pilot.api(
      `${base}/rooms`,
      agendaSnapshotSchema,
      agendaRoomCreateSchema.parse({
        expectedRevision: snapshot.revision,
        name,
        capacity: 20,
        setupMinutes: 0,
      }),
    );
    rooms.push(snapshot.rooms.find((room) => room.name === name)!.id);
  }
  snapshot = await pilot.api(
    `${base}/occurrences`,
    agendaSnapshotSchema,
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title: "Multi-room workshop",
      description: "A substantive workshop on interoperable certificate operations and lifecycle management.",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: rooms[0],
      additionalRoomIds: rooms.slice(1, additionalRoomCount + 1),
    }),
  );
  const occurrenceId = snapshot.occurrences[0]!.id;
  snapshot = await pilot.api(
    `${base}/occurrences`,
    agendaSnapshotSchema,
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title: "Unchanged afternoon session",
      description: "An independent afternoon session on interoperable certificate operations and lifecycle management.",
      startAt: "2026-12-01T11:00:00.000Z",
      endAt: "2026-12-01T12:00:00.000Z",
      roomId: rooms[0],
    }),
  );
  const unrelatedOccurrence = snapshot.occurrences.find((item) => item.id !== occurrenceId)!.id;
  snapshot = await pilot.api(
    `${base}/publications`,
    agendaSnapshotSchema,
    agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
  );

  const unrelated = await insertIndividualMember(env.DB);
  const unrelatedToken = await createMemberSession(
    env.DB,
    unrelated.userId,
    crypto.randomUUID(),
    env.INTERNAL_SIGNING_SECRET,
    unrelated.identityId,
  );
  for (const [id, token] of [
    [occurrenceId, pilot.personToken],
    [occurrenceId, undefined],
    [unrelatedOccurrence, unrelatedToken],
  ] as const) {
    await pilot.api(
      `${base}/${id}/participation`,
      sessionParticipationResponseSchema,
      sessionParticipationRequestSchema.parse({ action: "save", attendanceMode: "physical" }),
      "PUT",
      200,
      token,
    );
  }
  const devices = new Map<string, string>();
  for (const [userId, token] of [
    [pilot.person.userId, pilot.personToken],
    [unrelated.userId, unrelatedToken],
  ] as const) {
    const push = await webPushFixture();
    const deviceId = crypto.randomUUID();
    const response = await callApi({ ...env, ...push.config }, "/api/v1/events/pqc-2026/push/devices", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(
        eventWebPushRegisterSchema.parse({
          deviceId,
          subscription: push.subscription,
          enabled: true,
          reminderMinutes: 15,
        }),
      ),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(eventWebPushStatusSchema.parse(await response.json())).toMatchObject({
      enabled: true,
      registered: true,
    });
    devices.set(userId, deviceId);
  }
  const notifications = async () => ({
    email: await queryAll<{ recipient_user_id: string; idempotency_key: string; status: string }>(
      env.DB,
      "SELECT recipient_user_id,idempotency_key,status FROM email_outbox WHERE event_id=? AND template_key='agenda_changed' ORDER BY recipient_user_id",
      pilot.eventId,
    ),
    push: await queryAll<{
      user_id: string;
      device_id: string;
      source_version: number;
      idempotency_key: string;
      status: string;
    }>(
      env.DB,
      "SELECT user_id,device_id,source_version,idempotency_key,status FROM agenda_push_outbox WHERE event_id=? AND kind='agenda_changed' ORDER BY user_id",
      pilot.eventId,
    ),
  });
  async function patch(roomId: string, additionalRoomIds: string[]) {
    snapshot = await pilot.api(
      `${base}/occurrences/${occurrenceId}`,
      agendaSnapshotSchema,
      agendaOccurrencePatchSchema.parse({ expectedRevision: snapshot.revision, roomId, additionalRoomIds }),
      "PATCH",
    );
    return snapshot;
  }
  async function approve() {
    const body = agendaRevisionSchema.parse({ expectedRevision: snapshot.revision });
    snapshot = await pilot.api(`${base}/publications`, agendaSnapshotSchema, body);
    return { snapshot, body };
  }
  return { pilot, base, rooms, occurrenceId, unrelated, devices, notifications, patch, approve };
}

describe("Approved multi-room schedule notifications", () => {
  it.each(["addition", "removal"] as const)(
    "notifies affected recipients once for an approved secondary-room %s",
    async (change) => {
      const value = await fixture(change === "addition" ? 0 : 1);
      expect(await value.notifications()).toEqual({ email: [], push: [] });
      await value.patch(value.rooms[0]!, change === "addition" ? [value.rooms[1]!] : []);
      expect(await value.notifications()).toEqual({ email: [], push: [] });
      const { snapshot, body } = await value.approve();
      const expectedRevision = snapshot.publishedRevision!;
      const queued = await value.notifications();
      expect(queued.email.map(({ recipient_user_id, status }) => ({ recipient_user_id, status }))).toEqual(
        [value.pilot.person.userId, value.pilot.operatorId].sort().map((userId) => ({
          recipient_user_id: userId,
          status: "queued",
        })),
      );
      expect(new Set(queued.email.map((row) => row.idempotency_key)).size).toBe(2);
      for (const row of queued.email) {
        const [prefix, eventId, revision, userId, ...extra] = row.idempotency_key.split(":");
        expect([prefix, eventId, userId, extra]).toEqual([
          "agenda-change",
          value.pilot.eventId,
          row.recipient_user_id,
          [],
        ]);
        expect(Number(revision)).toBe(expectedRevision);
      }
      expect(queued.push).toEqual([
        {
          user_id: value.pilot.person.userId,
          device_id: value.devices.get(value.pilot.person.userId),
          source_version: expectedRevision,
          idempotency_key: `agenda-change:${value.pilot.eventId}:${expectedRevision}:${value.devices.get(value.pilot.person.userId)}`,
          status: "queued",
        },
      ]);
      const replay = await value.pilot.raw(`${value.base}/publications`, body);
      expect(replay.status).toBe(409);
      expect(apiErrorPayloadSchema.parse(await replay.json()).error.code).toBe("AGENDA_ALREADY_APPROVED");
      expect(await value.notifications()).toEqual(queued);
      expect(queued.email.map((row) => row.recipient_user_id)).not.toContain(value.unrelated.userId);
      expect(queued.push.map((row) => row.user_id)).not.toContain(value.unrelated.userId);
    },
  );

  it("does not notify for a secondary-room reorder with the same semantic room set", async () => {
    const value = await fixture(2);
    const changed = await value.patch(value.rooms[0]!, [value.rooms[2]!, value.rooms[1]!]);
    expect(agendaOccurrenceRoomIds(changed.occurrences.find((item) => item.id === value.occurrenceId)!).sort()).toEqual(
      [...value.rooms].sort(),
    );
    expect(await value.notifications()).toEqual({ email: [], push: [] });
    await value.approve();
    expect(await value.notifications()).toEqual({ email: [], push: [] });
  });

  it("retains notification for a primary-room change even when the complete room set is unchanged", async () => {
    const value = await fixture(2);
    const changed = await value.patch(value.rooms[1]!, [value.rooms[0]!, value.rooms[2]!]);
    expect(agendaOccurrenceRoomIds(changed.occurrences.find((item) => item.id === value.occurrenceId)!).sort()).toEqual(
      [...value.rooms].sort(),
    );
    expect(await value.notifications()).toEqual({ email: [], push: [] });
    const { snapshot } = await value.approve();
    const queued = await value.notifications();
    expect(queued.email.map((row) => row.recipient_user_id)).toEqual(
      [value.pilot.person.userId, value.pilot.operatorId].sort(),
    );
    expect(queued.push).toMatchObject([
      { user_id: value.pilot.person.userId, source_version: snapshot.publishedRevision },
    ]);
  });
});
