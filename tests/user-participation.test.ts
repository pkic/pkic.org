/**
 * The participation read model's counting rules.
 *
 * Every assertion here is about a way the numbers could be quietly wrong
 * rather than absent: an attendance rate that charges someone for meetings
 * held before they joined, or counts one that was cancelled, or one still in
 * the future, is worse than no rate at all — it reads as a record of someone
 * missing meetings.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { userParticipationSchema } from "../assets/shared/schemas/user-participation";
import { getUserParticipation } from "../functions/_lib/services/user-participation";
import { resetDb } from "./helpers/reset-db";
import { insertIndividualMember } from "./helpers/membership";

const NOW = () => new Date().toISOString();
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function insertGroup(name: string, slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, active, created_at, updated_at)
     VALUES (?, 'working_group', ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(id, name, slug)
    .run();
  return id;
}

/** A group's meeting series: the event it owns, plus the recurrence. */
async function insertSeriesForGroup(groupId: string, slug: string): Promise<string> {
  const eventId = crypto.randomUUID();
  const seriesId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, registration_mode, invite_limit_attendee,
                         settings_json, owner_group_id, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', 'invite_or_open', 5, '{}', ?, ?, ?)`,
  )
    .bind(eventId, slug, `${slug} meetings`, groupId, NOW(), NOW())
    .run();
  await env.DB.prepare(
    `INSERT INTO event_series (id, event_id, starts_at, recurrence_rule, timezone, duration_minutes,
                               active, created_at, updated_at)
     VALUES (?, ?, ?, 'FREQ=WEEKLY', 'UTC', 60, 1, ?, ?)`,
  )
    .bind(seriesId, eventId, daysFromNow(-90), NOW(), NOW())
    .run();
  return seriesId;
}

async function insertOccurrence(seriesId: string, startsAt: string, status = "scheduled"): Promise<string> {
  const id = crypto.randomUUID();
  // `ends_at > starts_at` is enforced: an occurrence is an interval, never an instant.
  const endsAt = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO event_occurrences (id, series_id, starts_at, ends_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, seriesId, startsAt, endsAt, status, NOW(), NOW())
    .run();
  return id;
}

async function recordAttendance(occurrenceId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_occurrence_join_confirmations
       (id, occurrence_id, user_id, name_snapshot, join_count, confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Test Member', 1, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), occurrenceId, userId, NOW(), NOW(), NOW())
    .run();
}

/**
 * A seat on a group's roster. `group_memberships` requires a real active
 * identity and member — the schema refuses a fabricated one — so the fixture
 * carries the ids the membership helper actually created.
 */
async function joinGroup(
  groupId: string,
  member: { userId: string; memberId: string; identityId: string },
  joinedAt: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO group_memberships
       (id, group_id, user_id, identity_id, member_id, source, joined_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'staff', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), groupId, member.userId, member.identityId, member.memberId, joinedAt, NOW(), NOW())
    .run();
}

describe("user participation read model", () => {
  beforeEach(resetDb);

  it("counts only meetings held since the person joined, and only those they attended", async () => {
    const member = await insertIndividualMember(env.DB, "H6", "participation@example.test");
    const userId = member.userId;
    const groupId = await insertGroup("CBOM Profiles", "cbom-profiles");
    const seriesId = await insertSeriesForGroup(groupId, "cbom-profiles");

    // Held long before they joined: must not count against them.
    await insertOccurrence(seriesId, daysFromNow(-60));
    await joinGroup(groupId, member, daysFromNow(-30));

    // Held once: `daysFromNow` reads the clock, so recomputing it at assertion
    // time drifts by however long the test took.
    const secondMeetingAt = daysFromNow(-10);
    const attendedOne = await insertOccurrence(seriesId, daysFromNow(-20));
    const attendedTwo = await insertOccurrence(seriesId, secondMeetingAt);
    await insertOccurrence(seriesId, daysFromNow(-5)); // held, missed
    await recordAttendance(attendedOne, userId);
    await recordAttendance(attendedTwo, userId);

    const participation = userParticipationSchema.parse(await getUserParticipation(env.DB, userId));
    const group = participation.groups[0];

    expect(group?.attended).toBe(2);
    // Three since joining — not four. The pre-join meeting is excluded.
    expect(group?.held).toBe(3);
    expect(group?.lastAttendedAt).toBe(secondMeetingAt);
    expect(participation.summary.meetingsAttended).toBe(2);
    expect(participation.summary.meetingsHeld).toBe(3);
  });

  it("excludes meetings that have not happened yet and meetings that were cancelled", async () => {
    const member = await insertIndividualMember(env.DB, "H6", "future@example.test");
    const userId = member.userId;
    const groupId = await insertGroup("Post-Quantum", "post-quantum");
    const seriesId = await insertSeriesForGroup(groupId, "post-quantum");
    await joinGroup(groupId, member, daysFromNow(-40));

    const attended = await insertOccurrence(seriesId, daysFromNow(-3));
    await recordAttendance(attended, userId);
    await insertOccurrence(seriesId, daysFromNow(+7)); // still to come
    await insertOccurrence(seriesId, daysFromNow(-2), "cancelled"); // never took place

    const participation = userParticipationSchema.parse(await getUserParticipation(env.DB, userId));

    expect(participation.groups[0]?.attended).toBe(1);
    // Only the one meeting that actually took place counts as held.
    expect(participation.groups[0]?.held).toBe(1);
  });

  it("reports a group whose meetings have not started as nothing to rate, not as zero attendance", async () => {
    const member = await insertIndividualMember(env.DB, "H6", "brand-new@example.test");
    const userId = member.userId;
    const groupId = await insertGroup("Training", "training");
    const seriesId = await insertSeriesForGroup(groupId, "training");
    await joinGroup(groupId, member, daysFromNow(-1));
    await insertOccurrence(seriesId, daysFromNow(+3));

    const participation = userParticipationSchema.parse(await getUserParticipation(env.DB, userId));

    // held === 0 is the signal a caller needs to render a dash rather than 0%.
    expect(participation.groups[0]?.held).toBe(0);
    expect(participation.groups[0]?.attended).toBe(0);
    expect(participation.groups[0]?.lastAttendedAt).toBeNull();
    expect(participation.summary.meetingsHeld).toBe(0);
  });

  it("keeps each group's attendance to that group's own meetings", async () => {
    const member = await insertIndividualMember(env.DB, "H6", "two-groups@example.test");
    const userId = member.userId;
    const first = await insertGroup("First", "first");
    const second = await insertGroup("Second", "second");
    const firstSeries = await insertSeriesForGroup(first, "first");
    const secondSeries = await insertSeriesForGroup(second, "second");
    await joinGroup(first, member, daysFromNow(-30));
    await joinGroup(second, member, daysFromNow(-30));

    const inFirst = await insertOccurrence(firstSeries, daysFromNow(-10));
    await insertOccurrence(secondSeries, daysFromNow(-9));
    await recordAttendance(inFirst, userId);

    const participation = userParticipationSchema.parse(await getUserParticipation(env.DB, userId));
    const byName = new Map(participation.groups.map((entry) => [entry.group.name, entry]));

    expect(byName.get("First")?.attended).toBe(1);
    // The meeting attended in First must not leak into Second's count.
    expect(byName.get("Second")?.attended).toBe(0);
    expect(byName.get("Second")?.held).toBe(1);
    expect(participation.summary.groupCount).toBe(2);
  });

  it("returns an empty participation record for someone in no groups", async () => {
    const member = await insertIndividualMember(env.DB, "H6", "no-groups@example.test");
    const userId = member.userId;

    const participation = userParticipationSchema.parse(await getUserParticipation(env.DB, userId));

    expect(participation.groups).toEqual([]);
    expect(participation.summary).toEqual({
      groupCount: 0,
      eventCount: 0,
      meetingsAttended: 0,
      meetingsHeld: 0,
    });
  });

  it("does not count a group the person has left", async () => {
    const member = await insertIndividualMember(env.DB, "H6", "departed@example.test");
    const userId = member.userId;
    const groupId = await insertGroup("Departed", "departed");
    const seriesId = await insertSeriesForGroup(groupId, "departed");
    await joinGroup(groupId, member, daysFromNow(-30));
    await insertOccurrence(seriesId, daysFromNow(-10));
    await env.DB.prepare("UPDATE group_memberships SET left_at = ? WHERE user_id = ?")
      .bind(daysFromNow(-5), userId)
      .run();

    const participation = userParticipationSchema.parse(await getUserParticipation(env.DB, userId));

    expect(participation.groups).toEqual([]);
    expect(participation.summary.groupCount).toBe(0);
  });
});
