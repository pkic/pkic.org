import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmMeetingJoin,
  createGroupEventSeries,
  createSeriesOccurrence,
  generateGroupSeriesIcs,
  getMeetingJoinLanding,
  inviteOccurrenceGuest,
  issueOccurrenceAccessToken,
  listOccurrenceAttendance,
  materializeSeriesOccurrences,
  revokeOccurrenceGuest,
  updateGroupEventSeries,
  verifyOccurrenceAttendance,
} from "../functions/_lib/services/event-series";
import { joinGroup } from "../functions/_lib/services/groups";
import type { AuthAdmin, DatabaseLike, D1StatementResult, StatementLike } from "../functions/_lib/types";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const ENCRYPTION_SECRET = "test-meeting-encryption-secret-0000000000000000";
const EVIDENCE_SECRET = "test-meeting-evidence-secret";
const GROUP_ID = "20000000-0000-4000-8000-000000000003";

function mutateBeforeNextBatch(mutation: () => Promise<unknown>): DatabaseLike {
  let pending = mutation;
  return {
    prepare: (sql: string) => env.DB.prepare(sql) as unknown as StatementLike,
    batch: async (statements: StatementLike[]): Promise<D1StatementResult[]> => {
      const runMutation = pending;
      pending = async () => undefined;
      await runMutation();
      return (await env.DB.batch(statements as D1PreparedStatement[])) as unknown as D1StatementResult[];
    },
  };
}

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
    const racingDb = mutateBeforeNextBatch(() =>
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
    const racingDb = mutateBeforeNextBatch(() =>
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
