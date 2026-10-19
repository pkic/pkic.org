import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";
import {
  attendanceSummarySchema,
  eventAttendancePeopleResponseSchema,
} from "../assets/shared/schemas/event-attendance-reporting";
import { attendanceEvidenceResponseSchema } from "../assets/shared/schemas/event-attendance-corrections";
import { attendanceReportSchema } from "../assets/shared/schemas/event-participation-reporting";

const fixture = createEventScannerFixture();
const firstAt = "2026-10-02T22:10:00.000Z";
const repeatedAt = "2026-10-02T22:20:00.000Z";
const secondAt = "2026-10-03T22:10:00.000Z";
let secondOccurrenceId: string;
async function read(suffix: string) {
  const response = await callApi(env, `/api/v1/events/scan-test/attendance${suffix}`, {
    headers: { authorization: `Bearer ${fixture.token}` },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response;
}

describe("Mounted repeated-occurrence attendance across captured event days", () => {
  beforeEach(async () => {
    await fixture.setup();
    secondOccurrenceId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE events SET timezone='Europe/Amsterdam' WHERE id=?").bind(fixture.eventId),
      env.DB.prepare(
        "UPDATE event_agenda_occurrences SET title='Repeated workshop',start_at='2026-10-02T22:00:00.000Z',end_at='2026-10-02T23:00:00.000Z',admission_policy='preference' WHERE id=?",
      ).bind(fixture.occurrenceId),
      env.DB.prepare(
        "INSERT INTO event_agenda_occurrences(id,event_id,title,start_at,end_at,admission_policy) VALUES(?,?,'Repeated workshop','2026-10-03T22:00:00.000Z','2026-10-03T23:00:00.000Z','preference')",
      ).bind(secondOccurrenceId, fixture.eventId),
    ]);
    const snapshot = await getAgenda(env.DB, fixture.eventId, "scan-test");
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=0")
      .bind(JSON.stringify(snapshot), fixture.eventId)
      .run();
  });

  it("preserves original entries and distinct same-title occurrence/day populations without duplicate replay presence", async () => {
    const bodies = [
      fixture.scanBody({ observedAt: firstAt, capturePublicationRevision: 0 }),
      fixture.scanBody({ observedAt: repeatedAt, capturePublicationRevision: 0 }),
      fixture.scanBody({ occurrenceId: secondOccurrenceId, observedAt: secondAt, capturePublicationRevision: 0 }),
    ].map((body) => enrolledEventScanRequestSchema.parse(body));
    const receipts = [];
    for (const body of bodies) {
      const response = await fixture.scan(body);
      expect(response.status, await response.clone().text()).toBe(200);
      const receipt = eventScanResponseSchema.parse(await response.json());
      expect(receipt).toMatchObject({
        operationId: body.operationId,
        attendanceRecorded: true,
        admissionRecorded: false,
        admissionDecision: null,
      });
      receipts.push(receipt);
    }
    for (const [index, body] of bodies.entries()) {
      const replay = await fixture.scan(body);
      expect(replay.status).toBe(200);
      expect(eventScanResponseSchema.parse(await replay.json())).toEqual(receipts[index]);
    }
    const whole = attendanceSummarySchema.parse(await (await read("/summary")).json());
    expect(whole.observed).toMatchObject({
      uniquePeople: 1,
      physicalPeople: 1,
      virtualPeople: 0,
      originalObservations: 3,
      effectiveObservations: 3,
      entryObservations: 2,
      reentryObservations: 1,
    });
    expect(whole.attempts).toMatchObject({ recognized: 3, attendance: 3, admissions: 0 });
    expect(whole.evidence).toMatchObject({ clockVerification: "unverified", presenceDuration: "not_established" });
    for (const [dayDate, occurrenceId, count, entries, repeats] of [
      ["2026-10-03", fixture.occurrenceId, 2, 1, 1],
      ["2026-10-04", secondOccurrenceId, 1, 1, 0],
    ] as const) {
      const summary = attendanceSummarySchema.parse(
        await (await read(`/summary?dayDate=${dayDate}&occurrenceId=${occurrenceId}`)).json(),
      );
      expect(summary.observed).toMatchObject({
        uniquePeople: 1,
        originalObservations: count,
        effectiveObservations: count,
        entryObservations: entries,
        reentryObservations: repeats,
      });
      const people = eventAttendancePeopleResponseSchema.parse(
        await (await read(`/people?dayDate=${dayDate}&occurrenceId=${occurrenceId}`)).json(),
      );
      expect(people.attendees).toHaveLength(1);
      expect(people.attendees[0]).toMatchObject({
        userId: fixture.userId,
        observationCount: count,
        physicalObservations: count,
        virtualObservations: 0,
      });
    }
    const wrongDay = attendanceSummarySchema.parse(
      await (await read(`/summary?dayDate=2026-10-03&occurrenceId=${secondOccurrenceId}`)).json(),
    );
    expect(wrongDay.observed).toMatchObject({ uniquePeople: 0, originalObservations: 0 });
    const report = attendanceReportSchema.parse(await (await read("")).json());
    expect(report.sessions).toHaveLength(2);
    for (const [occurrenceId, scans] of [
      [fixture.occurrenceId, 2],
      [secondOccurrenceId, 1],
    ] as const)
      expect(report.sessions.find((session) => session.occurrenceId === occurrenceId)).toMatchObject({
        title: "Repeated workshop",
        attendees: 1,
        physicalAttendees: 1,
        scans,
      });
    const evidence = attendanceEvidenceResponseSchema.parse(await (await read("/observations")).json());
    expect(evidence.observations).toHaveLength(3);
    for (const [observedAt, occurrenceId, dayDate] of [
      [firstAt, fixture.occurrenceId, "2026-10-03"],
      [repeatedAt, fixture.occurrenceId, "2026-10-03"],
      [secondAt, secondOccurrenceId, "2026-10-04"],
    ] as const)
      expect(evidence.observations.find((row) => row.observedAt === observedAt)).toMatchObject({
        userId: fixture.userId,
        occurrenceId,
        observedAt,
        operatorUserId: fixture.operatorId,
        deviceId: fixture.deviceId,
        deviceTimeVerified: false,
        source: "browser_scan",
        captureContext: { dayDate, timeZone: "Europe/Amsterdam", publicationRevision: 0, source: "published_manifest" },
      });
    for (const table of ["event_session_admissions", "agenda_session_participations", "agenda_session_holds"])
      expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).toEqual({ count: 0 });
  });
});
