/**
 * The four participation-history collections on a person's record.
 *
 * What these assert is mostly what must NOT appear. A history is read as a
 * statement about somebody, so a row that does not belong there is worse than
 * a missing one: a meeting that was cancelled reads as a meeting they sat
 * through, an invitation they never accepted reads as an event they attended,
 * and another person's row on this record is simply wrong about them. The
 * ballot collection carries the sharpest case — it must show that somebody
 * voted and never how, so the choice is written into the fixture and then
 * proven absent from the response.
 *
 * Instants are fixed literals rather than offsets from `Date.now()`: the
 * clock moves between an insert and the assertion that reads it back, and an
 * ordering test that recomputes its own expectation proves nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import app from "../functions/router";
import {
  participationHistoryListQuerySchema,
  userDocumentContributionListResponseSchema,
  userEventParticipationListResponseSchema,
  userMeetingParticipationListResponseSchema,
  userVoteParticipationListResponseSchema,
  type ParticipationHistoryListQuery,
} from "../assets/shared/schemas/user-participation-history";
import { listUserDocumentContributions } from "../functions/_lib/services/user-participation-history/documents";
import { listUserEventParticipation } from "../functions/_lib/services/user-participation-history/events";
import { listUserMeetingParticipation } from "../functions/_lib/services/user-participation-history/meetings";
import { listUserVoteParticipation } from "../functions/_lib/services/user-participation-history/votes";
import { createAdminSession } from "./helpers/auth";
import { insertIndividualMember, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

interface Person {
  userId: string;
  memberId: string;
  identityId: string;
}

const query = (overrides: Record<string, unknown> = {}): ParticipationHistoryListQuery =>
  participationHistoryListQuerySchema.parse(overrides);

let personCounter = 0;
async function seedPerson(): Promise<Person> {
  personCounter += 1;
  return insertIndividualMember(env.DB, "H6", `history-${personCounter}-${crypto.randomUUID()}@example.test`);
}

async function call(path: string, token?: string): Promise<Response> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return app.fetch(
    new Request(`https://app.test${path}`, { headers }),
    env as never,
    { passThroughOnException: () => {}, waitUntil: () => {} } as never,
  );
}

/** A staff session holding exactly the named permissions and nothing else. */
async function grantToken(...permissions: string[]): Promise<string> {
  const userId = await insertUser(env.DB, `history-reader-${crypto.randomUUID()}@example.test`);
  await env.DB.batch(
    permissions.map((permission) =>
      env.DB.prepare(
        `INSERT INTO permission_grants
           (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
         VALUES (?, ?, ?, NULL, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      ).bind(crypto.randomUUID(), userId, permission, userId),
    ),
  );
  return createAdminSession(env.DB, userId, `participation-history-${crypto.randomUUID()}`);
}

/* ── Fixtures ──────────────────────────────────────────────────────────── */

async function insertEvent(slug: string, name: string, startsAt: string | null): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, starts_at, registration_mode, invite_limit_attendee,
                         settings_json, owner_group_id, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', ?, 'invite_or_open', 5, '{}', NULL,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(id, slug, name, startsAt)
    .run();
  return id;
}

async function participate(
  eventId: string,
  userId: string,
  role: string,
  options: { status?: string; createdAt?: string } = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_participants (id, event_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      eventId,
      userId,
      role,
      options.status ?? "active",
      options.createdAt ?? "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    )
    .run();
}

/**
 * A group of this test's own. `resetDb` deliberately keeps the groups the
 * migration seeds ("all-members", "cbom", "board", ...), so a fixture slug is
 * suffixed to stay clear of that reference data.
 */
async function insertGroup(name: string, slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, type_key, name, slug, active, created_at, updated_at)
     VALUES (?, 'working_group', ?, ?, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(id, name, `${slug}-${id.slice(0, 8)}`)
    .run();
  return id;
}

/** A group's meeting series: the event it owns, plus the recurrence. */
async function insertSeriesForGroup(groupId: string | null, slug: string): Promise<string> {
  const eventId = crypto.randomUUID();
  const seriesId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, registration_mode, invite_limit_attendee,
                         settings_json, owner_group_id, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', 'invite_or_open', 5, '{}', ?,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(eventId, slug, `${slug} meetings`, groupId)
    .run();
  await env.DB.prepare(
    `INSERT INTO event_series (id, event_id, starts_at, recurrence_rule, timezone, duration_minutes,
                               active, created_at, updated_at)
     VALUES (?, ?, '2026-01-01T10:00:00.000Z', 'FREQ=WEEKLY', 'UTC', 60, 1,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(seriesId, eventId)
    .run();
  return seriesId;
}

async function insertOccurrence(seriesId: string, startsAt: string, status = "scheduled"): Promise<string> {
  const id = crypto.randomUUID();
  // `ends_at > starts_at` is enforced: an occurrence is an interval, never an instant.
  const endsAt = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO event_occurrences (id, series_id, starts_at, ends_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(id, seriesId, startsAt, endsAt, status)
    .run();
  return id;
}

async function recordAttendance(occurrenceId: string, userId: string, confirmedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO event_occurrence_join_confirmations
       (id, occurrence_id, user_id, name_snapshot, join_count, confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Test Member', 1, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(crypto.randomUUID(), occurrenceId, userId, confirmedAt)
    .run();
}

async function insertProposal(eventId: string, proposerUserId: string, title: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO session_proposals
       (id, event_id, proposer_user_id, status, proposal_type, title, abstract, manage_link_secret,
        submitted_at, updated_at)
     VALUES (?, ?, ?, 'submitted', 'talk', ?, 'An abstract.', ?, '2026-01-01T00:00:00.000Z',
             '2026-01-01T00:00:00.000Z')`,
  )
    .bind(id, eventId, proposerUserId, title, crypto.randomUUID())
    .run();
  return id;
}

async function insertVersion(
  proposalId: string,
  uploadedByUserId: string | null,
  uploadedAt: string,
  options: { versionNumber?: number; fileName?: string | null; deletedAt?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  // One current version per proposal is a unique index, so a new upload
  // supersedes the previous one exactly as the upload service does.
  await env.DB.prepare("UPDATE presentation_versions SET is_current = 0 WHERE proposal_id = ? AND is_current = 1")
    .bind(proposalId)
    .run();
  await env.DB.prepare(
    `INSERT INTO presentation_versions
       (id, proposal_id, version_number, r2_key, file_name, uploaded_by_user_id, uploaded_at, is_current, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(
      id,
      proposalId,
      options.versionNumber ?? 1,
      `presentations/${id}.pdf`,
      options.fileName === undefined ? "deck.pdf" : options.fileName,
      uploadedByUserId,
      uploadedAt,
      options.deletedAt ?? null,
    )
    .run();
  return id;
}

async function insertReview(
  versionId: string,
  reviewerUserId: string,
  reviewedAt: string,
  status = "approved",
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO presentation_version_reviews (id, version_id, reviewed_by_user_id, reviewed_at, status, note)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  )
    .bind(id, versionId, reviewerUserId, reviewedAt, status)
    .run();
  return id;
}

async function insertVote(groupId: string, slug: string, title: string, voteType = "motion"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO votes (id, slug, title, vote_type, owner_group_id, threshold_type, opens_at, closes_at,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'simple_majority', '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z',
             strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(id, slug, title, voteType, groupId)
    .run();
  return id;
}

async function castBallot(
  voteId: string,
  person: Person,
  choice: string,
  submittedAt: string,
  round = 1,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO vote_ballots (id, vote_id, user_id, identity_id, member_id, choice, round, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), voteId, person.userId, person.identityId, choice, round, submittedAt, submittedAt)
    .run();
}

/* ── Events ────────────────────────────────────────────────────────────── */

describe("event participation history", () => {
  beforeEach(resetDb);

  it("returns one row per event carrying every active role, newest first", async () => {
    const person = await seedPerson();
    const older = await insertEvent("plenary-2024", "Plenary 2024", "2024-05-01T09:00:00.000Z");
    const newer = await insertEvent("summit-2026", "Summit 2026", "2026-05-01T09:00:00.000Z");
    await participate(newer, person.userId, "speaker");
    // Same event, second role: one line with two badges, not two lines.
    await participate(newer, person.userId, "organizer");
    await participate(older, person.userId, "attendee");

    const page = userEventParticipationListResponseSchema.parse(
      await listUserEventParticipation(env.DB, person.userId, query()),
    );

    expect(page.events.map((entry) => entry.eventSlug)).toEqual(["summit-2026", "plenary-2024"]);
    // Vocabulary order, not the order the scan produced them in.
    expect(page.events[0]?.roles).toEqual(["speaker", "organizer"]);
    expect(page.events[0]?.occurredAt).toBe("2026-05-01T09:00:00.000Z");
    expect(page.page.total).toBe(2);
  });

  it("excludes participations that are not active", async () => {
    const person = await seedPerson();
    const attended = await insertEvent("attended", "Attended", "2026-03-01T09:00:00.000Z");
    const invited = await insertEvent("invited", "Invited", "2026-03-02T09:00:00.000Z");
    const waitlisted = await insertEvent("waitlisted", "Waitlisted", "2026-03-03T09:00:00.000Z");
    const revoked = await insertEvent("revoked", "Revoked", "2026-03-04T09:00:00.000Z");
    await participate(attended, person.userId, "attendee");
    await participate(invited, person.userId, "attendee", { status: "invited" });
    await participate(waitlisted, person.userId, "attendee", { status: "waitlisted" });
    await participate(revoked, person.userId, "speaker", { status: "inactive" });

    const page = userEventParticipationListResponseSchema.parse(
      await listUserEventParticipation(env.DB, person.userId, query()),
    );

    // An unanswered invitation, a queue place, and a withdrawn role are not
    // participation; only the accepted one is.
    expect(page.events.map((entry) => entry.eventSlug)).toEqual(["attended"]);
    expect(page.page.total).toBe(1);
  });

  it("places an event with no schedule at the moment the role was recorded", async () => {
    const person = await seedPerson();
    const unscheduled = await insertEvent("unscheduled", "Unscheduled", null);
    await participate(unscheduled, person.userId, "staff", { createdAt: "2026-07-04T12:00:00.000Z" });

    const page = userEventParticipationListResponseSchema.parse(
      await listUserEventParticipation(env.DB, person.userId, query()),
    );

    expect(page.events[0]?.startsAt).toBeNull();
    // Still sortable, and still honest about having no start date of its own.
    expect(page.events[0]?.occurredAt).toBe("2026-07-04T12:00:00.000Z");
  });

  it("pages at the first, last, and past-the-end boundaries without losing the total", async () => {
    const person = await seedPerson();
    for (let index = 1; index <= 5; index += 1) {
      const eventId = await insertEvent(`event-${index}`, `Event ${index}`, `2026-0${index}-01T09:00:00.000Z`);
      await participate(eventId, person.userId, "attendee");
    }

    const first = await listUserEventParticipation(env.DB, person.userId, query({ limit: 2 }));
    const last = await listUserEventParticipation(env.DB, person.userId, query({ limit: 2, offset: 4 }));
    const beyond = await listUserEventParticipation(env.DB, person.userId, query({ limit: 2, offset: 10 }));

    expect(first.events.map((entry) => entry.eventSlug)).toEqual(["event-5", "event-4"]);
    expect(first.page).toEqual({ limit: 2, offset: 0, total: 5, hasMore: true });
    expect(last.events.map((entry) => entry.eventSlug)).toEqual(["event-1"]);
    expect(last.page).toEqual({ limit: 2, offset: 4, total: 5, hasMore: false });
    // Past the end is an empty page, not an error, and still reports the total.
    expect(beyond.events).toEqual([]);
    expect(beyond.page).toEqual({ limit: 2, offset: 10, total: 5, hasMore: false });
  });

  it("keeps one person's events off another person's record", async () => {
    const mine = await seedPerson();
    const theirs = await seedPerson();
    const shared = await insertEvent("shared", "Shared", "2026-04-01T09:00:00.000Z");
    const only = await insertEvent("only-theirs", "Only Theirs", "2026-04-02T09:00:00.000Z");
    await participate(shared, mine.userId, "attendee");
    await participate(shared, theirs.userId, "speaker");
    await participate(only, theirs.userId, "attendee");

    const page = userEventParticipationListResponseSchema.parse(
      await listUserEventParticipation(env.DB, mine.userId, query()),
    );

    expect(page.events.map((entry) => entry.eventSlug)).toEqual(["shared"]);
    // The other person's role at the shared event must not appear on this row.
    expect(page.events[0]?.roles).toEqual(["attendee"]);
  });

  it("returns an empty page for somebody with no events at all", async () => {
    const person = await seedPerson();

    const page = userEventParticipationListResponseSchema.parse(
      await listUserEventParticipation(env.DB, person.userId, query()),
    );

    expect(page.events).toEqual([]);
    expect(page.page).toEqual({ limit: 50, offset: 0, total: 0, hasMore: false });
  });
});

/* ── Meetings ──────────────────────────────────────────────────────────── */

describe("meeting participation history", () => {
  beforeEach(resetDb);

  it("lists the meetings a person joined, newest first, with the group that called them", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("Post-Quantum", "post-quantum");
    const seriesId = await insertSeriesForGroup(groupId, "post-quantum");
    const older = await insertOccurrence(seriesId, "2026-01-05T10:00:00.000Z");
    const newer = await insertOccurrence(seriesId, "2026-02-05T10:00:00.000Z");
    await recordAttendance(older, person.userId, "2026-01-05T10:01:00.000Z");
    await recordAttendance(newer, person.userId, "2026-02-05T10:02:00.000Z");

    const page = userMeetingParticipationListResponseSchema.parse(
      await listUserMeetingParticipation(env.DB, person.userId, query()),
    );

    expect(page.meetings.map((entry) => entry.occurredAt)).toEqual([
      "2026-02-05T10:00:00.000Z",
      "2026-01-05T10:00:00.000Z",
    ]);
    expect(page.meetings[0]?.group?.name).toBe("Post-Quantum");
    // Joining is not the same instant as the meeting starting.
    expect(page.meetings[0]?.confirmedAt).toBe("2026-02-05T10:02:00.000Z");
    expect(page.meetings[0]?.occurrenceId).toBe(newer);
  });

  it("excludes a cancelled meeting even when a join was already recorded", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("CBOM", "cbom");
    const seriesId = await insertSeriesForGroup(groupId, "cbom");
    const held = await insertOccurrence(seriesId, "2026-03-01T10:00:00.000Z");
    const called = await insertOccurrence(seriesId, "2026-03-08T10:00:00.000Z", "cancelled");
    await recordAttendance(held, person.userId, "2026-03-01T10:00:00.000Z");
    await recordAttendance(called, person.userId, "2026-03-08T10:00:00.000Z");

    const page = userMeetingParticipationListResponseSchema.parse(
      await listUserMeetingParticipation(env.DB, person.userId, query()),
    );

    // A meeting that never took place is not something anybody took part in.
    expect(page.meetings.map((entry) => entry.occurrenceId)).toEqual([held]);
    expect(page.page.total).toBe(1);
  });

  it("still lists a meeting whose event no group owns", async () => {
    const person = await seedPerson();
    const seriesId = await insertSeriesForGroup(null, "ownerless");
    const occurrenceId = await insertOccurrence(seriesId, "2026-04-01T10:00:00.000Z");
    await recordAttendance(occurrenceId, person.userId, "2026-04-01T10:00:00.000Z");

    const page = userMeetingParticipationListResponseSchema.parse(
      await listUserMeetingParticipation(env.DB, person.userId, query()),
    );

    expect(page.meetings).toHaveLength(1);
    expect(page.meetings[0]?.group).toBeNull();
  });

  it("pages meetings at the first, last, and past-the-end boundaries", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("Weekly", "weekly");
    const seriesId = await insertSeriesForGroup(groupId, "weekly");
    for (let index = 1; index <= 5; index += 1) {
      const occurrenceId = await insertOccurrence(seriesId, `2026-0${index}-10T10:00:00.000Z`);
      await recordAttendance(occurrenceId, person.userId, `2026-0${index}-10T10:00:00.000Z`);
    }

    const first = await listUserMeetingParticipation(env.DB, person.userId, query({ limit: 3 }));
    const last = await listUserMeetingParticipation(env.DB, person.userId, query({ limit: 3, offset: 3 }));
    const beyond = await listUserMeetingParticipation(env.DB, person.userId, query({ limit: 3, offset: 99 }));

    expect(first.meetings.map((entry) => entry.occurredAt)).toEqual([
      "2026-05-10T10:00:00.000Z",
      "2026-04-10T10:00:00.000Z",
      "2026-03-10T10:00:00.000Z",
    ]);
    expect(first.page.hasMore).toBe(true);
    expect(last.meetings).toHaveLength(2);
    expect(last.page.hasMore).toBe(false);
    expect(beyond.meetings).toEqual([]);
    expect(beyond.page.total).toBe(5);
  });

  it("keeps one person's meetings off another person's record", async () => {
    const mine = await seedPerson();
    const theirs = await seedPerson();
    const groupId = await insertGroup("Shared", "shared-group");
    const seriesId = await insertSeriesForGroup(groupId, "shared-group");
    const both = await insertOccurrence(seriesId, "2026-06-01T10:00:00.000Z");
    const onlyTheirs = await insertOccurrence(seriesId, "2026-06-08T10:00:00.000Z");
    await recordAttendance(both, mine.userId, "2026-06-01T10:00:00.000Z");
    await recordAttendance(both, theirs.userId, "2026-06-01T10:00:00.000Z");
    await recordAttendance(onlyTheirs, theirs.userId, "2026-06-08T10:00:00.000Z");

    const page = await listUserMeetingParticipation(env.DB, mine.userId, query());

    expect(page.meetings.map((entry) => entry.occurrenceId)).toEqual([both]);
  });

  it("returns an empty page for somebody who has joined no meetings", async () => {
    const person = await seedPerson();

    const page = userMeetingParticipationListResponseSchema.parse(
      await listUserMeetingParticipation(env.DB, person.userId, query()),
    );

    expect(page.meetings).toEqual([]);
    expect(page.page.total).toBe(0);
  });
});

/* ── Documents ─────────────────────────────────────────────────────────── */

describe("document contribution history", () => {
  beforeEach(resetDb);

  it("unions uploads and reviews into one chronology and says which act each was", async () => {
    const person = await seedPerson();
    const eventId = await insertEvent("conference", "Conference", "2026-05-01T09:00:00.000Z");
    const proposalId = await insertProposal(eventId, person.userId, "A talk about keys");
    await insertVersion(proposalId, person.userId, "2026-02-01T09:00:00.000Z");
    const somebodyElse = await insertProposal(
      eventId,
      await insertUser(env.DB, `author-${crypto.randomUUID()}@example.test`),
      "Somebody else's talk",
    );
    const reviewed = await insertVersion(somebodyElse, null, "2026-03-01T09:00:00.000Z", { fileName: null });
    await insertReview(reviewed, person.userId, "2026-04-01T09:00:00.000Z", "needs_revision");

    const page = userDocumentContributionListResponseSchema.parse(
      await listUserDocumentContributions(env.DB, person.userId, query()),
    );

    expect(page.documents.map((entry) => entry.contribution)).toEqual(["review", "upload"]);
    expect(page.documents[0]?.reviewStatus).toBe("needs_revision");
    expect(page.documents[0]?.proposalTitle).toBe("Somebody else's talk");
    // A version migrated from the pre-versioning columns carries no file name.
    expect(page.documents[0]?.fileName).toBeNull();
    // An upload decides nothing, so it carries no review status.
    expect(page.documents[1]?.reviewStatus).toBeNull();
    expect(page.documents[1]?.contribution).toBe("upload");
  });

  it("gives the two acts on one version their own identities", async () => {
    const person = await seedPerson();
    const eventId = await insertEvent("workshop", "Workshop", "2026-05-01T09:00:00.000Z");
    const proposalId = await insertProposal(eventId, person.userId, "Self-reviewed");
    const versionId = await insertVersion(proposalId, person.userId, "2026-02-01T09:00:00.000Z");
    await insertReview(versionId, person.userId, "2026-02-02T09:00:00.000Z");

    const page = await listUserDocumentContributions(env.DB, person.userId, query());

    expect(page.page.total).toBe(2);
    // Both point at the same version, so the version id alone could not key a row.
    expect(page.documents.map((entry) => entry.versionId)).toEqual([versionId, versionId]);
    expect(new Set(page.documents.map((entry) => entry.contributionId)).size).toBe(2);
  });

  it("excludes soft-deleted versions and soft-deleted proposals from both sides", async () => {
    const person = await seedPerson();
    const eventId = await insertEvent("archive", "Archive", "2026-05-01T09:00:00.000Z");
    const liveProposal = await insertProposal(eventId, person.userId, "Live");
    const deletedProposal = await insertProposal(eventId, person.userId, "Deleted proposal");
    await insertVersion(liveProposal, person.userId, "2026-01-01T09:00:00.000Z");
    const deletedVersion = await insertVersion(liveProposal, person.userId, "2026-01-02T09:00:00.000Z", {
      versionNumber: 2,
      deletedAt: "2026-01-03T09:00:00.000Z",
    });
    await insertReview(deletedVersion, person.userId, "2026-01-04T09:00:00.000Z");
    await insertVersion(deletedProposal, person.userId, "2026-01-05T09:00:00.000Z");
    await env.DB.prepare("UPDATE session_proposals SET deleted_at = ? WHERE id = ?")
      .bind("2026-01-06T09:00:00.000Z", deletedProposal)
      .run();

    const page = await listUserDocumentContributions(env.DB, person.userId, query());

    // The surviving upload only: the review of a deleted version goes with it.
    expect(page.documents.map((entry) => entry.occurredAt)).toEqual(["2026-01-01T09:00:00.000Z"]);
    expect(page.page.total).toBe(1);
  });

  it("pages documents at the first, last, and past-the-end boundaries", async () => {
    const person = await seedPerson();
    const eventId = await insertEvent("many", "Many", "2026-05-01T09:00:00.000Z");
    const proposalId = await insertProposal(eventId, person.userId, "Many versions");
    for (let index = 1; index <= 5; index += 1) {
      await insertVersion(proposalId, person.userId, `2026-0${index}-01T09:00:00.000Z`, { versionNumber: index });
    }

    const first = await listUserDocumentContributions(env.DB, person.userId, query({ limit: 2 }));
    const last = await listUserDocumentContributions(env.DB, person.userId, query({ limit: 2, offset: 4 }));
    const beyond = await listUserDocumentContributions(env.DB, person.userId, query({ limit: 2, offset: 12 }));

    expect(first.documents.map((entry) => entry.versionNumber)).toEqual([5, 4]);
    expect(first.page).toEqual({ limit: 2, offset: 0, total: 5, hasMore: true });
    expect(last.documents.map((entry) => entry.versionNumber)).toEqual([1]);
    expect(last.page.hasMore).toBe(false);
    expect(beyond.documents).toEqual([]);
    expect(beyond.page.total).toBe(5);
  });

  it("keeps one person's contributions off another person's record", async () => {
    const mine = await seedPerson();
    const theirs = await seedPerson();
    const eventId = await insertEvent("crossover", "Crossover", "2026-05-01T09:00:00.000Z");
    const proposalId = await insertProposal(eventId, mine.userId, "Mine");
    const versionId = await insertVersion(proposalId, mine.userId, "2026-01-01T09:00:00.000Z");
    // Somebody else reviewed my upload: their act, not mine.
    await insertReview(versionId, theirs.userId, "2026-01-02T09:00:00.000Z");

    const page = await listUserDocumentContributions(env.DB, mine.userId, query());

    expect(page.documents.map((entry) => entry.contribution)).toEqual(["upload"]);
    expect(page.page.total).toBe(1);
  });

  it("returns an empty page for somebody who has touched no document", async () => {
    const person = await seedPerson();

    const page = userDocumentContributionListResponseSchema.parse(
      await listUserDocumentContributions(env.DB, person.userId, query()),
    );

    expect(page.documents).toEqual([]);
    expect(page.page.total).toBe(0);
  });
});

/* ── Votes ─────────────────────────────────────────────────────────────── */

describe("ballot participation history", () => {
  beforeEach(resetDb);

  it("shows that somebody voted and never how they voted", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("All Members", "all-members");
    const voteId = await insertVote(groupId, "adopt-the-charter", "Adopt the charter");
    await castBallot(voteId, person, "opposed", "2026-01-15T12:00:00.000Z");

    const page = userVoteParticipationListResponseSchema.parse(
      await listUserVoteParticipation(env.DB, person.userId, query()),
    );

    expect(page.votes).toHaveLength(1);
    expect(page.votes[0]?.voteTitle).toBe("Adopt the charter");
    expect(page.votes[0]?.group.name).toBe("All Members");
    expect(page.votes[0]?.occurredAt).toBe("2026-01-15T12:00:00.000Z");
    // A vote defaults to private, so the choice is withheld — and withheld in
    // the projection, not merely dropped by the schema.
    expect(page.votes[0]?.choice).toBeNull();
    expect(JSON.stringify(page)).not.toContain("opposed");
  });

  it("publishes the choice only for a vote configured to publish a full breakdown", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("All Members", "all-members-2");

    const secret = await insertVote(groupId, "private-ballot", "Private ballot");
    await castBallot(secret, person, "opposed", "2026-01-10T12:00:00.000Z");

    const open = await insertVote(groupId, "open-ballot", "Open ballot");
    await castBallot(open, person, "in_favor", "2026-01-20T12:00:00.000Z");
    // The vote's own setting is what publishes it — nothing about the reader.
    await env.DB.prepare("UPDATE votes SET visibility = 'public', public_detail_level = 'full_breakdown' WHERE id = ?")
      .bind(open)
      .run();

    const page = userVoteParticipationListResponseSchema.parse(
      await listUserVoteParticipation(env.DB, person.userId, query()),
    );
    const byTitle = new Map(page.votes.map((entry) => [entry.voteTitle, entry]));

    expect(byTitle.get("Open ballot")?.choice).toBe("in_favor");
    expect(byTitle.get("Private ballot")?.choice).toBeNull();
    // The private ballot's value never reaches the response at all.
    expect(JSON.stringify(page)).not.toContain("opposed");
  });

  it("withholds the choice from a public vote that publishes only the outcome", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("All Members", "all-members-3");
    const voteId = await insertVote(groupId, "outcome-only", "Outcome only");
    await castBallot(voteId, person, "abstain", "2026-01-25T12:00:00.000Z");
    await env.DB.prepare("UPDATE votes SET visibility = 'public', public_detail_level = 'aggregate' WHERE id = ?")
      .bind(voteId)
      .run();

    const page = userVoteParticipationListResponseSchema.parse(
      await listUserVoteParticipation(env.DB, person.userId, query()),
    );

    // Public is not the same as identifiable: an aggregate result says how the
    // group voted, never how one member did.
    expect(page.votes[0]?.choice).toBeNull();
    expect(JSON.stringify(page)).not.toContain("abstain");
  });

  it("counts each round of an election as its own participation, newest first", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("Board", "board");
    const voteId = await insertVote(groupId, "chair-election", "Chair election", "election");
    await castBallot(voteId, person, "candidate-a", "2026-02-01T09:00:00.000Z", 1);
    await castBallot(voteId, person, "candidate-b", "2026-02-08T09:00:00.000Z", 2);

    const page = userVoteParticipationListResponseSchema.parse(
      await listUserVoteParticipation(env.DB, person.userId, query()),
    );

    expect(page.votes.map((entry) => entry.round)).toEqual([2, 1]);
    expect(page.votes[0]?.voteType).toBe("election");
    expect(JSON.stringify(page)).not.toContain("candidate-");
  });

  it("pages ballots at the first, last, and past-the-end boundaries", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("Council", "council");
    for (let index = 1; index <= 5; index += 1) {
      const voteId = await insertVote(groupId, `motion-${index}`, `Motion ${index}`);
      await castBallot(voteId, person, "in_favor", `2026-0${index}-20T09:00:00.000Z`);
    }

    const first = await listUserVoteParticipation(env.DB, person.userId, query({ limit: 4 }));
    const last = await listUserVoteParticipation(env.DB, person.userId, query({ limit: 4, offset: 4 }));
    const beyond = await listUserVoteParticipation(env.DB, person.userId, query({ limit: 4, offset: 40 }));

    expect(first.votes.map((entry) => entry.voteSlug)).toEqual(["motion-5", "motion-4", "motion-3", "motion-2"]);
    expect(first.page.hasMore).toBe(true);
    expect(last.votes.map((entry) => entry.voteSlug)).toEqual(["motion-1"]);
    expect(last.page.hasMore).toBe(false);
    expect(beyond.votes).toEqual([]);
    expect(beyond.page.total).toBe(5);
  });

  it("keeps one person's ballots off another person's record", async () => {
    const mine = await seedPerson();
    const theirs = await seedPerson();
    const groupId = await insertGroup("Electorate", "electorate");
    const shared = await insertVote(groupId, "shared-motion", "Shared motion");
    const other = await insertVote(groupId, "other-motion", "Other motion");
    await castBallot(shared, mine, "in_favor", "2026-01-01T09:00:00.000Z");
    await castBallot(shared, theirs, "opposed", "2026-01-01T09:30:00.000Z");
    await castBallot(other, theirs, "abstain", "2026-01-02T09:00:00.000Z");

    const page = await listUserVoteParticipation(env.DB, mine.userId, query());

    expect(page.votes.map((entry) => entry.voteSlug)).toEqual(["shared-motion"]);
    expect(page.page.total).toBe(1);
  });

  it("returns an empty page for somebody who has cast no ballot", async () => {
    const person = await seedPerson();

    const page = userVoteParticipationListResponseSchema.parse(
      await listUserVoteParticipation(env.DB, person.userId, query()),
    );

    expect(page.votes).toEqual([]);
    expect(page.page.total).toBe(0);
  });
});

/* ── Search, and the routes themselves ─────────────────────────────────── */

describe("participation history endpoints", () => {
  beforeEach(resetDb);

  it("filters by the shared search term inside the query rather than after it", async () => {
    const person = await seedPerson();
    const keys = await insertEvent("keys-summit", "Keys Summit", "2026-05-01T09:00:00.000Z");
    const trust = await insertEvent("trust-forum", "Trust Forum", "2026-06-01T09:00:00.000Z");
    await participate(keys, person.userId, "attendee");
    await participate(trust, person.userId, "attendee");

    const page = await listUserEventParticipation(env.DB, person.userId, query({ q: "keys" }));

    expect(page.events.map((entry) => entry.eventSlug)).toEqual(["keys-summit"]);
    // The count must narrow with the filter, not report the unfiltered set.
    expect(page.page.total).toBe(1);
  });

  it("serves all four collections under the participation resource for a users:read caller", async () => {
    const person = await seedPerson();
    const groupId = await insertGroup("Endpoint", "endpoint");
    const eventId = await insertEvent("endpoint-event", "Endpoint Event", "2026-05-01T09:00:00.000Z");
    await participate(eventId, person.userId, "attendee");
    const seriesId = await insertSeriesForGroup(groupId, "endpoint-series");
    const occurrenceId = await insertOccurrence(seriesId, "2026-05-02T10:00:00.000Z");
    await recordAttendance(occurrenceId, person.userId, "2026-05-02T10:00:00.000Z");
    const proposalId = await insertProposal(eventId, person.userId, "Endpoint deck");
    await insertVersion(proposalId, person.userId, "2026-05-03T09:00:00.000Z");
    const voteId = await insertVote(groupId, "endpoint-motion", "Endpoint motion");
    await castBallot(voteId, person, "in_favor", "2026-05-04T09:00:00.000Z");

    const token = await grantToken("users:read");

    const base = `/api/v1/users/${person.userId}/participation`;
    const events = await call(`${base}/events`, token);
    const meetings = await call(`${base}/meetings`, token);
    const documents = await call(`${base}/documents`, token);
    const votes = await call(`${base}/votes`, token);

    expect([events.status, meetings.status, documents.status, votes.status]).toEqual([200, 200, 200, 200]);
    expect(userEventParticipationListResponseSchema.parse(await events.json()).events).toHaveLength(1);
    expect(userMeetingParticipationListResponseSchema.parse(await meetings.json()).meetings).toHaveLength(1);
    expect(userDocumentContributionListResponseSchema.parse(await documents.json()).documents).toHaveLength(1);
    expect(userVoteParticipationListResponseSchema.parse(await votes.json()).votes).toHaveLength(1);
  });

  it("takes users:read for every collection and refuses a session without it", async () => {
    const person = await seedPerson();
    // Staff, but holding a different permission: the refusal must come from
    // the permission check rather than from failing to authenticate at all.
    const otherStaff = await grantToken("organizations:read");
    const reader = await grantToken("users:read");

    for (const collection of ["events", "meetings", "documents", "votes"]) {
      const path = `/api/v1/users/${person.userId}/participation/${collection}`;
      expect((await call(path)).status).toBe(401);
      expect((await call(path, otherStaff)).status).toBe(403);
      expect((await call(path, reader)).status).toBe(200);
    }
  });
});
