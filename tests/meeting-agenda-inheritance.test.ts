import { administratorGrants } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { configureMeetingOccurrence } from "./helpers/meeting-occurrence";
import type { AuthAdmin } from "../functions/_lib/types";
import {
  createGroupEventSeries,
  createSeriesOccurrence,
  materializeSeriesOccurrences,
  updateSeriesOccurrence,
  getSeriesOccurrence,
} from "../functions/_lib/services/event-series";
import { getMeetingAgenda, saveMeetingAgenda } from "../functions/_lib/services/event-series/agenda";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { agendaOccurrenceCreateSchema } from "../assets/shared/schemas/event-agenda";
const GROUP = "20000000-0000-4000-8000-000000000003";
const START = "2099-12-01T09:00:00.000Z";
const NEXT = "2100-01-05T09:00:00.000Z";
beforeEach(resetDb);
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
  const actor: AuthAdmin = {
    identityType: "user",
    id: user!.id,
    email: "admin@pkic.org",
    grants: administratorGrants,
  };
  const series = await createGroupEventSeries(env.DB, actor, GROUP, {
    eventName: "Inherited agenda",
    eventSlug: `inherited-${crypto.randomUUID()}`,
    profileKey: "meeting",
    policy: { registrationPolicy: "no_registration", memberEligibility: "owner_group", guestPolicy: "none" },
    startsAt: START,
    recurrenceRule: "FREQ=WEEKLY",
    timezone: "UTC",
    durationMinutes: 60,
  });
  const occurrence = await configureMeetingOccurrence(
    env.DB,
    actor,
    GROUP,
    series.id,
    { startsAt: START, endsAt: "2099-12-01T10:00:00.000Z" },
    "",
  );
  const items = [
    { id: crypto.randomUUID(), title: "Discussion", description: "", durationMinutes: 30, speakerUserIds: [actor.id] },
  ];
  return { actor, series, occurrence, items, eventId };
}
describe("recurring meeting agenda inheritance", () => {
  it.each(["template", "future"] as const)(
    "atomically rejects %s propagation into a shorter affected occurrence",
    async (scope) => {
      const { actor, series, occurrence, items } = await fixture();
      const shorter = await createSeriesOccurrence(
        env.DB,
        actor,
        GROUP,
        series.id,
        { startsAt: NEXT, endsAt: "2100-01-05T09:15:00.000Z" },
        "",
      );
      const before = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrence.id);
      await expect(
        saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
          expectedRevision: before.revision,
          expectedFormatVersion: before.formatVersion,
          expectedWriteRevision: before.writeRevision,
          scope,
          fromOccurrenceId: scope === "template" ? null : occurrence.id,
          name: "Too long for later meeting",
          items,
        }),
      ).rejects.toMatchObject({ status: 422, code: "MEETING_AGENDA_DURATION_EXCEEDED" });
      expect(await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrence.id)).toEqual(before);
      expect((await getMeetingAgenda(env.DB, actor, GROUP, series.id, shorter.id)).items).toEqual([]);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM event_meeting_agenda_formats WHERE series_id=?")
          .bind(series.id)
          .first(),
      ).toEqual({ count: 0 });
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM event_meeting_occurrence_agendas WHERE series_id=?")
          .bind(series.id)
          .first(),
      ).toEqual({ count: 0 });
    },
  );
  it.each(["create", "materialize"] as const)(
    "indexes inherited speaker commitments when occurrences %s",
    async (method) => {
      const { actor, series, occurrence, items, eventId } = await fixture();
      const before = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrence.id);
      await saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
        expectedRevision: 0,
        expectedFormatVersion: 0,
        expectedWriteRevision: before.writeRevision,
        scope: "template",
        fromOccurrenceId: null,
        name: "Reusable speaker format",
        items,
      });
      if (method === "create")
        await createSeriesOccurrence(
          env.DB,
          actor,
          GROUP,
          series.id,
          { startsAt: NEXT, endsAt: "2100-01-05T10:00:00.000Z" },
          "",
        );
      else await materializeSeriesOccurrences(env.DB, actor, GROUP, series.id, { through: NEXT, maxOccurrences: 6 });
      const later = await env.DB.prepare("SELECT id FROM event_occurrences WHERE series_id=? AND starts_at=?")
        .bind(series.id, NEXT)
        .first<{ id: string }>();
      expect(later).not.toBeNull();
      expect((await getMeetingAgenda(env.DB, actor, GROUP, series.id, later!.id)).items).toEqual(items);
      expect(
        await env.DB.prepare("SELECT 1 FROM event_meeting_occurrence_agendas WHERE occurrence_id=?")
          .bind(later!.id)
          .first(),
      ).not.toBeNull();
      expect(
        await env.DB.prepare(
          "SELECT user_id,start_at,end_at FROM meeting_agenda_speaker_intervals WHERE occurrence_id=?",
        )
          .bind(later!.id)
          .first(),
      ).toEqual({ user_id: actor.id, start_at: NEXT, end_at: "2100-01-05T09:30:00.000Z" });
      await expect(
        createAgendaOccurrence(
          env.DB,
          eventId,
          "pqc-2026",
          agendaOccurrenceCreateSchema.parse({
            expectedRevision: 0,
            title: "Conflicting conference talk",
            startAt: NEXT,
            endAt: "2100-01-05T09:20:00.000Z",
            roomId: null,
            speakerUserIds: [actor.id],
          }),
        ),
      ).rejects.toMatchObject({ status: 409, code: "AGENDA_SCHEDULE_CONFLICT" });
      expect(
        await env.DB.prepare("SELECT 1 FROM event_agenda_occurrences WHERE event_id=?").bind(eventId).first(),
      ).toBeNull();
    },
  );
  it.each(["create", "shorten"] as const)(
    "atomically rejects %s of an occurrence too short for its inherited format",
    async (method) => {
      const { actor, series, occurrence, items } = await fixture();
      const before = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrence.id);
      await saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
        expectedRevision: before.revision,
        expectedFormatVersion: before.formatVersion,
        expectedWriteRevision: before.writeRevision,
        scope: "template",
        fromOccurrenceId: null,
        name: "Thirty minute format",
        items,
      });
      const { occurrence: original } = await getSeriesOccurrence(env.DB, GROUP, series.id, occurrence.id);
      const operation =
        method === "create"
          ? createSeriesOccurrence(
              env.DB,
              actor,
              GROUP,
              series.id,
              { startsAt: NEXT, endsAt: "2100-01-05T09:15:00.000Z" },
              "",
            )
          : updateSeriesOccurrence(
              env.DB,
              actor,
              GROUP,
              series.id,
              occurrence.id,
              { expectedUpdatedAt: original.updatedAt, endsAt: "2099-12-01T09:15:00.000Z" },
              "",
            );
      await expect(operation).rejects.toMatchObject({ status: 422, code: "MEETING_AGENDA_DURATION_EXCEEDED" });
      expect((await getSeriesOccurrence(env.DB, GROUP, series.id, occurrence.id)).occurrence).toEqual(original);
      expect(
        await env.DB.prepare("SELECT 1 FROM event_occurrences WHERE series_id=? AND starts_at=?")
          .bind(series.id, NEXT)
          .first(),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT end_at FROM meeting_agenda_speaker_intervals WHERE occurrence_id=?")
          .bind(occurrence.id)
          .first(),
      ).toEqual({ end_at: "2099-12-01T09:30:00.000Z" });
    },
  );
  it("keeps an unrelated legacy short occurrence from blocking valid occurrence management", async () => {
    const { actor, series, occurrence, items } = await fixture();
    const before = await getMeetingAgenda(env.DB, actor, GROUP, series.id, occurrence.id);
    await saveMeetingAgenda(env.DB, actor, GROUP, series.id, {
      expectedRevision: before.revision,
      expectedFormatVersion: before.formatVersion,
      expectedWriteRevision: before.writeRevision,
      scope: "template",
      fromOccurrenceId: null,
      name: "Thirty minute format",
      items,
    });
    // Reproduce a previously permitted shorter occurrence without using the fixed command.
    await env.DB.prepare(
      "UPDATE event_occurrences SET ends_at='2099-12-08T09:15:00.000Z' WHERE series_id=? AND starts_at='2099-12-08T09:00:00.000Z'",
    )
      .bind(series.id)
      .run();
    const created = await createSeriesOccurrence(
      env.DB,
      actor,
      GROUP,
      series.id,
      { startsAt: NEXT, endsAt: "2100-01-05T10:00:00.000Z" },
      "",
    );
    expect(created.startsAt).toBe(NEXT);
    const { occurrence: original } = await getSeriesOccurrence(env.DB, GROUP, series.id, occurrence.id);
    const updated = await updateSeriesOccurrence(
      env.DB,
      actor,
      GROUP,
      series.id,
      occurrence.id,
      { expectedUpdatedAt: original.updatedAt, locationOverride: "Updated meeting room" },
      "",
    );
    expect(updated.location).toBe("Updated meeting room");
  });
});
