import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { currentUserMeetingsListResponseSchema } from "../assets/shared/schemas/member-meetings";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { createGroupEventSeries, createSeriesOccurrence } from "../functions/_lib/services/event-series";
import { buildMemberMeetingsPageQuery } from "../functions/_lib/services/event-series/member-read-model";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const ENCRYPTION_SECRET = "test-meeting-encryption-secret-0000000000000000";
const NOW = "2027-06-01T00:00:00.000Z";

async function adminActor(): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, `current-meetings-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email: "current-meetings-admin@example.test", role: "admin" };
}

async function createSeriesWithOccurrence(
  admin: UserBackedAuthAdmin,
  ownerGroupId: string,
  startsAt: string,
): Promise<{ seriesId: string; eventId: string; occurrenceId: string }> {
  const series = await createGroupEventSeries(env.DB, admin, ownerGroupId, {
    eventName: `Meeting ${crypto.randomUUID()}`,
    eventSlug: `current-meetings-${crypto.randomUUID()}`,
    profileKey: "meeting",
    policy: { registrationPolicy: "no_registration", memberEligibility: "owner_group", guestPolicy: "none" },
    startsAt,
    recurrenceRule: "FREQ=WEEKLY;COUNT=2",
    timezone: "UTC",
    durationMinutes: 60,
    providerType: null,
  });
  const occurrence = await createSeriesOccurrence(
    env.DB,
    admin,
    ownerGroupId,
    series.id,
    { startsAt, endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString() },
    ENCRYPTION_SECRET,
  );
  return { seriesId: series.id, eventId: series.eventId, occurrenceId: occurrence.id };
}

function getAs(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("GET /api/v1/users/current/meetings", () => {
  it("unions owner-group membership and event grants, excluding cancelled and past occurrences", async () => {
    const admin = await adminActor();
    const ownerGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Meetings Owner ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });
    const outsiderGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Meetings Outsider ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });
    const granteeGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Meetings Grantee ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });
    const sharedOwnerGroup = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Current Meetings Shared Owner ${crypto.randomUUID()}`,
      visibility: "public",
      eligibilityMode: "open",
    });

    const userId = await insertUser(env.DB, `current-meetings-member-${crypto.randomUUID()}@example.test`);
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, "Current Meetings Organization"),
      "A",
    );
    await addRepresentative(env.DB, memberId, userId);
    for (const groupId of [ownerGroup.id, granteeGroup.id]) {
      await joinGroup(env.DB, groupId, {
        actorUserId: userId,
        targetUserId: userId,
        selection: { mode: "all_eligible", confirmed: true },
        source: "self_service",
        allowManaged: false,
      });
    }
    const token = await createMemberSession(env.DB, userId, `current-meetings-${crypto.randomUUID()}`);

    // Reachable: caller belongs directly to the owner group.
    const ownedUpcoming = await createSeriesWithOccurrence(admin, ownerGroup.id, "2027-07-01T10:00:00.000Z");
    // Not reachable: caller has no membership or grant into this group at all.
    const outsiderUpcoming = await createSeriesWithOccurrence(admin, outsiderGroup.id, "2027-07-02T10:00:00.000Z");
    // Reachable: shared with a group the caller belongs to via an event_group_grants "register" grant.
    const shared = await createSeriesWithOccurrence(admin, sharedOwnerGroup.id, "2027-07-03T10:00:00.000Z");
    await grantResourceToGroup(env.DB, admin, sharedOwnerGroup.id, "event", shared.eventId, {
      granteeGroupId: granteeGroup.id,
      capability: "register",
    });
    // Excluded: cancelled occurrence in an otherwise-reachable group.
    const cancelled = await createSeriesWithOccurrence(admin, ownerGroup.id, "2027-07-04T10:00:00.000Z");
    await env.DB.prepare("UPDATE event_occurrences SET status = 'cancelled' WHERE id = ?")
      .bind(cancelled.occurrenceId)
      .run();
    // Excluded: reachable but starts before the "from" window (relative to `now`).
    const past = await createSeriesWithOccurrence(admin, ownerGroup.id, "2026-01-01T10:00:00.000Z");
    void outsiderUpcoming;
    void past;

    const response = await getAs(token, `/api/v1/users/current/meetings?from=${encodeURIComponent(NOW)}&limit=20`);
    expect(response.status, await response.clone().text()).toBe(200);
    const page = currentUserMeetingsListResponseSchema.parse(await response.json());
    const occurrenceIds = page.occurrences.map((occurrence) => occurrence.occurrenceId);
    expect(occurrenceIds).toContain(ownedUpcoming.occurrenceId);
    expect(occurrenceIds).toContain(shared.occurrenceId);
    expect(occurrenceIds).not.toContain(outsiderUpcoming.occurrenceId);
    expect(occurrenceIds).not.toContain(cancelled.occurrenceId);
    expect(occurrenceIds).not.toContain(past.occurrenceId);
    expect(page.page.total).toBe(2);
    // Sorted by start time ascending.
    expect(occurrenceIds).toEqual([ownedUpcoming.occurrenceId, shared.occurrenceId]);
    expect(page.occurrences.find((o) => o.occurrenceId === ownedUpcoming.occurrenceId)).toMatchObject({
      groupId: ownerGroup.id,
      groupName: ownerGroup.name,
      status: "scheduled",
    });

    // Defaults "from" to now when omitted — a far-future default in the request would find nothing.
    const defaulted = await getAs(token, "/api/v1/users/current/meetings?limit=20");
    const defaultedPage = currentUserMeetingsListResponseSchema.parse(await defaulted.json());
    expect(defaultedPage.occurrences.map((o) => o.occurrenceId)).toContain(shared.occurrenceId);

    // Pagination is bounded.
    const firstPage = currentUserMeetingsListResponseSchema.parse(
      await (
        await getAs(token, `/api/v1/users/current/meetings?from=${encodeURIComponent(NOW)}&limit=1&offset=0`)
      ).json(),
    );
    expect(firstPage.occurrences).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, total: 2, hasMore: true });
  });

  it("rejects an unauthenticated caller and a session with no active membership", async () => {
    expect((await callApi(env, "/api/v1/users/current/meetings")).status).toBe(401);

    const staffOnlyUserId = await insertUser(env.DB, `current-meetings-staff-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffOnlyUserId).run();
    const staffToken = await createMemberSession(
      env.DB,
      staffOnlyUserId,
      `current-meetings-staff-${crypto.randomUUID()}`,
    );
    expect((await getAs(staffToken, "/api/v1/users/current/meetings")).status).toBe(403);
  });

  it("uses indexed plans for the cross-group occurrence union", async () => {
    const pageQuery = buildMemberMeetingsPageQuery(crypto.randomUUID(), { from: NOW, limit: 20, offset: 0 });
    const { pageSql, bindings } = buildOffsetPageSql(pageQuery);
    const plan = await queryAll<{ detail: string }>(env.DB, `EXPLAIN QUERY PLAN ${pageSql}`, [
      ...bindings,
      pageQuery.limit,
      pageQuery.offset,
    ]);
    const details = plan.map((row) => row.detail).join("\n");
    expect(details).toMatch(/idx_event_occurrences_upcoming|idx_event_series_active/);
  });
});
