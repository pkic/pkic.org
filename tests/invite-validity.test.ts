import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  activeEffectiveInviteExpirySql,
  effectiveInviteExpirySql,
  effectiveStoredInviteExpiry,
  prepareExpireEffectiveEventInvites,
  resolveEventInviteExpiry,
} from "../functions/_lib/invite-validity";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createInvite } from "../functions/_lib/services/invite-creation";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import {
  createGroupEventSeries,
  createSeriesOccurrence,
  inviteOccurrenceGuest,
  listOccurrenceGuests,
} from "../functions/_lib/services/event-series";
import { insertUser } from "./helpers/membership";
import type { AuthAdmin } from "../functions/_lib/types";

const EVENT = {
  starts_at: "2027-03-10T09:00:00.000Z",
  ends_at: "2027-03-10T17:00:00.000Z",
};
const NOW = "2027-03-01T12:00:00.000Z";
const GROUP_ID = "20000000-0000-4000-8000-000000000003";

async function seedMeetingWindow() {
  const adminId = await insertUser(env.DB, `meeting-validity-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();
  const admin: AuthAdmin = {
    identityType: "user",
    id: adminId,
    email: "meeting-validity@example.test",
    role: "admin",
  };
  const startsAt = "2099-04-01T09:00:00.000Z";
  const endsAt = "2099-04-01T10:00:00.000Z";
  const series = await createGroupEventSeries(env.DB, admin, GROUP_ID, {
    eventName: "Guest validity meeting",
    eventSlug: `guest-validity-${crypto.randomUUID()}`,
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
    providerType: null,
  });
  const occurrence = await createSeriesOccurrence(
    env.DB,
    admin,
    GROUP_ID,
    series.id,
    { startsAt, endsAt },
    "meeting-validity-encryption-secret-0000000000000",
  );
  return { admin, series, occurrence };
}

describe("event invitation validity", () => {
  it("defaults to the event start and preserves an earlier explicit deadline", () => {
    expect(resolveEventInviteExpiry(EVENT, undefined, NOW)).toBe(EVENT.starts_at);
    expect(resolveEventInviteExpiry(EVENT, "2027-03-09T12:00:00.000Z", NOW)).toBe("2027-03-09T12:00:00.000Z");
  });

  it("allows the exact event end but rejects any later deadline", () => {
    expect(resolveEventInviteExpiry(EVENT, EVENT.ends_at, NOW)).toBe(EVENT.ends_at);
    expect(() => resolveEventInviteExpiry(EVENT, "2027-03-10T17:00:00.001Z", NOW)).toThrow(
      expect.objectContaining({ code: "INVITE_EXPIRY_AFTER_EVENT" }),
    );
  });

  it("rejects past, malformed, missing, and inverted windows", () => {
    expect(() => resolveEventInviteExpiry(EVENT, NOW, NOW)).toThrow(
      expect.objectContaining({ code: "INVITE_EXPIRY_PAST" }),
    );
    expect(() => resolveEventInviteExpiry(EVENT, "not-a-date", NOW)).toThrow(
      expect.objectContaining({ code: "INVITE_EXPIRY_INVALID" }),
    );
    expect(() => resolveEventInviteExpiry({ starts_at: null, ends_at: EVENT.ends_at }, undefined, NOW)).toThrow(
      expect.objectContaining({ code: "EVENT_INVITE_WINDOW_REQUIRED" }),
    );
    expect(() =>
      resolveEventInviteExpiry({ starts_at: EVENT.ends_at, ends_at: EVENT.starts_at }, undefined, NOW),
    ).toThrow(expect.objectContaining({ code: "EVENT_INVITE_WINDOW_REQUIRED" }));
  });

  it("applies the same default and maximum to stored legacy values", () => {
    expect(effectiveStoredInviteExpiry(EVENT, null)).toBe(EVENT.starts_at);
    expect(effectiveStoredInviteExpiry(EVENT, "2027-03-09T12:00:00.000Z")).toBe("2027-03-09T12:00:00.000Z");
    expect(effectiveStoredInviteExpiry(EVENT, "2027-03-11T12:00:00.000Z")).toBe(EVENT.ends_at);
    expect(effectiveStoredInviteExpiry({ starts_at: EVENT.starts_at, ends_at: null }, EVENT.starts_at)).toBeNull();
  });
});

describe("stored event invitation validity in D1", () => {
  beforeEach(resetDb);

  it("projects NULL to event start, caps overlong rows at event end, and preserves an earlier deadline", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const values = [
      { id: crypto.randomUUID(), email: "default-expiry@example.test", expiresAt: null },
      { id: crypto.randomUUID(), email: "early-expiry@example.test", expiresAt: "2026-11-01T08:00:00.000Z" },
      { id: crypto.randomUUID(), email: "overlong-expiry@example.test", expiresAt: "2027-01-01T08:00:00.000Z" },
    ];
    await env.DB.batch(
      values.map((value) =>
        env.DB.prepare(
          `INSERT INTO invites
               (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
             VALUES (?, ?, ?, 'attendee', ?, 'sent', 'test', ?, '2026-08-27T00:00:00.000Z')`,
        ).bind(value.id, eventId, value.email, crypto.randomUUID(), value.expiresAt),
      ),
    );

    const rows = await queryAll<{ invitee_email: string; effective_expiry: string }>(
      env.DB,
      `SELECT i.invitee_email, ${effectiveInviteExpirySql("i", "e")} AS effective_expiry
       FROM invites i JOIN events e ON e.id = i.event_id
       WHERE i.id IN (SELECT value FROM json_each(?))
       ORDER BY i.invitee_email`,
      [JSON.stringify(values.map((value) => value.id))],
    );

    expect(rows).toEqual([
      { invitee_email: "default-expiry@example.test", effective_expiry: "2026-12-01T08:00:00.000Z" },
      { invitee_email: "early-expiry@example.test", effective_expiry: "2026-11-01T08:00:00.000Z" },
      { invitee_email: "overlong-expiry@example.test", effective_expiry: "2026-12-03T18:00:00.000Z" },
    ]);
  });

  it("does not insert an invitation after a concurrent event schedule change", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const racingDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE events SET ends_at = starts_at WHERE id = ?").bind(eventId).run();
    });

    await expect(
      createInvite(racingDb, {
        eventId,
        inviteeEmail: "direct-schedule-race@example.test",
        inviteType: "attendee",
      }),
    ).rejects.toMatchObject({ code: "EVENT_INVITE_WINDOW_CHANGED", status: 409 });
    await expect(
      queryAll(env.DB, "SELECT id FROM invites WHERE invitee_email = 'direct-schedule-race@example.test'"),
    ).resolves.toHaveLength(0);
  });

  it("retires legacy NULL and shortened-event deadlines using the event-derived deadline", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const inviteIds = [crypto.randomUUID(), crypto.randomUUID()];
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO invites
             (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
           VALUES (?, ?, 'derived-null-expiry@example.test', 'attendee', ?, 'sent', 'test', NULL, ?)`,
      ).bind(inviteIds[0], eventId, crypto.randomUUID(), "2026-01-01T00:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO invites
             (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
           VALUES (?, ?, 'derived-capped-expiry@example.test', 'attendee', ?, 'sent', 'test', '2026-04-01T00:00:00.000Z', ?)`,
      ).bind(inviteIds[1], eventId, crypto.randomUUID(), "2026-01-01T00:00:00.000Z"),
    ]);
    await env.DB.prepare("UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?")
      .bind("2026-02-01T08:00:00.000Z", "2026-02-01T18:00:00.000Z", eventId)
      .run();

    await env.DB.batch([
      prepareExpireEffectiveEventInvites(env.DB, {
        eventId,
        inviteType: "attendee",
        now: "2026-03-01T00:00:00.000Z",
      }),
    ]);

    await expect(
      queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM invites WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id",
        [JSON.stringify(inviteIds.sort())],
      ),
    ).resolves.toEqual([{ status: "expired" }, { status: "expired" }]);
  });

  it("fails closed for unparseable stored timestamps and retires the unusable invite", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const inviteId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO invites
         (id, event_id, invitee_email, invite_type, link_secret, status, source_type, expires_at, created_at)
       VALUES (?, ?, 'malformed-expiry@example.test', 'attendee', ?, 'sent', 'test', 'not-a-date', ?)`,
    )
      .bind(inviteId, eventId, crypto.randomUUID(), "2026-01-01T00:00:00.000Z")
      .run();

    await expect(
      queryAll<{ effective_expiry: string | null }>(
        env.DB,
        `SELECT ${effectiveInviteExpirySql("i", "e")} AS effective_expiry
           FROM invites i JOIN events e ON e.id = i.event_id
          WHERE i.id = ?`,
        [inviteId],
      ),
    ).resolves.toEqual([{ effective_expiry: null }]);

    await env.DB.batch([
      prepareExpireEffectiveEventInvites(env.DB, {
        eventId,
        inviteType: "attendee",
        now: "2026-01-02T00:00:00.000Z",
      }),
    ]);
    await expect(queryAll(env.DB, "SELECT status FROM invites WHERE id = ?", [inviteId])).resolves.toEqual([
      { status: "expired" },
    ]);
  });

  it("uses the bounded event/status index and direct UTC comparisons for active invitations", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const effectiveExpiry = effectiveInviteExpirySql("i", "e");
    const activePredicate = activeEffectiveInviteExpirySql(effectiveExpiry);
    expect(activePredicate).not.toContain("unixepoch");

    const plan = await queryAll<{ detail: string }>(
      env.DB,
      `EXPLAIN QUERY PLAN
       SELECT i.id
         FROM invites i
         JOIN events e ON e.id = i.event_id
        WHERE i.event_id = ?
          AND i.status = 'sent'
          AND i.invite_type = 'attendee'
          AND ${activePredicate}`,
      [eventId, "2026-01-01T00:00:00.000Z"],
    );
    expect(plan.map((row) => row.detail).join("\n")).toContain("idx_invites_event_status");
  });
});

describe("meeting guest invitation validity in D1", () => {
  beforeEach(resetDb);

  it("defaults at issue time and caps occurrence and series-wide validity under the live meeting window", async () => {
    const { admin, series, occurrence } = await seedMeetingWindow();
    const occurrenceDefault = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      { email: `default-window-${crypto.randomUUID()}@example.test`, name: "Default Window Guest" },
      "https://app.test",
    );
    expect(occurrenceDefault.guest.expiresAt).toBe(occurrence.startsAt);
    expect(occurrenceDefault.guest.active).toBe(true);

    const seriesDefault = await inviteOccurrenceGuest(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      {
        email: `series-window-${crypto.randomUUID()}@example.test`,
        name: "Series Window Guest",
        seriesWide: true,
      },
      "https://app.test",
    );
    expect(seriesDefault.guest.expiresAt).toBe(occurrence.startsAt);
    expect(seriesDefault.guest.active).toBe(true);

    for (const seriesWide of [false, true]) {
      await expect(
        inviteOccurrenceGuest(
          env.DB,
          admin,
          GROUP_ID,
          series.id,
          occurrence.id,
          {
            email: `overlong-${seriesWide}-${crypto.randomUUID()}@example.test`,
            name: "Overlong Window Guest",
            expiresAt: new Date(Date.parse(occurrence.endsAt) + 1).toISOString(),
            seriesWide,
          },
          "https://app.test",
        ),
      ).rejects.toMatchObject({ code: "INVITE_EXPIRY_AFTER_EVENT" });
    }

    const shortenedEnd = new Date(Date.parse(occurrence.startsAt) + 15 * 60_000).toISOString();
    await env.DB.prepare("UPDATE event_occurrences SET ends_at = ? WHERE id = ?")
      .bind(shortenedEnd, occurrence.id)
      .run();
    const listed = await listOccurrenceGuests(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      limit: 20,
      offset: 0,
    });
    // Moving the end earlier cannot extend a default that was already resolved
    // to the original start when the capability was issued.
    expect(listed.guests.find((guest) => guest.id === occurrenceDefault.guest.id)?.expiresAt).toBe(occurrence.startsAt);

    await env.DB.prepare("UPDATE events SET starts_at = NULL, ends_at = NULL WHERE id = ?").bind(series.eventId).run();
    const withoutSeriesWindow = await listOccurrenceGuests(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      limit: 20,
      offset: 0,
    });
    expect(withoutSeriesWindow.guests.find((guest) => guest.id === seriesDefault.guest.id)).toMatchObject({
      expiresAt: occurrence.startsAt,
      active: false,
    });
  });

  it("rolls back the guest and outbox when its occurrence window changes before commit", async () => {
    const { admin, series, occurrence } = await seedMeetingWindow();
    const email = `window-race-${crypto.randomUUID()}@example.test`;
    const expiresAt = new Date(Date.parse(occurrence.startsAt) + 30 * 60_000).toISOString();
    const shortenedEnd = new Date(Date.parse(occurrence.startsAt) + 15 * 60_000).toISOString();
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_occurrences SET ends_at = ? WHERE id = ?").bind(shortenedEnd, occurrence.id).run(),
    );
    await expect(
      inviteOccurrenceGuest(
        racingDb,
        admin,
        GROUP_ID,
        series.id,
        occurrence.id,
        { email, name: "Window Race Guest", expiresAt },
        "https://app.test",
      ),
    ).rejects.toMatchObject({ code: "EVENT_GUEST_WINDOW_CHANGED" });
    await expect(
      queryAll(env.DB, "SELECT id FROM event_occurrence_guests WHERE normalized_email = ?", [email]),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", [email]),
    ).resolves.toHaveLength(0);

    const seriesFixture = await seedMeetingWindow();
    const seriesEmail = `series-window-race-${crypto.randomUUID()}@example.test`;
    const seriesExpiresAt = new Date(Date.parse(seriesFixture.occurrence.startsAt) + 30 * 60_000).toISOString();
    const seriesShortenedEnd = new Date(Date.parse(seriesFixture.occurrence.startsAt) + 15 * 60_000).toISOString();
    const seriesRacingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE events SET ends_at = ? WHERE id = ?")
        .bind(seriesShortenedEnd, seriesFixture.series.eventId)
        .run(),
    );
    await expect(
      inviteOccurrenceGuest(
        seriesRacingDb,
        seriesFixture.admin,
        GROUP_ID,
        seriesFixture.series.id,
        seriesFixture.occurrence.id,
        { email: seriesEmail, name: "Series Window Race Guest", expiresAt: seriesExpiresAt, seriesWide: true },
        "https://app.test",
      ),
    ).rejects.toMatchObject({ code: "EVENT_GUEST_WINDOW_CHANGED" });
    await expect(
      queryAll(env.DB, "SELECT id FROM event_occurrence_guests WHERE normalized_email = ?", [seriesEmail]),
    ).resolves.toHaveLength(0);
  });
});
