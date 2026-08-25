import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmMeetingJoin,
  createGroupEventSeries,
  createSeriesOccurrence,
  generateGroupSeriesIcs,
  getGroupEventSeries,
  getMeetingJoinLanding,
  inviteOccurrenceGuest,
  issueOccurrenceAccessToken,
  listOccurrenceAttendance,
  materializeSeriesOccurrences,
  revokeOccurrenceGuest,
  updateGroupEventSeries,
  updateSeriesOccurrence,
  verifyOccurrenceAttendance,
} from "../functions/_lib/services/event-series";
import { eventOccurrenceUpdateSchema } from "../assets/shared/schemas/event-series";
import { joinGroup } from "../functions/_lib/services/groups";
import type { AuthAdmin } from "../functions/_lib/types";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const ENCRYPTION_SECRET = "test-meeting-encryption-secret-0000000000000000";
const EVIDENCE_SECRET = "test-meeting-evidence-secret";
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

  it("does not consume scanner GETs, reuses current terms, and records each intentional join", async () => {
    const { admin, userId, series, occurrence } = await createMeetingFixture();
    const termId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event_terms
         (id, event_id, audience_type, term_key, version, required, display_text, active, created_at)
       VALUES (?, ?, 'attendee', 'meeting-rules', 'v1', 1, 'Follow the meeting rules', 1, datetime('now'))`,
    )
      .bind(termId, series.eventId)
      .run();
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      userId,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });

    const landing = await getMeetingJoinLanding(env.DB, access.token);
    expect(landing.terms).toEqual([expect.objectContaining({ id: termId, accepted: false })]);
    const before = await queryAll<{ use_count: number }>(
      env.DB,
      "SELECT use_count FROM event_occurrence_access_tokens WHERE token_hash = ?",
      [await sha256Hex(access.token)],
    );
    expect(before[0].use_count).toBe(0);

    const firstJoin = await confirmMeetingJoin(
      env.DB,
      access.token,
      {
        name: landing.name,
        affiliation: landing.affiliation,
        acceptedTerms: [{ termId, version: "v1" }],
        intentionalJoin: true,
      },
      { encryptionSecret: ENCRYPTION_SECRET, evidenceSecret: EVIDENCE_SECRET, ip: "192.0.2.1", userAgent: "test" },
    );
    expect(firstJoin.redirectUrl).toBe("https://meet.example.test/secret-room");
    expect((await getMeetingJoinLanding(env.DB, access.token)).terms[0].accepted).toBe(true);

    await confirmMeetingJoin(
      env.DB,
      access.token,
      { name: landing.name, affiliation: landing.affiliation, acceptedTerms: [], intentionalJoin: true },
      { encryptionSecret: ENCRYPTION_SECRET, evidenceSecret: EVIDENCE_SECRET, ip: null, userAgent: null },
    );
    const confirmations = await listOccurrenceAttendance(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      limit: 50,
      offset: 0,
    });
    expect(confirmations.confirmations[0]).toMatchObject({ joinCount: 2, attendanceVerifiedAt: null });
    const verified = await verifyOccurrenceAttendance(
      env.DB,
      admin,
      GROUP_ID,
      series.id,
      occurrence.id,
      firstJoin.confirmationId,
      { source: "manual" },
    );
    expect(verified.attendanceVerificationSource).toBe("manual");

    const replacementTermId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("UPDATE event_terms SET active = 0 WHERE id = ?").bind(termId),
      env.DB.prepare(
        `INSERT INTO event_terms
           (id, event_id, audience_type, term_key, version, required, display_text, active, created_at)
         VALUES (?, ?, 'attendee', 'meeting-rules', 'v2', 1, 'Updated meeting rules', 1, datetime('now'))`,
      ).bind(replacementTermId, series.eventId),
    ]);
    expect((await getMeetingJoinLanding(env.DB, access.token)).terms[0]).toMatchObject({
      id: replacementTermId,
      version: "v2",
      accepted: false,
    });
    await expect(
      confirmMeetingJoin(
        env.DB,
        access.token,
        { name: landing.name, affiliation: landing.affiliation, acceptedTerms: [], intentionalJoin: true },
        { encryptionSecret: ENCRYPTION_SECRET, evidenceSecret: EVIDENCE_SECRET, ip: null, userAgent: null },
      ),
    ).rejects.toMatchObject({ code: "MEETING_TERM_REQUIRED" });
  });

  it("supports explicit series-wide guests and revokes their capabilities atomically", async () => {
    const { admin, series, occurrence } = await createMeetingFixture();
    const guest = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `guest-${crypto.randomUUID()}@example.test`,
      name: "External Guest",
      affiliation: "Guest Organization",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
      seriesWide: true,
    });
    expect(guest.seriesWide).toBe(true);
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      guestId: guest.id,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    expect((await getMeetingJoinLanding(env.DB, access.token)).name).toBe("External Guest");
    await expect(
      confirmMeetingJoin(
        env.DB,
        access.token,
        {
          name: "Forwarded Guest",
          affiliation: "Different Organization",
          acceptedTerms: [],
          intentionalJoin: true,
        },
        { encryptionSecret: ENCRYPTION_SECRET, evidenceSecret: EVIDENCE_SECRET, ip: null, userAgent: null },
      ),
    ).rejects.toMatchObject({ code: "MEETING_IDENTITY_CHANGED" });
    await revokeOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, guest.id);
    await expect(getMeetingJoinLanding(env.DB, access.token)).rejects.toMatchObject({
      code: "MEETING_ACCESS_NOT_FOUND",
    });
  });

  it("attributes service-issued invitations through the canonical audit record", async () => {
    const { series, occurrence } = await createMeetingFixture();
    const service: AuthAdmin = {
      identityType: "service",
      id: "meeting-invitation-service",
      email: "meeting-invitation-service@internal.invalid",
      role: "admin",
    };
    const guest = await inviteOccurrenceGuest(env.DB, service, GROUP_ID, series.id, occurrence.id, {
      email: `service-guest-${crypto.randomUUID()}@example.test`,
      name: "Service Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    expect(guest.name).toBe("Service Guest");
    expect(
      await env.DB.prepare(
        `SELECT actor_id FROM audit_log
          WHERE action = 'event_guest_invited' AND entity_id = ? AND scope_type = 'group' AND scope_id = ?`,
      )
        .bind(guest.id, GROUP_ID)
        .first("actor_id"),
    ).toBe(service.id);
  });

  it("makes the current guest policy authoritative for invitation, issuance, and use", async () => {
    const { admin, userId, series, occurrence } = await createMeetingFixture();
    const guest = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `policy-guest-${crypto.randomUUID()}@example.test`,
      name: "Policy Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      guestId: guest.id,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    expect((await getMeetingJoinLanding(env.DB, access.token)).name).toBe("Policy Guest");
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT 1 FROM current_event_occurrence_subject_eligibility
        WHERE occurrence_id = ? AND user_id IS NULL AND guest_id = ? LIMIT 1`,
    )
      .bind(occurrence.id, guest.id)
      .all<{ detail: string }>();
    const planText = plan.results.map((row) => row.detail).join("\n");
    expect(planText).toContain("SEARCH occurrence");
    expect(planText).toContain("SEARCH guest");
    expect(planText).not.toContain("SCAN guest");
    const userPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT 1 FROM current_event_occurrence_subject_eligibility
        WHERE occurrence_id = ? AND user_id = ? AND guest_id IS NULL LIMIT 1`,
    )
      .bind(occurrence.id, userId)
      .all<{ detail: string }>();
    const userPlanText = userPlan.results.map((row) => row.detail).join("\n");
    expect(userPlanText).toContain("SEARCH occurrence");
    expect(userPlanText).toContain("SEARCH active_user");
    expect(userPlanText).not.toContain("SCAN active_user");

    await updateGroupEventSeries(env.DB, admin, GROUP_ID, series.id, {
      expectedUpdatedAt: (await getGroupEventSeries(env.DB, GROUP_ID, series.id)).updatedAt,
      policy: {
        registrationPolicy: "no_registration",
        memberEligibility: "owner_group",
        guestPolicy: "none",
      },
    });
    await expect(getMeetingJoinLanding(env.DB, access.token)).rejects.toMatchObject({
      code: "MEETING_GUEST_ACCESS_REVOKED",
    });
    await expect(
      inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
        email: `blocked-guest-${crypto.randomUUID()}@example.test`,
        name: "Blocked Guest",
        expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "EVENT_GUESTS_DISABLED" });
    await expect(
      issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
        guestId: guest.id,
        expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "EVENT_GUESTS_DISABLED" });
  });

  it("keeps legacy guest policy data readable while writing only the canonical vocabulary", async () => {
    const { admin, series, occurrence } = await createMeetingFixture();
    await env.DB.prepare("UPDATE events SET settings_json = ? WHERE id = ?")
      .bind(JSON.stringify({ memberEligibility: "group", guestPolicy: "invitation_only" }), series.eventId)
      .run();
    const guest = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `legacy-policy-${crypto.randomUUID()}@example.test`,
      name: "Legacy Policy Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      guestId: guest.id,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    expect(await getMeetingJoinLanding(env.DB, access.token)).toMatchObject({ name: "Legacy Policy Guest" });
  });

  it("invalidates member and guest capabilities when the owning group becomes inactive", async () => {
    const { admin, userId, series, occurrence } = await createMeetingFixture();
    const guest = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `inactive-group-${crypto.randomUUID()}@example.test`,
      name: "Inactive Group Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const memberAccess = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      userId,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const guestAccess = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      guestId: guest.id,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    await env.DB.prepare("UPDATE groups SET active = 0 WHERE id = ?").bind(GROUP_ID).run();
    try {
      await expect(getMeetingJoinLanding(env.DB, memberAccess.token)).rejects.toMatchObject({
        code: "MEETING_GROUP_MEMBERSHIP_REQUIRED",
      });
      await expect(getMeetingJoinLanding(env.DB, guestAccess.token)).rejects.toMatchObject({
        code: "MEETING_GUEST_ACCESS_REVOKED",
      });
    } finally {
      await env.DB.prepare("UPDATE groups SET active = 1 WHERE id = ?").bind(GROUP_ID).run();
    }
  });

  it("atomically rejects guest policy changes before intentional join", async () => {
    const { admin, series, occurrence } = await createMeetingFixture();
    const guest = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email: `policy-race-${crypto.randomUUID()}@example.test`,
      name: "Policy Race Guest",
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      guestId: guest.id,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const landing = await getMeetingJoinLanding(env.DB, access.token);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE events SET settings_json = ? WHERE id = ?")
        .bind(JSON.stringify({ memberEligibility: "owner_group", guestPolicy: "none" }), series.eventId)
        .run(),
    );
    await expect(
      confirmMeetingJoin(
        racingDb,
        access.token,
        {
          name: landing.name,
          affiliation: landing.affiliation,
          acceptedTerms: [],
          intentionalJoin: true,
        },
        { encryptionSecret: ENCRYPTION_SECRET, evidenceSecret: EVIDENCE_SECRET, ip: null, userAgent: null },
      ),
    ).rejects.toMatchObject({ code: "MEETING_ACCESS_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM event_occurrence_join_confirmations WHERE occurrence_id = ?", [
        occurrence.id,
      ]),
    ).toEqual([]);
  });

  it("rejects stale guest invitation updates instead of overwriting a concurrent change", async () => {
    const { admin, series, occurrence } = await createMeetingFixture();
    const email = `guest-update-race-${crypto.randomUUID()}@example.test`;
    const expiresAt = new Date(Date.now() + 10_800_000).toISOString();
    const guest = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email,
      name: "Original Guest",
      expiresAt,
    });
    const concurrentUpdatedAt = "2099-01-01T00:00:00.000Z";
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_occurrence_guests SET updated_at = ? WHERE id = ?")
        .bind(concurrentUpdatedAt, guest.id)
        .run(),
    );

    await expect(
      inviteOccurrenceGuest(racingDb, admin, GROUP_ID, series.id, occurrence.id, {
        email,
        name: "Stale Overwrite",
        expiresAt,
      }),
    ).rejects.toMatchObject({ code: "EVENT_GUEST_CHANGED" });
    expect(
      await env.DB.prepare("SELECT name, updated_at FROM event_occurrence_guests WHERE id = ?").bind(guest.id).first(),
    ).toEqual({ name: "Original Guest", updated_at: concurrentUpdatedAt });
  });

  it("atomically rejects token issuance after guest revocation without leaving a capability", async () => {
    const { admin, series, occurrence } = await createMeetingFixture();
    const email = `issuance-race-${crypto.randomUUID()}@example.test`;
    const expiresAt = new Date(Date.now() + 10_800_000).toISOString();
    const guest = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email,
      name: "Issuance Race Guest",
      expiresAt,
    });
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      revokeOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, guest.id),
    );
    await expect(
      issueOccurrenceAccessToken(racingDb, admin, GROUP_ID, series.id, occurrence.id, {
        guestId: guest.id,
        expiresAt,
      }),
    ).rejects.toMatchObject({ code: "MEETING_ACCESS_CHANGED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM event_occurrence_access_tokens WHERE guest_id = ?")
        .bind(guest.id)
        .first<number>("total"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'event_occurrence_access_issued' AND entity_id = ?",
      )
        .bind(occurrence.id)
        .first<number>("total"),
    ).toBe(0);

    const reactivated = await inviteOccurrenceGuest(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      email,
      name: "Issuance Race Guest",
      expiresAt,
    });
    expect(reactivated.id).toBe(guest.id);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM event_occurrence_access_tokens WHERE guest_id = ?")
        .bind(guest.id)
        .first<number>("total"),
    ).toBe(0);
  });

  it("rejects expired meeting capabilities without recording a join", async () => {
    const { admin, userId, series, occurrence } = await createMeetingFixture();
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      userId,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    await env.DB.prepare("UPDATE event_occurrence_access_tokens SET expires_at = ? WHERE token_hash = ?")
      .bind(new Date(Date.now() - 1_000).toISOString(), await sha256Hex(access.token))
      .run();

    await expect(getMeetingJoinLanding(env.DB, access.token)).rejects.toMatchObject({
      code: "MEETING_ACCESS_NOT_FOUND",
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM event_occurrence_join_confirmations WHERE occurrence_id = ?", [
        occurrence.id,
      ]),
    ).toEqual([]);
  });

  it("rechecks group membership when a capability is used", async () => {
    const { admin, userId, series, occurrence } = await createMeetingFixture();
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      userId,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    await env.DB.prepare("UPDATE group_memberships SET left_at = ? WHERE group_id = ? AND user_id = ?")
      .bind(new Date().toISOString(), GROUP_ID, userId)
      .run();
    await expect(getMeetingJoinLanding(env.DB, access.token)).rejects.toMatchObject({
      code: "MEETING_GROUP_MEMBERSHIP_REQUIRED",
    });
  });

  it("records only the authoritative identity displayed by the landing page", async () => {
    const { admin, userId, series, occurrence } = await createMeetingFixture();
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      userId,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const landing = await getMeetingJoinLanding(env.DB, access.token);
    await expect(
      confirmMeetingJoin(
        env.DB,
        access.token,
        { name: "Someone Else", affiliation: landing.affiliation, acceptedTerms: [], intentionalJoin: true },
        { encryptionSecret: ENCRYPTION_SECRET, evidenceSecret: EVIDENCE_SECRET, ip: null, userAgent: null },
      ),
    ).rejects.toMatchObject({ code: "MEETING_IDENTITY_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM event_occurrence_join_confirmations WHERE occurrence_id = ?", [
        occurrence.id,
      ]),
    ).toEqual([]);
  });

  it("atomically rejects a token revoked after the landing read", async () => {
    const { admin, userId, series, occurrence } = await createMeetingFixture();
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      userId,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const landing = await getMeetingJoinLanding(env.DB, access.token);
    const tokenHash = await sha256Hex(access.token);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE event_occurrence_access_tokens SET revoked_at = datetime('now') WHERE token_hash = ?")
        .bind(tokenHash)
        .run(),
    );
    await expect(
      confirmMeetingJoin(
        racingDb,
        access.token,
        {
          name: landing.name,
          affiliation: landing.affiliation,
          acceptedTerms: [],
          intentionalJoin: true,
        },
        { encryptionSecret: ENCRYPTION_SECRET, evidenceSecret: EVIDENCE_SECRET, ip: null, userAgent: null },
      ),
    ).rejects.toMatchObject({ code: "MEETING_ACCESS_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM event_occurrence_join_confirmations WHERE occurrence_id = ?", [
        occurrence.id,
      ]),
    ).toEqual([]);
  });

  it("atomically rejects a newly required term introduced before confirmation", async () => {
    const { admin, userId, series, occurrence } = await createMeetingFixture();
    const access = await issueOccurrenceAccessToken(env.DB, admin, GROUP_ID, series.id, occurrence.id, {
      userId,
      expiresAt: new Date(Date.now() + 10_800_000).toISOString(),
    });
    const landing = await getMeetingJoinLanding(env.DB, access.token);
    expect(landing.terms).toEqual([]);
    const racingDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare(
        `INSERT INTO event_terms
           (id, event_id, audience_type, term_key, version, required, display_text, active, created_at)
         VALUES (?, ?, 'attendee', 'new-rule', 'v1', 1, 'New rule', 1, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), series.eventId)
        .run(),
    );
    await expect(
      confirmMeetingJoin(
        racingDb,
        access.token,
        {
          name: landing.name,
          affiliation: landing.affiliation,
          acceptedTerms: [],
          intentionalJoin: true,
        },
        { encryptionSecret: ENCRYPTION_SECRET, evidenceSecret: EVIDENCE_SECRET, ip: null, userAgent: null },
      ),
    ).rejects.toMatchObject({ code: "MEETING_ACCESS_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM event_occurrence_join_confirmations WHERE occurrence_id = ?", [
        occurrence.id,
      ]),
    ).toEqual([]);
  });
});
