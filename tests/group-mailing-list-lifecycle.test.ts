/**
 * A mailing list's own record: its lifecycle, and who stands on it.
 *
 * Archiving and deleting are two different answers to "we are done with this
 * list" (#37). Archiving keeps everything and can be undone; deleting is only
 * for a list nothing depends on, and the rules that decide which one a caller
 * gets are what these tests pin down.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  mailingListResponseSchema,
  mailingListSubscribersResponseSchema,
} from "../assets/shared/schemas/mailing-lists";
import { createGroupMailingList } from "../functions/_lib/services/mailing-list-management/commands";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import { createGroup } from "../functions/_lib/services/groups";
import { setMailingListPreference } from "../functions/_lib/services/mailing-list-subscriptions";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

interface Fixture {
  staff: UserBackedAuthAdmin;
  staffToken: string;
  groupId: string;
  listId: string;
  listEmail: string;
}

async function staffActor(label: string): Promise<UserBackedAuthAdmin> {
  const email = `mailing-list-${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { identityType: "user", id, email, role: "admin" };
}

/** One staff-managed group with one list on it: the smallest thing a lifecycle command can act on. */
async function seedManagedList(label: string): Promise<Fixture> {
  const staff = await staffActor(label);
  const group = await createGroup(env.DB, staff, {
    typeKey: "working_group",
    name: `Mailing list ${label} ${crypto.randomUUID()}`,
    visibility: "public",
  });
  const listEmail = `${label}-${crypto.randomUUID()}@lists.example.test`;
  const list = await createGroupMailingList(env.DB, staff, group.id, {
    email: listEmail,
    label: `${label} list`,
    purpose: "group",
    subscriptionDefault: "group_members",
  });
  return {
    staff,
    staffToken: await createAdminSession(env.DB, staff.id, crypto.randomUUID()),
    groupId: group.id,
    listId: list.id,
    listEmail,
  };
}

function apiCall(fixture: Fixture, path: string, method = "GET", body?: unknown): Promise<Response> {
  return callApi(env, path, {
    method,
    headers: {
      authorization: `Bearer ${fixture.staffToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function listPath(fixture: Fixture): string {
  return `/api/v1/groups/${fixture.groupId}/mailing-lists/${fixture.listId}`;
}

async function listState(listId: string): Promise<Array<{ active: number; archived_at: string | null }>> {
  return queryAll<{ active: number; archived_at: string | null }>(
    env.DB,
    "SELECT active, archived_at FROM mailing_lists WHERE id = ?",
    [listId],
  );
}

beforeEach(async () => {
  await resetDb();
});

describe("group mailing-list lifecycle", () => {
  it("archives a list and restores it again, keeping the record both ways", async () => {
    const fixture = await seedManagedList("round-trip");

    const archived = await apiCall(fixture, `${listPath(fixture)}/transitions`, "POST", { transition: "archive" });
    expect(archived.status, await archived.clone().text()).toBe(200);
    expect(mailingListResponseSchema.parse(await archived.json()).mailingList).toMatchObject({ active: false });
    expect(await listState(fixture.listId)).toEqual([{ active: 0, archived_at: expect.any(String) }]);

    const restored = await apiCall(fixture, `${listPath(fixture)}/transitions`, "POST", { transition: "restore" });
    expect(restored.status, await restored.clone().text()).toBe(200);
    expect(mailingListResponseSchema.parse(await restored.json()).mailingList).toMatchObject({
      active: true,
      archivedAt: null,
    });
    expect(await listState(fixture.listId)).toEqual([{ active: 1, archived_at: null }]);
    // Both directions are in the group's audit trail, which is what makes the
    // state reversible rather than merely re-editable.
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at, action",
        [fixture.listId],
      ),
    ).toEqual(expect.arrayContaining([{ action: "mailing_list_archived" }, { action: "mailing_list_restored" }]));
  });

  it("rejects a transition the shared contract does not name", async () => {
    const fixture = await seedManagedList("bad-transition");
    const response = await apiCall(fixture, `${listPath(fixture)}/transitions`, "POST", { transition: "cancel" });
    expect(response.status).toBe(400);
    expect(await listState(fixture.listId)).toEqual([{ active: 1, archived_at: null }]);
  });

  it("deletes a list nothing depends on", async () => {
    const fixture = await seedManagedList("disposable");

    const deleted = await apiCall(fixture, listPath(fixture), "DELETE");
    expect(deleted.status, await deleted.clone().text()).toBe(200);
    expect(await listState(fixture.listId)).toEqual([]);
    // The list is gone; the record that it existed is not.
    expect(
      await queryAll<{ action: string }>(env.DB, "SELECT action FROM audit_log WHERE entity_id = ?", [fixture.listId]),
    ).toEqual(expect.arrayContaining([{ action: "mailing_list_deleted" }]));
  });

  it("refuses to delete a list somebody has answered for", async () => {
    const fixture = await seedManagedList("answered-for");
    const member = await insertUser(env.DB, `mailing-list-subscriber-${crypto.randomUUID()}@example.test`);
    await ensureGroupMembershipCapacity(env.DB, fixture.groupId, member);
    await setMailingListPreference(env.DB, member, fixture.groupId, fixture.listId, "unsubscribed");

    const refused = await apiCall(fixture, listPath(fixture), "DELETE");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "MAILING_LIST_HAS_SUBSCRIPTION_HISTORY",
    );
    expect(await listState(fixture.listId)).toEqual([{ active: 1, archived_at: null }]);

    // The way out of the refusal is the one the message names.
    const archived = await apiCall(fixture, `${listPath(fixture)}/transitions`, "POST", { transition: "archive" });
    expect(archived.status).toBe(200);
    expect(
      await queryAll<{ preference: string }>(
        env.DB,
        "SELECT preference FROM mailing_list_subscription_preferences WHERE mailing_list_id = ?",
        [fixture.listId],
      ),
    ).toEqual([{ preference: "unsubscribed" }]);
  });

  it("refuses to delete a list another group was given", async () => {
    const fixture = await seedManagedList("shared");
    const grantee = await createGroup(env.DB, fixture.staff, {
      typeKey: "working_group",
      name: `Mailing list grantee ${crypto.randomUUID()}`,
      visibility: "public",
    });
    await grantResourceToGroup(env.DB, fixture.staff, fixture.groupId, "mailingList", fixture.listId, {
      granteeGroupId: grantee.id,
      capability: "view",
    });

    const refused = await apiCall(fixture, listPath(fixture), "DELETE");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("MAILING_LIST_SHARED_WITH_GROUP");
    expect(await listState(fixture.listId)).toEqual([{ active: 1, archived_at: null }]);
  });

  it("refuses to delete a list the mail provider already carries", async () => {
    const fixture = await seedManagedList("delivered");
    const member = await insertUser(env.DB, `mailing-list-delivered-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare(
      `INSERT INTO google_groups_membership_desired_state
         (user_id, google_group_email, desired_action, generation, updated_at)
       VALUES (?, ?, 'add_to_list', 1, datetime('now'))`,
    )
      .bind(member, fixture.listEmail)
      .run();

    const refused = await apiCall(fixture, listPath(fixture), "DELETE");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "MAILING_LIST_HAS_DELIVERY_HISTORY",
    );
    expect(await listState(fixture.listId)).toEqual([{ active: 1, archived_at: null }]);
  });

  it("refuses both commands to a manager of a different group", async () => {
    const fixture = await seedManagedList("wrong-path");
    const other = await createGroup(env.DB, fixture.staff, {
      typeKey: "working_group",
      name: `Mailing list bystander ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const otherPath = `/api/v1/groups/${other.id}/mailing-lists/${fixture.listId}`;

    expect((await apiCall(fixture, `${otherPath}/transitions`, "POST", { transition: "archive" })).status).toBe(404);
    expect((await apiCall(fixture, otherPath, "DELETE")).status).toBe(404);
    expect(await listState(fixture.listId)).toEqual([{ active: 1, archived_at: null }]);
  });
});

describe("group mailing-list subscribers", () => {
  it("answers who is on the list, and narrows and counts that in D1", async () => {
    const fixture = await seedManagedList("roster");
    const subscribed = await insertUser(env.DB, `roster-subscribed-${crypto.randomUUID()}@example.test`);
    const optedOut = await insertUser(env.DB, `roster-opted-out-${crypto.randomUUID()}@example.test`);
    for (const userId of [subscribed, optedOut]) {
      await ensureGroupMembershipCapacity(env.DB, fixture.groupId, userId);
    }
    await setMailingListPreference(env.DB, optedOut, fixture.groupId, fixture.listId, "unsubscribed");

    const all = await apiCall(fixture, `${listPath(fixture)}/subscribers?limit=50`);
    expect(all.status, await all.clone().text()).toBe(200);
    const roster = mailingListSubscribersResponseSchema.parse(await all.json());
    expect(roster.page.total).toBe(2);
    expect(roster.subscribers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: expect.objectContaining({ id: subscribed }), subscribed: true }),
        expect.objectContaining({
          user: expect.objectContaining({ id: optedOut }),
          subscribed: false,
          preference: "unsubscribed",
        }),
      ]),
    );

    // The filter is a query the server answers, so the page total moves with it.
    const onlySubscribed = await apiCall(fixture, `${listPath(fixture)}/subscribers?subscribed=true`);
    const subscribedPage = mailingListSubscribersResponseSchema.parse(await onlySubscribed.json());
    expect(subscribedPage.page.total).toBe(1);
    expect(subscribedPage.subscribers[0]?.user.id).toBe(subscribed);

    // And so is the search.
    const searched = await apiCall(
      fixture,
      `${listPath(fixture)}/subscribers?q=${encodeURIComponent("roster-opted-out")}`,
    );
    const searchedPage = mailingListSubscribersResponseSchema.parse(await searched.json());
    expect(searchedPage.page.total).toBe(1);
    expect(searchedPage.subscribers[0]?.user.id).toBe(optedOut);
  });

  it("does not disclose a roster through a group that does not manage the list", async () => {
    const fixture = await seedManagedList("roster-guard");
    const other = await createGroup(env.DB, fixture.staff, {
      typeKey: "working_group",
      name: `Roster bystander ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const response = await apiCall(fixture, `/api/v1/groups/${other.id}/mailing-lists/${fixture.listId}/subscribers`);
    expect(response.status).toBe(404);
  });
});
