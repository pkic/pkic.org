import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { integratedPilot, pilotEvidence } from "./helpers/agenda-integrated-pilot";
import { staffingFixture } from "./helpers/agenda-staffing";
import { queryAll } from "./helpers/context";
import { insertIndividualMember } from "./helpers/membership";
import { personalAgendaResponseSchema } from "../assets/shared/schemas/event-personal-agenda";
import { individualAppearanceFixture } from "./helpers/agenda-appearances";
import {
  sessionHistoryMetadataSchema,
  sessionHistoryCorrectionSchema,
} from "../assets/shared/schemas/event-session-history";
import {
  agendaSnapshotSchema,
  agendaRoomCreateSchema,
  agendaOccurrencePatchSchema,
  agendaAllocationSchema,
  agendaRevisionSchema,
} from "../assets/shared/schemas/event-agenda";
import {
  transferPrepareSchema,
  transferReviewSchema,
  transferApplySchema,
  transferApplyResponseSchema,
} from "../assets/shared/schemas/event-agenda-transfer";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";

beforeEach(resetDb);
it("joins portable parallel/multi-day import, edit, pinned staffing, publication, participation and scanner/report/lead replay", async () => {
  const pilot = await integratedPilot(),
    base = "/api/v1/events/pqc-2026";
  // This conference needs room for the presenter, MC and workshop attendee.
  // The shared capacity-race fixture starts at one, which is intentionally too small here.
  await env.DB.prepare("UPDATE events SET capacity_in_person=3 WHERE id=?").bind(pilot.eventId).run();
  const speaker = await insertIndividualMember(env.DB, "H6", `pilot-speaker-${crypto.randomUUID()}@example.test`);
  const rows = [
    {
      ref: "opening",
      room: "plenary",
      start: "2026-12-01T09:00:00.000Z",
      end: "2026-12-01T10:00:00.000Z",
      policy: "preference",
    },
    {
      ref: "workshop",
      room: "workshop",
      start: "2026-12-01T09:00:00.000Z",
      end: "2026-12-01T10:00:00.000Z",
      policy: "reservation",
    },
    {
      ref: "next-day",
      room: "plenary",
      start: "2026-12-02T09:00:00.000Z",
      end: "2026-12-02T10:00:00.000Z",
      policy: "preference",
    },
  ];
  let locations = await pilot.api(`${base}/agenda`, agendaSnapshotSchema);
  for (const [name, capacity] of [
    ["Plenary", 20],
    ["Workshop", 1],
  ] as const) {
    locations = await pilot.api(
      `${base}/agenda/rooms`,
      agendaSnapshotSchema,
      agendaRoomCreateSchema.parse({ expectedRevision: locations.revision, name, capacity }),
    );
  }
  const roomIds = Object.fromEntries(locations.rooms.map((room) => [room.name.toLowerCase(), room.id]));
  const prepared = transferPrepareSchema.parse({
    expectedRevision: locations.revision,
    mode: "archive",
    resolutions: {
      people: { speaker: { userId: speaker.userId, actingIdentityId: speaker.identityId } },
      rooms: { plenary: roomIds.plenary, workshop: roomIds.workshop },
      media: {},
      rows: {},
    },
    document: {
      format: "pkic-agenda",
      version: 1,
      source: {
        kind: "portable",
        eventRef: "joined-pilot-source",
        exportedAt: new Date().toISOString(),
        sourceDigest: "a".repeat(64),
      },
      people: [
        {
          ref: "speaker",
          label: "Selected individual",
          canonicalUserId: null,
          actingIdentityId: null,
          role: "speaker",
        },
      ],
      rooms: [
        { ref: "plenary", label: "Plenary", canonicalRoomId: null },
        { ref: "workshop", label: "Workshop", canonicalRoomId: null },
      ],
      occurrences: rows.map((row) => ({
        ref: row.ref,
        sourceKey: `joined-pilot:${row.ref}`,
        sourceAnchor: null,
        sourcePath: "/events/joined-pilot-source/",
        fields: {
          title: row.ref,
          description: "Substantive synthetic portable pilot session.",
          visibility: "public",
          admissionPolicy: row.policy,
          capacity: row.policy === "reservation" ? 1 : null,
        },
        timing: {
          timeZone: "Europe/Amsterdam",
          authoredDate: row.start.slice(0, 10),
          startAt: row.start,
          endAt: row.end,
          authoredStart: null,
          endSource: "explicit",
          transitionMinutes: 0,
          transitionSource: "none",
        },
        roomRefs: [row.room],
        personRefs: row.ref === "opening" ? ["speaker"] : [],
        media: [],
        archive: null,
      })),
    },
  });
  const review = await pilot.api(`${base}/agenda/transfers/reviews`, transferReviewSchema, prepared);
  expect(review.ready, JSON.stringify(review.findings)).toBe(true);
  let state = (
    await pilot.api(
      `${base}/agenda/transfers`,
      transferApplyResponseSchema,
      transferApplySchema.parse({
        ...prepared,
        reviewDigest: review.digest,
        acknowledgeInferredTiming: false,
        // The synthetic source and selected representation are explicitly reviewed here;
        // public appearance approval still runs through its separate mounted route below.
        acknowledgeArchiveRepresentation: true,
      }),
    )
  ).agenda;
  expect(state.occurrences).toHaveLength(3);
  const ids = state.occurrences.map((row) => row.id).sort();
  const opening = state.occurrences.find((row) => row.title === "opening")!,
    workshop = state.occurrences.find((row) => row.title === "workshop")!;
  expect(opening.speakers[0]!.userId).toBe(speaker.userId);
  state = await pilot.api(
    `${base}/agenda/occurrences/${workshop.id}`,
    agendaSnapshotSchema,
    agendaOccurrencePatchSchema.parse({ expectedRevision: state.revision, title: "Reviewed workshop" }),
    "PATCH",
  );
  state = await pilot.api(
    `${base}/agenda/occurrences/${opening.id}/history`,
    agendaSnapshotSchema,
    sessionHistoryCorrectionSchema.parse({
      expectedRevision: state.revision,
      history: sessionHistoryMetadataSchema.parse({
        ...opening.history,
        appearances: [
          {
            ...individualAppearanceFixture({
              userId: speaker.userId,
              displayName: "Selected individual",
              approvedAt: new Date(Date.now() - 1000).toISOString(),
            }),
            actingIdentityId: speaker.identityId,
          },
        ],
      }),
    }),
  );
  const block = {
    id: crypto.randomUUID(),
    name: "Plenary room support",
    startAt: rows[0]!.start,
    endAt: rows[0]!.end,
    roomId: opening.roomId,
    roles: ["mc"],
  };
  const secondBlock = {
    ...block,
    id: crypto.randomUUID(),
    name: "Next-day support",
    startAt: rows[2]!.start,
    endAt: rows[2]!.end,
  };
  state = await pilot.api(
    `${base}/agenda/staffing`,
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
    `${base}/agenda/allocations`,
    agendaSnapshotSchema,
    agendaAllocationSchema.parse({ expectedRevision: state.revision, seed: "parallel-pilot", strategy: "balanced" }),
  );
  expect(state.assignments).toContainEqual(pinned);
  expect(state.assignments.find((assignment) => assignment.blockId === secondBlock.id)?.userId).toBe(
    pilot.person.userId,
  );
  state = await pilot.api(
    `${base}/agenda/publications`,
    agendaSnapshotSchema,
    agendaRevisionSchema.parse({ expectedRevision: state.revision }),
  );
  expect(state.publishedRevision).toBe(state.revision);
  expect(state.occurrences.map((row) => row.id).sort()).toEqual(ids);
  expect(
    await queryAll(
      env.DB,
      "SELECT user_id FROM event_agenda_operational_people WHERE event_id=? AND revision=? AND occurrence_id=? ORDER BY user_id",
      [pilot.eventId, state.publishedRevision, opening.id],
    ),
  ).toEqual([speaker.userId, pilot.operatorId].sort().map((user_id) => ({ user_id })));
  expect(
    await queryAll(
      env.DB,
      "SELECT user_id FROM event_agenda_operational_people WHERE event_id=? AND revision=? AND occurrence_id=?",
      [pilot.eventId, state.publishedRevision, workshop.id],
    ),
  ).toEqual([]);
  const evidence = await pilotEvidence(pilot, pilot.eventId, "pqc-2026", rows[0]!.start, workshop.id, workshop.roomId);
  // An observed attendee remains a physical observation even when the support check
  // warns about a missing session reservation; scanning never allocates the place.
  expect(await evidence.upload(evidence.capture())).toMatchObject({
    outcome: "warning",
    reason: "missing_registration",
    attendanceRecorded: true,
    admissionRecorded: false,
  });
  expect(
    await queryAll(
      env.DB,
      "SELECT id FROM agenda_session_participations WHERE event_id=? AND occurrence_id=? AND user_id=?",
      [pilot.eventId, workshop.id, pilot.person.userId],
    ),
  ).toEqual([]);
  const personal = await pilot.api(
    `${base}/agenda/participation?occurrenceId=${workshop.id}`,
    personalAgendaResponseSchema,
    undefined,
    "GET",
    200,
    pilot.personToken,
  );
  const displayedWorkshop = personal.sessions.find((session) => session.id === workshop.id);
  if (!displayedWorkshop) throw new Error("The published workshop must be visible in the attendee's personal agenda");
  expect(displayedWorkshop.publishedRevision).toBe(state.publishedRevision);
  for (const [session, action, status] of [
    [opening, "save", "saved"],
    [workshop, "reserve", "reserved"],
  ] as const) {
    const result = await pilot.api(
      `${base}/agenda/${session.id}/participation`,
      sessionParticipationResponseSchema,
      sessionParticipationRequestSchema.parse({
        action,
        attendanceMode: "physical",
        roomId: session.roomId,
        ...(action === "reserve" ? { expectedPublishedRevision: displayedWorkshop.publishedRevision } : {}),
      }),
      "PUT",
      200,
      pilot.personToken,
    );
    expect(result.status).toBe(status);
  }
  expect(
    await queryAll(
      env.DB,
      "SELECT status FROM agenda_session_participations WHERE event_id=? AND occurrence_id=? AND user_id=?",
      [pilot.eventId, workshop.id, pilot.person.userId],
    ),
  ).toEqual([{ status: "reserved" }]);
  await evidence.reconcile();
  expect(evidence.manifest.publishedRevision).toBe(state.publishedRevision);
});
