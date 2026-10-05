import { expect, type Page } from "@playwright/test";
import { eventDetailResponseSchema } from "../../../assets/shared/schemas/event-management";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../../assets/shared/schemas/group-events";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../../../assets/shared/schemas/event-agenda";

/** Smallest supported UI pages are25rows; each dated population spans two pages. */
export async function prepareAgendaListFixture(page: Page) {
  const ownerResponse = await page.request.get("/api/v1/events/pqc-conference-amsterdam-nl");
  expect(ownerResponse.status()).toBe(200);
  const owner = eventDetailResponseSchema.parse(await ownerResponse.json()).event;
  if (!("ownerGroupId" in owner) || !owner.ownerGroupId) throw new Error("Canonical conference owner missing");
  const slug = `agenda-list-${crypto.randomUUID()}`;
  const created = await page.request.post(`/api/v1/groups/${owner.ownerGroupId}/events`, {
    data: groupEventCreateSchema.parse({
      slug,
      name: "Synthetic paginated agenda",
      profileKey: "conference",
      visibility: "public",
      registrationPolicy: "no_registration",
      timezone: "UTC",
      startsAt: "2027-09-10T09:00:00.000Z",
      endsAt: "2027-09-11T17:00:00.000Z",
      links: [],
    }),
  });
  expect(created.status(), await created.text()).toBe(201);
  const event = groupEventDetailResponseSchema.parse(await created.json()).event;
  const endpoint = `/api/v1/events/${slug}/agenda`;
  const read = async () => {
    const response = await page.request.get(endpoint);
    expect(response.status()).toBe(200);
    return agendaSnapshotSchema.parse(await response.json());
  };
  let snapshot = await read();
  const days = ["2027-09-10", "2027-09-11"] as const;
  for (const [prefix, day, count] of [
    ["Alpha", days[0], 26],
    ["Beta", days[1], 26],
    ["Unscheduled", null, 4],
  ] as const) {
    for (let index = 0; index < count; index++) {
      const start = day ? Date.parse(`${day}T09:00:00.000Z`) + index * 10 * 60_000 : null;
      const response = await page.request.post(`${endpoint}/occurrences`, {
        data: agendaOccurrenceCreateSchema.parse({
          expectedRevision: snapshot.revision,
          title: `Pagination ${prefix} ${String(index + 1).padStart(2, "0")}`,
          description: "Synthetic list read evidence for independent sessions, dates and pagination.",
          startAt: start === null ? null : new Date(start).toISOString(),
          endAt: start === null ? null : new Date(start + 8 * 60_000).toISOString(),
          roomId: null,
        }),
      });
      expect(response.status(), await response.text()).toBe(200);
      snapshot = agendaSnapshotSchema.parse(await response.json());
    }
  }
  expect(snapshot.occurrences).toHaveLength(56);
  return {
    endpoint,
    read,
    snapshot,
    days,
    workspace: `/portal/#/groups/${owner.ownerGroupId}/events/${event.id}/agenda`,
  };
}
