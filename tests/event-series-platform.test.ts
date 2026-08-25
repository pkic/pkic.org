import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createGroupEventSeries,
  createSeriesOccurrence,
  generateGroupSeriesIcs,
  getGroupEventSeries,
  materializeSeriesOccurrences,
  updateGroupEventSeries,
  updateSeriesOccurrence,
} from "../functions/_lib/services/event-series";
import { eventOccurrenceUpdateSchema } from "../assets/shared/schemas/event-series";
import { joinGroup } from "../functions/_lib/services/groups";
import type { AuthAdmin } from "../functions/_lib/types";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const ENCRYPTION_SECRET = "test-meeting-encryption-secret-0000000000000000";
const GROUP_ID = "20000000-0000-4000-8000-000000000003";

async function insertAdmin(): Promise<AuthAdmin> {
  const id = await insertUser(env.DB, `meeting-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email: "meeting-admin@example.test", role: "admin" };
}

async function addGroupMember(): Promise<string> {
  const userId = await insertUser(env.DB, `meeting-member-${crypto.randomUUID()}@example.test`);
  const organizationId = await insertOrganization(env.DB, `Meeting Organization ${crypto.randomUUID()}`);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  await addRepresentative(env.DB, memberId, userId);
  await joinGroup(env.DB, GROUP_ID, {
    actorUserId: userId,
    targetUserId: userId,
    selection: { mode: "all_eligible", confirmed: true },
    source: "self_service",
    allowManaged: false,
  });
  return userId;
}

async function createMeetingFixture() {
  const admin = await insertAdmin();
  const userId = await addGroupMember();
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const series = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
    eventName: "Architecture Working Session",
    eventSlug: `architecture-working-session-${crypto.randomUUID()}`,
    profileKey: "meeting",
    policy: {
      registrationPolicy: "no_registration",
      memberEligibility: "owner_group",
      guestPolicy: "occurrence_invitation",
    },
    startsAt,
    recurrenceRule: "FREQ=WEEKLY;BYDAY=TU",
    timezone: "Europe/Amsterdam",
    durationMinutes: 60,
    location: "Online",
    providerType: "external_url",
  });
  const endsAt = new Date(Date.now() + 7_200_000).toISOString();
  const occurrence = await createSeriesOccurrence(
    env.DB,
    admin,
    GROUP_ID,
    series.id,
    { startsAt, endsAt, providerJoinUrl: "https://meet.example.test/secret-room" },
    ENCRYPTION_SECRET,
  );
  return { admin, userId, series, occurrence };
}

beforeEach(async () => {
  await resetDb();
});

describe("group-owned event series", () => {
  it("rolls back creation when group-management authority changes during the D1 batch", async () => {
    const admin = await insertAdmin();
    const eventSlug = `authorization-race-${crypto.randomUUID()}`;
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(admin.id).run(),
    );
    await expect(
      createGroupEventSeries(racingDb, admin, GROUP_ID, {
        eventName: "Authorization race meeting",
        eventSlug,
        profileKey: "meeting",
        policy: {
          registrationPolicy: "no_registration",
          memberEligibility: "owner_group",
          guestPolicy: "occurrence_invitation",
        },
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        recurrenceRule: "FREQ=WEEKLY;COUNT=2",
        timezone: "UTC",
        durationMinutes: 60,
        providerType: null,
      }),
    ).rejects.toMatchObject({ code: "EVENT_SERIES_AUTHORIZATION_CHANGED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM events WHERE slug = ?").bind(eventSlug).first("total"),
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'event_series_created'").first(
        "total",
      ),
    ).toBe(0);
  });

  it("materializes recurring local time across DST idempotently", async () => {
    const admin = await insertAdmin();
    const series = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
      eventName: "DST Working Session",
      eventSlug: `dst-working-session-${crypto.randomUUID()}`,
      profileKey: "meeting",
      policy: {
        registrationPolicy: "no_registration",
        memberEligibility: "owner_group",
        guestPolicy: "occurrence_invitation",
      },
      startsAt: "2026-03-24T08:00:00.000Z",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=TU",
      timezone: "Europe/Amsterdam",
      durationMinutes: 60,
      location: "Online",
      providerType: null,
    });
    const first = await materializeSeriesOccurrences(env.DB, admin, GROUP_ID, series.id, {
      through: "2026-04-07T07:00:00.000Z",
      maxOccurrences: 10,
    });
    expect(first).toMatchObject({ created: 3, existing: 0 });
    const starts = await queryAll<{ starts_at: string }>(
      env.DB,
      "SELECT starts_at FROM event_occurrences WHERE series_id = ? ORDER BY starts_at",
      [series.id],
    );
    expect(starts.map((row) => row.starts_at)).toEqual([
      "2026-03-24T08:00:00.000Z",
      "2026-03-31T07:00:00.000Z",
      "2026-04-07T07:00:00.000Z",
    ]);
    const second = await materializeSeriesOccurrences(env.DB, admin, GROUP_ID, series.id, {
      through: "2026-04-07T07:00:00.000Z",
      maxOccurrences: 10,
    });
    expect(second).toMatchObject({ created: 0, existing: 3 });
    await expect(
      materializeSeriesOccurrences(env.DB, admin, GROUP_ID, series.id, {
        through: "2026-05-05T07:00:00.000Z",
        maxOccurrences: 2,
      }),
    ).rejects.toMatchObject({ code: "EVENT_RECURRENCE_LIMIT_EXCEEDED" });
    await expect(
      updateGroupEventSeries(env.DB, admin, GROUP_ID, series.id, {
        recurrenceRule: "FREQ=WEEKLY;BYDAY=WE",
        expectedUpdatedAt: (await getGroupEventSeries(env.DB, GROUP_ID, series.id)).updatedAt,
      }),
    ).rejects.toMatchObject({ code: "EVENT_SERIES_SCHEDULE_MATERIALIZED" });
  });

  it("stores provider destinations encrypted and generates ICS from occurrence state", async () => {
    const { admin, series, occurrence } = await createMeetingFixture();
    const stored = await queryAll<{ provider_join_url_ciphertext: string }>(
      env.DB,
      "SELECT provider_join_url_ciphertext FROM event_occurrences WHERE id = ?",
      [occurrence.id],
    );
    expect(stored[0].provider_join_url_ciphertext).toMatch(/^v1\./);
    expect(stored[0].provider_join_url_ciphertext).not.toContain("meet.example.test");

    const calendar = await generateGroupSeriesIcs(
      env.DB,
      { userId: admin.id, admin },
      { id: GROUP_ID, slug: "architecture-working-group" },
      series.id,
      "https://pkic.example.test",
    );
    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).toContain(`UID:${occurrence.id}@pkic.org`);
    expect(calendar.replace(/\r\n /g, "")).toContain(
      `URL:https://pkic.example.test/meetings/join/?occurrence=${occurrence.id}`,
    );
    expect(calendar).not.toContain("secret-room");
  });

  it("accepts only HTTPS provider destinations and never copies them into audit details", async () => {
    const expectedUpdatedAt = new Date().toISOString();
    expect(
      eventOccurrenceUpdateSchema.safeParse({ providerJoinUrl: "javascript:alert(1)", expectedUpdatedAt }).success,
    ).toBe(false);
    expect(
      eventOccurrenceUpdateSchema.safeParse({ providerJoinUrl: "data:text/html,unsafe", expectedUpdatedAt }).success,
    ).toBe(false);
    expect(
      eventOccurrenceUpdateSchema.safeParse({ providerJoinUrl: "http://meet.example.test/room", expectedUpdatedAt })
        .success,
    ).toBe(false);
    expect(
      eventOccurrenceUpdateSchema.safeParse({ providerJoinUrl: "https://meet.example.test/room", expectedUpdatedAt })
        .success,
    ).toBe(true);

    const { admin, series, occurrence } = await createMeetingFixture();
    const originalCiphertext = await env.DB.prepare(
      "SELECT provider_join_url_ciphertext FROM event_occurrences WHERE id = ?",
    )
      .bind(occurrence.id)
      .first<string>("provider_join_url_ciphertext");
    await expect(
      updateSeriesOccurrence(
        env.DB,
        admin,
        GROUP_ID,
        series.id,
        occurrence.id,
        { providerJoinUrl: "http://meet.example.test/unsafe-room", expectedUpdatedAt: occurrence.updatedAt },
        ENCRYPTION_SECRET,
      ),
    ).rejects.toThrow();
    expect(
      await env.DB.prepare("SELECT provider_join_url_ciphertext FROM event_occurrences WHERE id = ?")
        .bind(occurrence.id)
        .first<string>("provider_join_url_ciphertext"),
    ).toBe(originalCiphertext);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'event_occurrence_updated' AND entity_id = ?",
      )
        .bind(occurrence.id)
        .first<number>("total"),
    ).toBe(0);

    const replacementUrl = "https://meet.example.test/rotated-secret-room";
    await updateSeriesOccurrence(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        locationOverride: "Updated room",
        providerJoinUrl: replacementUrl,
        expectedUpdatedAt: occurrence.updatedAt,
      },
      ENCRYPTION_SECRET,
    );
    const audit = await env.DB.prepare(
      `SELECT details_json FROM audit_log
        WHERE action = 'event_occurrence_updated' AND entity_id = ?
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
      .bind(occurrence.id)
      .first<{ details_json: string }>();
    expect(audit).not.toBeNull();
    expect(audit?.details_json).not.toContain(replacementUrl);
    expect(JSON.parse(audit?.details_json ?? "{}")).toEqual({
      locationOverride: { from: null, to: "Updated room" },
      providerJoinUrlChanged: { from: null, to: true },
      providerConfigured: { from: null, to: true },
    });
  });

  it("adds, rotates, and removes an occurrence provider without exposing its destination", async () => {
    const admin = await insertAdmin();
    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const series = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
      eventName: "Provider lifecycle meeting",
      eventSlug: `provider-lifecycle-${crypto.randomUUID()}`,
      profileKey: "meeting",
      policy: {
        registrationPolicy: "no_registration",
        memberEligibility: "owner_group",
        guestPolicy: "occurrence_invitation",
      },
      startsAt,
      recurrenceRule: "FREQ=WEEKLY;COUNT=2",
      timezone: "UTC",
      durationMinutes: 60,
      providerType: "external_url",
    });
    const occurrence = await createSeriesOccurrence(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      { startsAt, endsAt: new Date(Date.now() + 7_200_000).toISOString() },
      ENCRYPTION_SECRET,
    );
    expect(occurrence.providerConfigured).toBe(false);

    const added = await updateSeriesOccurrence(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      { providerJoinUrl: "https://meet.example.test/new-room", expectedUpdatedAt: occurrence.updatedAt },
      ENCRYPTION_SECRET,
    );
    expect(added.providerConfigured).toBe(true);
    const ciphertext = await env.DB.prepare("SELECT provider_join_url_ciphertext FROM event_occurrences WHERE id = ?")
      .bind(occurrence.id)
      .first<string>("provider_join_url_ciphertext");
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain("new-room");

    const removed = await updateSeriesOccurrence(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      { providerJoinUrl: null, expectedUpdatedAt: added.updatedAt },
      ENCRYPTION_SECRET,
    );
    expect(removed.providerConfigured).toBe(false);
    expect(
      await env.DB.prepare("SELECT provider_join_url_ciphertext FROM event_occurrences WHERE id = ?")
        .bind(occurrence.id)
        .first("provider_join_url_ciphertext"),
    ).toBeNull();
  });

  it("rolls back stale series and occurrence updates instead of partially changing event state", async () => {
    const { admin, series, occurrence } = await createMeetingFixture();
    const staleSeriesDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_series SET updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?")
        .bind(series.id)
        .run(),
    );
    await expect(
      updateGroupEventSeries(staleSeriesDb, admin, GROUP_ID, series.id, {
        eventName: "This stale name must roll back",
        expectedUpdatedAt: series.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "EVENT_SERIES_CHANGED" });
    expect(await env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(series.eventId).first("name")).toBe(
      series.eventName,
    );
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'event_series_updated' AND entity_id = ?",
      )
        .bind(series.id)
        .first("total"),
    ).toBe(0);

    const staleOccurrenceDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_occurrences SET updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?")
        .bind(occurrence.id)
        .run(),
    );
    await expect(
      updateSeriesOccurrence(
        staleOccurrenceDb,
        admin,
        GROUP_ID,
        series.id,
        occurrence.id,
        { locationOverride: "This stale location must roll back", expectedUpdatedAt: occurrence.updatedAt },
        ENCRYPTION_SECRET,
      ),
    ).rejects.toMatchObject({ code: "EVENT_OCCURRENCE_CHANGED" });
    expect(
      await env.DB.prepare("SELECT location_override FROM event_occurrences WHERE id = ?")
        .bind(occurrence.id)
        .first("location_override"),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'event_occurrence_updated' AND entity_id = ?",
      )
        .bind(occurrence.id)
        .first("total"),
    ).toBe(0);
  });

  it("treats event and recurrence rows as one concurrency-protected series aggregate", async () => {
    const { admin, series } = await createMeetingFixture();
    const concurrentSettings = JSON.stringify({
      memberEligibility: "owner_group",
      guestPolicy: "none",
      concurrentMarker: "preserve",
    });
    await env.DB.prepare("UPDATE events SET settings_json = ?, updated_at = ? WHERE id = ?")
      .bind(concurrentSettings, "2099-01-01T00:00:00.000Z", series.eventId)
      .run();

    await expect(
      updateGroupEventSeries(env.DB, admin, GROUP_ID, series.id, {
        eventName: "Stale aggregate update",
        expectedUpdatedAt: series.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "EVENT_SERIES_CHANGED" });
    expect(
      await env.DB.prepare("SELECT name, settings_json FROM events WHERE id = ?").bind(series.eventId).first(),
    ).toEqual({ name: series.eventName, settings_json: concurrentSettings });
  });
});
