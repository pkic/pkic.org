import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupSchema, type Group } from "../assets/shared/schemas/groups";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { grantAdministrator } from "./helpers/administrator";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertGroupSeat } from "./helpers/person-profile";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrgRepresentative,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { joinGroup } from "../functions/_lib/services/groups/membership";
import { resetDb } from "./helpers/reset-db";

let token: string;
async function command(path: string, method: string, body?: unknown, bearer = token) {
  return callApi(env, `/api/v1/groups${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function createGroup(extra: Record<string, unknown> = {}) {
  const response = await command("", "POST", {
    typeKey: "working_group",
    name: "Seat publication",
    slug: "seat-publication",
    visibility: "authenticated",
    ...extra,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return groupSchema.parse(((await response.json()) as { group: unknown }).group);
}
async function fixture(options: { publicRoster?: boolean; publicListing?: boolean; organization?: boolean } = {}) {
  const group = await createGroup({
    publicRoster: options.publicRoster ?? true,
    visibility: options.publicListing ? "public" : "authenticated",
  });
  const person = options.organization ? await insertOrgRepresentative(env.DB) : await insertIndividualMember(env.DB);
  await insertGroupSeat("seat-profile-anchor", { publicRoster: true }, person);
  await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  return { group, person };
}
async function add(group: Group, person: { userId: string; memberId: string }, extra: Record<string, unknown> = {}) {
  const response = await command(`/${group.id}/memberships/${person.userId}`, "POST", {
    capacitySelection: { mode: "selected", memberIds: [person.memberId] },
    ...extra,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const [{ id }] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM group_memberships WHERE group_id=? AND user_id=? AND member_id=? ORDER BY created_at DESC LIMIT 1",
    [group.id, person.userId, person.memberId],
  );
  return id;
}
async function projection() {
  const value = await readSitePublicationSnapshot(env.DB, []);
  return { groups: value.groups, members: value.groupMembers, people: value.people };
}
const requests = (groupId: string) =>
  queryAll(
    env.DB,
    "SELECT id FROM site_publication_requests WHERE resource_type='group_content' AND resource_id=? ORDER BY sequence",
    [groupId],
  );

beforeEach(async () => {
  await resetDb();
  const userId = await insertUser(env.DB, "seat-publication-admin@example.test");
  await grantAdministrator(env.DB, userId);
  token = await createAdminSession(env.DB, userId, "seat-publication-admin-token");
});

describe("publication after group seat changes", () => {
  it.each([
    { publicRoster: true, changed: true },
    { publicRoster: false, changed: false },
    { publicRoster: false, publicListing: true, changed: false },
    { publicRoster: false, publicListing: true, organization: true, changed: true },
  ])("publishes changed joins and leaves: %j", async ({ changed, ...options }) => {
    const f = await fixture(options);
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    const id = await add(f.group, f.person);
    if (changed) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + Number(changed));
    const joined = await projection();
    expect((await command(`/${f.group.id}/memberships/${id}`, "DELETE")).status).toBe(200);
    if (changed) expect(await projection()).not.toEqual(joined);
    else expect(await projection()).toEqual(joined);
    expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + 2 * Number(changed));
  });

  it("keeps duplicate self-service joins quiet", async () => {
    const f = await fixture();
    const bearer = await createMemberSession(env.DB, f.person.userId, "seat-publication-member-token");
    const body = { mode: "selected", memberIds: [f.person.memberId] };
    expect((await command(`/${f.group.id}/join`, "POST", { capacitySelection: body }, bearer)).status).toBe(200);
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    expect((await command(`/${f.group.id}/join`, "POST", { capacitySelection: body }, bearer)).status).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests(f.group.id)).toEqual(beforeRequests);
    expect((await command(`/${f.group.id}/leave`, "POST", body, bearer)).status).toBe(200);
    expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + 1);
  });

  it("keeps an organization's exported group entry while another live representative remains", async () => {
    const f = await fixture({ publicRoster: false, publicListing: true, organization: true });
    const otherUser = await insertUser(env.DB, "other-seated-representative@example.test");
    await addRepresentative(env.DB, f.person.memberId, otherUser);
    await add(f.group, { userId: otherUser, memberId: f.person.memberId });
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    const id = await add(f.group, f.person);
    expect(await projection()).toEqual(before);
    expect(await requests(f.group.id)).toEqual(beforeRequests);
    expect((await command(`/${f.group.id}/memberships/${id}`, "DELETE")).status).toBe(200);
    expect(await projection()).toEqual(before);
    expect(await requests(f.group.id)).toEqual(beforeRequests);
  });

  it.each([false, true])("publishes former-seat history only for public rosters: %s", async (publicRoster) => {
    const f = await fixture({ publicRoster, publicListing: true, organization: true });
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    await add(f.group, f.person, { joinedAt: "2020-01-01T00:00:00.000Z", leftAt: "2025-01-01T00:00:00.000Z" });
    if (publicRoster) expect(await projection()).not.toEqual(before);
    else expect(await projection()).toEqual(before);
    expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + Number(publicRoster));
  });

  it.each([false, true])(
    "publishes interval edits, closing and reopening precisely (roster=%s)",
    async (publicRoster) => {
      const f = await fixture({ publicRoster, publicListing: true, organization: true });
      const id = await add(f.group, f.person);
      let count = (await requests(f.group.id)).length;
      for (const [patch, changed] of [
        [{ joinedAt: "2020-01-01T00:00:00.000Z" }, publicRoster],
        [{ joinedAt: "2020-01-01T00:00:00.000Z" }, false],
        [{ leftAt: "2025-01-01T00:00:00.000Z" }, true],
        [{ leftAt: null }, true],
      ] as const) {
        const before = await projection();
        expect((await command(`/${f.group.id}/memberships/${id}`, "PATCH", patch)).status).toBe(200);
        if (changed) expect(await projection()).not.toEqual(before);
        else expect(await projection()).toEqual(before);
        count += Number(changed);
        expect(await requests(f.group.id)).toHaveLength(count);
      }
    },
  );

  it.each([false, true])(
    "publishes descendants only when the last parent capacity ends (alternative=%s)",
    async (alternative) => {
      const f = await fixture({ publicRoster: false, organization: true });
      const org = await insertOrganization(env.DB, "Descendant seat organization");
      const memberId = await seedOrganizationAggregate(env.DB, org, "A");
      await addRepresentative(env.DB, memberId, f.person.userId);
      const descendantPerson = { userId: f.person.userId, memberId };
      const rootSeat = await add(f.group, f.person);
      if (alternative) await add(f.group, descendantPerson);
      const child = await createGroup({ name: "Private child", slug: "private-child", parentGroupId: f.group.id });
      const grandchild = await createGroup({
        name: "Public grandchild",
        slug: "public-grandchild",
        parentGroupId: child.id,
        publicRoster: true,
      });
      await add(child, descendantPerson);
      const descendantSeat = await add(grandchild, descendantPerson);
      const before = await projection();
      const beforeRequests = await requests(f.group.id);
      expect((await command(`/${f.group.id}/memberships/${rootSeat}`, "DELETE")).status).toBe(200);
      if (alternative) expect(await projection()).toEqual(before);
      else expect(await projection()).not.toEqual(before);
      expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + Number(!alternative));
      const [{ left_at }] = await queryAll<{ left_at: string | null }>(
        env.DB,
        "SELECT left_at FROM group_memberships WHERE id=?",
        [descendantSeat],
      );
      expect(left_at === null).toBe(alternative);
    },
  );

  it.each(["local", "inherited"].flatMap((scope) => ["DELETE", "PATCH"].map((method) => ({ scope, method }))))(
    "publishes $scope leadership closed through $method",
    async ({ scope, method }) => {
      const f = await fixture({ publicRoster: false });
      const id = await add(f.group, f.person);
      if (scope === "local")
        expect((await command(`/${f.group.id}`, "PATCH", { publicLeadership: true })).status).toBe(200);
      else
        await createGroup({
          name: "Published child leadership",
          slug: "published-child-leadership",
          parentGroupId: f.group.id,
          publicLeadership: true,
        });
      await grantGroupLeadershipCapacity(env.DB, f.group.id, f.person.userId);
      const before = await projection();
      const beforeRequests = await requests(f.group.id);
      expect(
        (
          await command(
            `/${f.group.id}/memberships/${id}`,
            method,
            method === "PATCH" ? { leftAt: nowIso() } : undefined,
          )
        ).status,
      ).toBe(200);
      expect(await projection()).not.toEqual(before);
      expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + 1);
    },
  );

  it("keeps the losing concurrent join from adding a second request or audit", async () => {
    const f = await fixture();
    const options = {
      actorUserId: f.person.userId,
      targetUserId: f.person.userId,
      selection: { mode: "selected" as const, memberIds: [f.person.memberId] },
      source: "self_service" as const,
      allowManaged: false,
    };
    let winner: Awaited<ReturnType<typeof projection>> | undefined;
    let winningRequests: Awaited<ReturnType<typeof requests>> = [];
    let winningAudits: unknown[] = [];
    const db = mutateBeforeNextBatch(env.DB, async () => {
      await joinGroup(env.DB, f.group.id, options);
      winner = await projection();
      winningRequests = await requests(f.group.id);
      winningAudits = await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='group_joined' ORDER BY id");
    });
    await joinGroup(db, f.group.id, options);
    expect(winner).toBeDefined();
    expect(await projection()).toEqual(winner);
    expect(await requests(f.group.id)).toEqual(winningRequests);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='group_joined' ORDER BY id")).toEqual(
      winningAudits,
    );
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id=? AND user_id=?", [
        f.group.id,
        f.person.userId,
      ]),
    ).toHaveLength(1);
  });

  it.each(
    ["join", "former", "leave", "edit"].flatMap((operation) =>
      ["request", "audit"].map((failure) => ({ operation, failure })),
    ),
  )("rolls back $operation after $failure failure and retries", async ({ operation, failure }) => {
    const f = await fixture();
    const id = ["leave", "edit"].includes(operation) ? await add(f.group, f.person) : null;
    const path = id ? `/${f.group.id}/memberships/${id}` : `/${f.group.id}/memberships/${f.person.userId}`;
    const method = operation === "leave" ? "DELETE" : operation === "edit" ? "PATCH" : "POST";
    const body =
      operation === "leave"
        ? undefined
        : operation === "edit"
          ? { joinedAt: "2020-01-01T00:00:00.000Z" }
          : {
              capacitySelection: { mode: "selected", memberIds: [f.person.memberId] },
              ...(operation === "former"
                ? { joinedAt: "2020-01-01T00:00:00.000Z", leftAt: "2025-01-01T00:00:00.000Z" }
                : {}),
            };
    const action =
      operation === "join"
        ? "group_joined"
        : operation === "former"
          ? "group_former_membership_recorded"
          : operation === "leave"
            ? "group_left"
            : "group_membership_updated";
    const before = await projection();
    const beforeRequests = await requests(f.group.id);
    const audits = await queryAll(env.DB, "SELECT id FROM audit_log WHERE action=? ORDER BY id", [action]);
    const seats = await queryAll(
      env.DB,
      "SELECT id,joined_at,left_at FROM group_memberships WHERE group_id=? ORDER BY id",
      [f.group.id],
    );
    await env.DB.prepare(`CREATE TRIGGER fail_seat_publication BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        ${failure === "audit" ? `WHEN NEW.action='${action}'` : ""}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SEAT_PUBLICATION_FAILURE'); END`).run();
    try {
      expect((await command(path, method, body)).status).toBe(500);
      expect(await projection()).toEqual(before);
      expect(await requests(f.group.id)).toEqual(beforeRequests);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action=? ORDER BY id", [action])).toEqual(audits);
      expect(
        await queryAll(env.DB, "SELECT id,joined_at,left_at FROM group_memberships WHERE group_id=? ORDER BY id", [
          f.group.id,
        ]),
      ).toEqual(seats);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_seat_publication").run();
    }
    expect((await command(path, method, body)).status).toBe(200);
    expect(await projection()).not.toEqual(before);
    expect(await requests(f.group.id)).toHaveLength(beforeRequests.length + 1);
  });
});
