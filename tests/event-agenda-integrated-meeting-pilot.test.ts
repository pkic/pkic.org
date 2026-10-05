import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { integratedPilot, pilotEvidence } from "./helpers/agenda-integrated-pilot";
import { queryAll } from "./helpers/context";
import {
  eventSeriesCreateSchema,
  eventSeriesResponseSchema,
  eventOccurrencesListResponseSchema,
  eventOccurrenceInvitationsResponseSchema,
  eventOccurrenceResponseSchema,
} from "../assets/shared/schemas/event-series";
import {
  meetingAgendaSchema,
  meetingAgendaSaveSchema,
  meetingAgendaPublishSchema,
} from "../assets/shared/schemas/meeting-agenda";
import { agendaSnapshotSchema, agendaAllocationSchema } from "../assets/shared/schemas/event-agenda";
import { callApi } from "./helpers/app";
import { ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { hmacSha256Hex } from "../functions/_lib/utils/crypto";
import { calendarRsvpIngestSchema } from "../assets/shared/schemas/calendar-rsvp";
import { calendarRsvpResponseSchema } from "../assets/shared/schemas/route-contracts-calendar";
import { staffingFixture } from "./helpers/agenda-staffing";

beforeEach(resetDb);
it("joins native recurring agenda edits, publication, pinned event staffing and observation/lead reconciliation without conference bridges", async () => {
  const pilot = await integratedPilot();
  const group = "20000000-0000-4000-8000-000000000003";
  await ensureGroupMembershipCapacity(env.DB, group, pilot.person.userId);
  const slug = "joined-native-pilot",
    startsAt = "2026-10-24T09:00:00.000Z";
  const series = (
    await pilot.api(
      `/api/v1/groups/${group}/meetings/series`,
      eventSeriesResponseSchema,
      eventSeriesCreateSchema.parse({
        eventName: "Joined native pilot",
        eventSlug: slug,
        profileKey: "meeting",
        policy: {
          registrationPolicy: "optional",
          memberEligibility: "owner_group",
          guestPolicy: "occurrence_invitation",
        },
        startsAt,
        recurrenceRule: "FREQ=WEEKLY;COUNT=2",
        timezone: "Europe/Amsterdam",
        durationMinutes: 60,
        providerType: null,
        location: "Single meeting room",
      }),
      "POST",
      201,
    )
  ).series;
  const base = `/api/v1/groups/${group}/meetings/series/${series.id}`;
  const occurrences = (await pilot.api(`${base}/occurrences?limit=10&offset=0`, eventOccurrencesListResponseSchema))
    .occurrences;
  expect(occurrences).toHaveLength(2);
  const first = occurrences[0]!,
    second = occurrences[1]!;
  const invited = await pilot.api(
    `${base}/occurrences/${first.id}/invitations`,
    eventOccurrenceInvitationsResponseSchema,
    {},
  );
  expect(invited.invitations.recipientCount).toBeGreaterThanOrEqual(1);
  const person = await env.DB.prepare("SELECT email FROM users WHERE id=?")
    .bind(pilot.person.userId)
    .first<{ email: string }>();
  if (!person) throw new Error("Missing pilot attendee");
  const body = JSON.stringify(
    calendarRsvpIngestSchema.parse({
      uid: `${first.id}@pkic.org`,
      attendeeEmail: person.email,
      partstat: "ACCEPTED",
      provider: "integrated-pilot",
      sourceMessageId: crypto.randomUUID(),
    }),
  );
  const signingSecret = env.INTERNAL_SIGNING_SECRET;
  if (!signingSecret) throw new Error("The mounted RSVP pilot requires INTERNAL_SIGNING_SECRET");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rsvp = await callApi(env, "/api/v1/calendar/rsvp", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-pkic-timestamp": timestamp,
      "x-pkic-signature": await hmacSha256Hex(signingSecret, `${timestamp}.${body}`),
    },
  });
  expect(rsvp.status, await rsvp.clone().text()).toBe(200);
  expect(calendarRsvpResponseSchema.parse(await rsvp.json()).processed).toBe(1);
  expect(
    (await pilot.api(`${base}/occurrences/${first.id}`, eventOccurrenceResponseSchema)).occurrence.rsvp.accepted,
  ).toBe(1);
  expect(
    (await pilot.api(`${base}/occurrences/${second.id}`, eventOccurrenceResponseSchema)).occurrence.rsvp.accepted,
  ).toBe(0);
  let agenda = await pilot.api(`${base}/agenda?occurrenceId=${first.id}`, meetingAgendaSchema);
  const items = ["Opening", "Discussion", "Decision"].map((title) => ({
    id: crypto.randomUUID(),
    title,
    durationMinutes: 20,
    speakerUserIds: [],
  }));
  agenda = await pilot.api(
    `${base}/agenda`,
    meetingAgendaSchema,
    meetingAgendaSaveSchema.parse({
      expectedRevision: agenda.revision,
      expectedWriteRevision: agenda.writeRevision,
      expectedFormatVersion: agenda.formatVersion,
      scope: "occurrence",
      fromOccurrenceId: first.id,
      name: "Native format",
      items,
    }),
  );
  agenda = await pilot.api(
    `${base}/agenda`,
    meetingAgendaSchema,
    meetingAgendaSaveSchema.parse({
      expectedRevision: agenda.revision,
      expectedWriteRevision: agenda.writeRevision,
      expectedFormatVersion: agenda.formatVersion,
      scope: "occurrence",
      fromOccurrenceId: first.id,
      name: agenda.name,
      items: [items[1], items[0], items[2]],
    }),
  );
  expect(agenda.items.map((item) => item.id)).toEqual([items[1]!.id, items[0]!.id, items[2]!.id]);
  const published = await pilot.api(
    `${base}/occurrences/${first.id}/agenda/publications`,
    meetingAgendaSchema,
    meetingAgendaPublishSchema.parse({ expectedRevision: agenda.revision }),
  );
  expect(published.publishedAt).not.toBeNull();
  const untouched = await pilot.api(`${base}/agenda?occurrenceId=${second.id}`, meetingAgendaSchema);
  expect(untouched.publishedAt).toBeNull();
  expect(untouched.items).not.toEqual(published.items);
  const eventBase = `/api/v1/events/${slug}`;
  let state = await pilot.api(`${eventBase}/agenda`, agendaSnapshotSchema);
  const block = {
    id: crypto.randomUUID(),
    name: "Native meeting support",
    startAt: first.startsAt,
    endAt: first.endsAt,
    roomId: null,
    roles: ["mc"],
  };
  const secondBlock = {
    ...block,
    id: crypto.randomUUID(),
    name: "Second recurring support",
    startAt: second.startsAt,
    endAt: second.endsAt,
  };
  state = await pilot.api(
    `${eventBase}/agenda/staffing`,
    agendaSnapshotSchema,
    staffingFixture({
      expectedRevision: state.revision,
      blocks: [block, secondBlock],
      roleMembers: [
        {
          userId: pilot.operatorId,
          displayName: "Pilot operator",
          roles: ["mc"],
          availableFrom: null,
          availableUntil: null,
          maxMinutes: 60,
        },
        {
          userId: pilot.person.userId,
          displayName: "Pilot individual",
          roles: ["mc"],
          availableFrom: null,
          availableUntil: null,
          maxMinutes: 60,
        },
      ],
      assignments: [{ blockId: block.id, role: "mc", userId: pilot.operatorId, pinned: true }],
    }),
  );
  const pinned = state.assignments[0]!;
  state = await pilot.api(
    `${eventBase}/agenda/allocations`,
    agendaSnapshotSchema,
    agendaAllocationSchema.parse({ expectedRevision: state.revision, seed: "native-pilot", strategy: "balanced" }),
  );
  expect(state.assignments).toContainEqual(pinned);
  expect(state.assignments.find((assignment) => assignment.blockId === secondBlock.id)?.userId).toBe(
    pilot.person.userId,
  );
  expect(state.publishedRevision).toBeNull();
  expect(state.occurrences).toEqual([]);
  const evidence = await pilotEvidence(pilot, series.eventId, slug, first.startsAt, null);
  expect(evidence.manifest.nativeEventContext).toEqual({ profileKey: "meeting", timeZone: "Europe/Amsterdam" });
  expect(evidence.manifest.publishedRevision).toBeNull();
  await evidence.reconcile();
  expect(await queryAll(env.DB, "SELECT id FROM event_agenda_occurrences WHERE event_id=?", [series.eventId])).toEqual(
    [],
  );
  expect(await queryAll(env.DB, "SELECT id FROM event_occurrences WHERE series_id=?", [series.id])).toHaveLength(2);
  // Native meeting items do not provide conference preference/reservation targets;
  // conference parity and physical-device acceptance are separate requirements.
});
