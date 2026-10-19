import { expect, type Page } from "@playwright/test";
import { eventDetailResponseSchema } from "../../../assets/shared/schemas/event-management";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../../assets/shared/schemas/group-events";
import {
  agendaOccurrenceCreateSchema,
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
  agendaStaffingSchema,
} from "../../../assets/shared/schemas/event-agenda";

import { userCreateSchema, userCreateResponseSchema } from "../../../assets/shared/schemas/user-create";

export const matrixTitle =
  "A practical roadmap for cryptographic agility: coordinating infrastructure, application teams, and standards through a multi-year transition";

/** The existing platform fixture's public conference/three-room shape, on a fresh event. */
export async function prepareAgendaInteractionFixture(page: Page) {
  const owner = eventDetailResponseSchema.parse(
    await (await page.request.get("/api/v1/events/pqc-conference-amsterdam-nl")).json(),
  ).event;
  if (!("ownerGroupId" in owner) || !owner.ownerGroupId) throw new Error("Canonical conference owner missing");
  const slug = `agenda-interaction-${crypto.randomUUID()}`;
  const created = await page.request.post(`/api/v1/groups/${owner.ownerGroupId}/events`, {
    data: groupEventCreateSchema.parse({
      slug,
      name: "Synthetic agenda interaction matrix",
      profileKey: "conference",
      visibility: "public",
      registrationPolicy: "no_registration",
      timezone: "UTC",
      startsAt: "2027-09-10T09:00:00.000Z",
      endsAt: "2027-09-11T17:00:00.000Z",
      links: [],
    }),
  });
  expect(created.status()).toBe(201);
  groupEventDetailResponseSchema.parse(await created.json());
  const endpoint = `/api/v1/events/${slug}/agenda`;
  const read = async () => agendaSnapshotSchema.parse(await (await page.request.get(endpoint)).json());
  let snapshot = await read();
  for (const name of ["Main auditorium", "Workshop room", "Community discussion room"]) {
    const response = await page.request.post(`${endpoint}/rooms`, {
      data: agendaRoomCreateSchema.parse({ expectedRevision: snapshot.revision, name, capacity: 80 }),
    });
    expect(response.status()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
  }
  const people: Array<{ id: string; name: string }> = [];
  for (const firstName of ["Matrix Moderator", "Matrix Panelist"]) {
    const response = await page.request.post("/api/v1/users", {
      data: userCreateSchema.parse({
        email: `matrix-${crypto.randomUUID()}@example.test`,
        firstName,
        lastName: "Fixture",
      }),
    });
    expect(response.status()).toBe(201);
    people.push({ id: userCreateResponseSchema.parse(await response.json()).userId, name: `${firstName} Fixture` });
  }
  const room = snapshot.rooms.find((value) => value.name === "Main auditorium")!;
  const workshop = snapshot.rooms.find((value) => value.name === "Workshop room")!;
  expect(workshop.id).not.toBe(room.id);
  for (const [index, title] of [matrixTitle, "Discussion with the community"].entries()) {
    const response = await page.request.post(`${endpoint}/occurrences`, {
      data: agendaOccurrenceCreateSchema.parse({
        expectedRevision: snapshot.revision,
        title,
        visibility: "public",
        description: "Explore practical approaches with the PKI community, with time for discussion and questions.",
        startAt: index ? "2027-09-10T09:57:00.000Z" : "2027-09-10T09:00:00.000Z",
        endAt: index ? "2027-09-10T12:00:00.000Z" : "2027-09-10T09:45:00.000Z",
        roomId: index ? workshop.id : room.id,
        speakerUserIds: index ? [] : people.map((person) => person.id),
        speakerRoles: index ? {} : { [people[0]!.id]: "moderator", [people[1]!.id]: "panelist" },
      }),
    });
    expect(response.status()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
  }
  const occurrence = snapshot.occurrences.find((value) => value.title === matrixTitle)!;
  expect(occurrence.roomId).toBe(room.id);
  expect(snapshot.occurrences.find((value) => value.title === "Discussion with the community")?.roomId).toBe(
    workshop.id,
  );
  return { slug, endpoint, room, occurrence, people, read };
}

/** One manual duty and one uncovered position; reuses the canonical staffing fixture contract. */
export async function prepareMatrixStaffing(
  page: Page,
  fixture: Awaited<ReturnType<typeof prepareAgendaInteractionFixture>>,
) {
  const before = await fixture.read();
  const prefix = crypto.randomUUID();
  const shiftId = `${prefix}-block`;
  const roleId = `${prefix}-mc`;
  const requirementId = `${prefix}-need`;
  const shiftName = "Matrix afternoon panel staffing";
  const response = await page.request.post(`${fixture.endpoint}/staffing`, {
    data: agendaStaffingSchema.parse({
      expectedRevision: before.revision,
      shifts: [
        {
          id: shiftId,
          name: shiftName,
          startAt: "2027-09-10T13:00:00.000Z",
          endAt: "2027-09-10T13:30:00.000Z",
          roomId: null,
          roles: [roleId],
          compatibleRolePairs: [],
          roleRequirements: [],
        },
      ],
      staffingRoles: [{ id: roleId, name: "Matrix MC", showOnAgenda: true }],
      staffingPosts: [],
      staffingRequirements: [
        {
          id: requirementId,
          shiftId,
          roleId,
          postId: null,
          idealCount: 2,
          seniority: "any",
          attendanceMode: "physical",
        },
      ],
      staffingPositions: [1, 2].map((index) => ({ id: `${prefix}-position-${index}`, requirementId, index })),
      assignments: [],
      roleMembers: [
        {
          userId: fixture.people[0]!.id,
          displayName: fixture.people[0]!.name,
          roles: [roleId],
          seniority: "senior",
          attendanceMode: "physical",
          availableFrom: null,
          availableUntil: null,
          maxMinutes: null,
        },
      ],
    }),
  });
  expect(response.status()).toBe(200);
  const configured = agendaSnapshotSchema.parse(await response.json());
  return { configured, shiftId, roleId, shiftName, positionId: `${prefix}-position-1` };
}
