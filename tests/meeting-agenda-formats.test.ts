import { administratorGrants, grantAdministrator } from "./helpers/administrator";
import { staffingFixture } from "./helpers/agenda-staffing";
import { ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { listMeetingFormats, getPublishedMeetingAgenda } from "../functions/_lib/services/event-series/agenda-catalog";
import { meetingFormatCatalogQuerySchema } from "../assets/shared/schemas/meeting-agenda";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAgendaOccurrence, saveAgendaStaffing } from "../functions/_lib/services/event-agenda/mutations";
import { agendaOccurrenceCreateSchema } from "../assets/shared/schemas/event-agenda";
import { env } from "cloudflare:workers";
import { beforeEach, describe, it, expect } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { insertUser } from "./helpers/membership";
import { configureMeetingOccurrence } from "./helpers/meeting-occurrence";
import {
  createGroupEventSeries,
  getSeriesOccurrence,
  updateSeriesOccurrence,
} from "../functions/_lib/services/event-series";
import {
  getMeetingAgenda,
  saveMeetingAgenda,
  publishMeetingAgenda,
} from "../functions/_lib/services/event-series/agenda";
import { meetingAgendaTimes } from "../assets/shared/schemas/meeting-agenda";
import type { AuthAdmin } from "../functions/_lib/types";
const GROUP = "20000000-0000-4000-8000-000000000003";
beforeEach(resetDb);
describe("versioned recurring meeting agendas", () => {
  it("preserves exceptions and approved agendas while updating future drafts and rejecting stale edits", async () => {
    const id = await insertUser(env.DB, `meeting-agenda-${crypto.randomUUID()}@example.test`);
    await grantAdministrator(env.DB, id);
    const actor: AuthAdmin = { identityType: "user", id, email: "synthetic@example.test", grants: administratorGrants };
    const start = new Date(Date.now() + 86400000).toISOString();
    const series = await createGroupEventSeries(env.DB, actor, GROUP, {
      eventName: "Format test",
      eventSlug: `format-${crypto.randomUUID()}`,
      profileKey: "meeting",
      policy: { registrationPolicy: "no_registration", memberEligibility: "owner_group", guestPolicy: "none" },
      startsAt: start,
      recurrenceRule: "FREQ=WEEKLY;COUNT=3",
      timezone: "Europe/Amsterdam",
      durationMinutes: 60,
    });
    const occurrences = [];
    for (let index = 0; index < 3; index++) {
      const startsAt = new Date(Date.parse(start) + index * 7 * 86400000).toISOString();
      occurrences.push(
        await configureMeetingOccurrence(
          env.DB,
          actor,
          GROUP,
          series.id,
          { startsAt, endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString() },
          "format-test-encryption-secret-00000000000000",
        ),
      );
    }
    const items = [
      { id: crypto.randomUUID(), title: "Opening", description: "", durationMinutes: 10, speakerUserIds: [id] },
      { id: crypto.randomUUID(), title: "Discussion", description: "", durationMinutes: 30, speakerUserIds: [] },
    ];
    const format = await saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
      expectedRevision: 0,
      expectedFormatVersion: 0,
      expectedWriteRevision: 0,
      scope: "template",
      fromOccurrenceId: null,
      name: "Working group format",
      items,
    });
    expect(format.formatVersion).toBe(1);
    const memberId = await insertUser(env.DB);
    await ensureGroupMembershipCapacity(env.DB, GROUP, memberId);
    const participant = { userId: memberId };
    const outsider = { userId: await insertUser(env.DB) };
    const catalogQuery = meetingFormatCatalogQuerySchema.parse({ limit: 1 });
    expect((await listMeetingFormats(env.DB, { userId: id, admin: actor }, GROUP, catalogQuery)).formats).toHaveLength(
      1,
    );
    expect((await listMeetingFormats(env.DB, participant, GROUP, catalogQuery)).formats).toEqual([]);
    expect((await listMeetingFormats(env.DB, outsider, GROUP, catalogQuery)).formats).toEqual([]);
    expect(
      (await getPublishedMeetingAgenda(env.DB, participant, GROUP, series.id, occurrences[0]!.id)).agenda,
    ).toBeNull();

    let one = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrences[0]!.id);
    expect(one.items).toEqual(items);
    const exceptionItems = [{ ...items[0]!, title: "Special opening" }, items[1]!];
    one = await saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
      expectedRevision: one.revision,
      expectedFormatVersion: one.formatVersion,
      expectedWriteRevision: one.writeRevision,
      scope: "occurrence",
      fromOccurrenceId: one.occurrenceId,
      name: "Exception",
      items: exceptionItems,
    });
    await publishMeetingAgenda(env.DB, actor, GROUP, series.id, one.occurrenceId!, one.revision);
    const published = (await getPublishedMeetingAgenda(env.DB, participant, GROUP, series.id, one.occurrenceId!))
      .agenda;
    expect(published?.items[0]?.title).toBe("Special opening");
    expect(published?.writeRevision).toBe(0);
    expect((await getPublishedMeetingAgenda(env.DB, outsider, GROUP, series.id, one.occurrenceId!)).agenda).toBeNull();
    await env.DB.prepare("UPDATE group_memberships SET left_at=datetime('now') WHERE user_id=?").bind(memberId).run();
    expect(
      (await getPublishedMeetingAgenda(env.DB, participant, GROUP, series.id, one.occurrenceId!)).agenda,
    ).toBeNull();

    const two = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrences[1]!.id);
    const updated = await saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
      expectedRevision: two.revision,
      expectedFormatVersion: two.formatVersion,
      expectedWriteRevision: two.writeRevision,
      scope: "future",
      fromOccurrenceId: two.occurrenceId,
      name: "Future draft",
      items: [{ ...items[0]!, title: "Updated opening" }, items[1]!],
    });
    expect(updated.items[0]!.title).toBe("Updated opening");
    expect((await getMeetingAgenda(env.DB, actor, GROUP, series.id, one.occurrenceId)).items[0]!.title).toBe(
      "Special opening",
    );
    expect((await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrences[2]!.id)).items[0]!.title).toBe(
      "Updated opening",
    );
    await expect(
      saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
        expectedRevision: two.revision,
        expectedFormatVersion: two.formatVersion,
        expectedWriteRevision: two.writeRevision,
        scope: "future",
        fromOccurrenceId: two.occurrenceId,
        name: "Stale",
        items,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const moving = (await getSeriesOccurrence(env.DB, GROUP, series.id, occurrences[2]!.id)).occurrence;
    const movedStart = new Date(Date.parse(moving.startsAt) + 86400000).toISOString();
    const moved = await updateSeriesOccurrence(
      env.DB,
      actor,
      GROUP,
      series.id,
      moving.id,
      {
        startsAt: movedStart,
        endsAt: new Date(Date.parse(movedStart) + 3600000).toISOString(),
        expectedUpdatedAt: moving.updatedAt,
      },
      "format-test-encryption-secret-00000000000000",
    );
    const interval = await env.DB.prepare(
      "SELECT start_at FROM meeting_agenda_speaker_intervals WHERE occurrence_id=? AND user_id=?",
    )
      .bind(moved.id, id)
      .first<{ start_at: string }>();
    expect(Date.parse(interval!.start_at)).toBe(Date.parse(movedStart));
    await updateSeriesOccurrence(
      env.DB,
      actor,
      GROUP,
      series.id,
      moved.id,
      { status: "cancelled", expectedUpdatedAt: moved.updatedAt },
      "format-test-encryption-secret-00000000000000",
    );
    expect(
      await env.DB.prepare("SELECT 1 FROM meeting_agenda_speaker_intervals WHERE occurrence_id=?")
        .bind(moved.id)
        .first(),
    ).toBeNull();
    const times = meetingAgendaTimes("2026-10-25T00:30:00.000Z", items);
    expect(times[1]!.startAt).toBe("2026-10-25T00:40:00.000Z");
  });
  it("rejects meeting speakers against conference sessions and room duties without leaking another event", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const actor: AuthAdmin = {
      identityType: "user",
      id: admin!.id,
      email: "admin@pkic.org",
      grants: administratorGrants,
    };
    const start = "2026-12-01T09:00:00.000Z",
      end = "2026-12-01T10:00:00.000Z";
    const series = await createGroupEventSeries(env.DB, actor, GROUP, {
      eventName: "Private meeting",
      eventSlug: `private-format-${crypto.randomUUID()}`,
      profileKey: "meeting",
      policy: { registrationPolicy: "no_registration", memberEligibility: "owner_group", guestPolicy: "none" },
      startsAt: start,
      recurrenceRule: "FREQ=WEEKLY;COUNT=1",
      timezone: "UTC",
      durationMinutes: 60,
    });
    const occurrence = await configureMeetingOccurrence(
      env.DB,
      actor,
      GROUP,
      series.id,
      { startsAt: start, endsAt: end },
      "format-test-encryption-secret-00000000000000",
    );
    const agenda = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrence.id);
    const items = [
      {
        id: crypto.randomUUID(),
        title: "Private discussion",
        description: "",
        durationMinutes: 30,
        speakerUserIds: [admin!.id],
      },
    ];
    await saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
      expectedRevision: agenda.revision,
      expectedFormatVersion: agenda.formatVersion,
      expectedWriteRevision: agenda.writeRevision,
      scope: "occurrence",
      fromOccurrenceId: occurrence.id,
      name: "Private agenda",
      items,
    });
    await expect(
      createAgendaOccurrence(
        env.DB,
        eventId,
        "pqc-2026",
        agendaOccurrenceCreateSchema.parse({
          expectedRevision: 0,
          title: "Conference talk",
          startAt: start,
          endAt: end,
          roomId: null,
          speakerUserIds: [admin!.id],
        }),
      ),
    ).rejects.toMatchObject({ status: 409, code: "AGENDA_SCHEDULE_CONFLICT" });
    await expect(
      saveAgendaStaffing(
        env.DB,
        eventId,
        "pqc-2026",
        staffingFixture({
          expectedRevision: 0,
          shifts: [{ id: "mc-block", name: "Room host", startAt: start, endAt: end, roomId: null, roles: ["mc"] }],
          roleMembers: [
            {
              userId: admin!.id,
              displayName: "Operator",
              roles: ["mc"],
              availableFrom: null,
              availableUntil: null,
              maxMinutes: null,
            },
          ],
          assignments: [{ shiftId: "mc-block", role: "mc", userId: admin!.id, pinned: true }],
        }),
      ),
    ).rejects.toMatchObject({ status: 409, code: "AGENDA_SCHEDULE_CONFLICT" });
    expect(
      await env.DB.prepare("SELECT 1 FROM event_agenda_occurrences WHERE event_id=?").bind(eventId).first(),
    ).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM event_agenda_shifts WHERE event_id=?").bind(eventId).first()).toBeNull();
    await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Following conference session",
        startAt: "2026-12-01T09:30:00.000Z",
        endAt: end,
        roomId: null,
        speakerUserIds: [admin!.id],
      }),
    );
    const current = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrence.id);
    await expect(
      saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
        expectedRevision: current.revision,
        expectedFormatVersion: current.formatVersion,
        expectedWriteRevision: current.writeRevision,
        scope: "occurrence",
        fromOccurrenceId: occurrence.id,
        name: "Conflicting extension",
        items: [{ ...items[0]!, durationMinutes: 60 }],
      }),
    ).rejects.toMatchObject({ status: 409, code: "AGENDA_SCHEDULE_CONFLICT" });
    const preserved = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrence.id);
    expect(preserved.revision).toBe(current.revision);
    expect(preserved.items[0]!.durationMinutes).toBe(30);
  });
});
