/**
 * Governance rosters on ordinary groups: dated seats, leadership
 * terms with titles and tenures, and the public directory that renders the
 * Board of Directors, Executive Council, and consortium-chair pages from them.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupDirectoryResponseSchema } from "../assets/shared/schemas/group-directory";
import {
  groupLeadershipCandidatesListResponseSchema,
  groupLeadershipListResponseSchema,
  groupMembershipMutationResponseSchema,
  groupMembershipsManagementListResponseSchema,
} from "../assets/shared/schemas/groups";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { activeIdentityIdForMember, ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createGroup } from "../functions/_lib/services/groups";

const BOARD_SLUG = "board";
const DAY = 24 * 60 * 60 * 1000;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString();
}

async function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return callApi(env as never, path, { ...init, headers });
}

/** Parses a response that must have succeeded, surfacing the API error body when it did not. */
async function okJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${body}`);
  return JSON.parse(body) as unknown;
}

async function seedAdmin(): Promise<{ id: string; token: string }> {
  const id = await insertUser(env.DB, `governance-admin-${crypto.randomUUID()}@example.test`);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  return { id, token: await createAdminSession(env.DB, id, `governance-admin-${crypto.randomUUID()}`) };
}

async function seedRepresentative(
  name: [string, string],
  organizationName: string,
): Promise<{ userId: string; memberId: string; identityId: string }> {
  const userId = await insertUser(env.DB, `${name[0]}.${name[1]}-${crypto.randomUUID().slice(0, 8)}@example.test`);
  await env.DB.prepare("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?")
    .bind(name[0], name[1], userId)
    .run();
  const organizationId = await insertOrganization(env.DB, organizationName);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
  const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Director" });
  return { userId, memberId, identityId };
}

async function boardGroupId(): Promise<string> {
  const [row] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM groups WHERE slug = ?", [BOARD_SLUG]);
  return row.id;
}

describe("governance rosters on groups", () => {
  beforeEach(resetDb);

  it("seeds the Board of Directors and Executive Council as roster-publishing board groups with chair titles", async () => {
    const groups = await queryAll<{ slug: string; type_key: string; public_leadership: number; public_roster: number }>(
      env.DB,
      "SELECT slug, type_key, public_leadership, public_roster FROM groups WHERE slug IN ('board', 'executive-council') ORDER BY slug",
    );
    expect(groups).toEqual([
      { slug: "board", type_key: "board", public_leadership: 1, public_roster: 1 },
      { slug: "executive-council", type_key: "board", public_leadership: 1, public_roster: 1 },
    ]);
    const types = await queryAll<{ key: string; lead_title: string; deputy_lead_title: string }>(
      env.DB,
      "SELECT key, lead_title, deputy_lead_title FROM group_types WHERE key IN ('board', 'task_force', 'working_group') ORDER BY key",
    );
    expect(types).toEqual([
      { key: "board", lead_title: "Chair", deputy_lead_title: "Vice Chair" },
      { key: "task_force", lead_title: "Lead", deputy_lead_title: "Deputy Lead" },
      { key: "working_group", lead_title: "Chair", deputy_lead_title: "Vice Chair" },
    ]);
    const typesResponse = await call(null, "/api/v1/groups/types?limit=50");
    const typesBody = (await typesResponse.json()) as {
      groupTypes: Array<{ key: string; leadershipTitles: { lead: string; deputyLead: string } }>;
    };
    expect(typesBody.groupTypes.find((type) => type.key === "task_force")?.leadershipTitles).toEqual({
      lead: "Lead",
      deputyLead: "Deputy Lead",
    });
  });

  it("records service dates, rejects competing titles, and preserves legacy history", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const director = await seedRepresentative(["Mads", "Henriksveen"], "Buypass");

    const added = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${director.userId}`, {
      method: "POST",
      body: JSON.stringify({
        capacitySelection: { mode: "all_eligible", confirmed: true },
        joinedAt: "2022-06-01T00:00:00.000Z",
      }),
    });
    expect(added.status).toBe(200);
    const mutation = groupMembershipMutationResponseSchema.parse(await added.json());
    expect(mutation.memberships).toMatchObject([
      {
        userId: director.userId,
        memberId: director.memberId,
        title: null,
        joinedAt: "2022-06-01T00:00:00.000Z",
      },
    ]);
    const seatId = mutation.memberships[0].id;
    // Preserve old records without letting a legacy label impersonate current leadership.
    await env.DB.prepare("UPDATE group_memberships SET title = ? WHERE id = ?").bind("Treasurer", seatId).run();
    const titleEdit = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seatId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Chair" }),
    });
    expect(titleEdit.status).toBe(400);
    const titleAdd = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${director.userId}`, {
      method: "POST",
      body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true }, title: "Chair" }),
    });
    expect(titleAdd.status).toBe(400);

    const current = groupMembershipsManagementListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${groupId}/memberships?active=true&sort=joined_at`)).json(),
    );
    expect(current.memberships.map((seat) => seat.id)).toEqual([seatId]);
    expect(current.memberships[0].title).toBeNull();

    const closed = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seatId}`, {
      method: "PATCH",
      body: JSON.stringify({ leftAt: "2025-02-01T00:00:00.000Z" }),
    });
    expect(closed.status).toBe(200);
    expect(groupMembershipMutationResponseSchema.parse(await closed.json())).toMatchObject({
      memberships: [],
      endedMembershipIds: [seatId],
    });

    const former = groupMembershipsManagementListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${groupId}/memberships?active=false&sort=-left_at`)).json(),
    );
    expect(former.memberships).toMatchObject([
      { id: seatId, title: "Treasurer", joinedAt: "2022-06-01T00:00:00.000Z", leftAt: "2025-02-01T00:00:00.000Z" },
    ]);

    /*
     * One seat by its own id is a request for that seat, whatever its state.
     * The current/former flag defaults to "current" for a caller that names
     * none, so a page addressed by a seat id — the seat editor — would
     * otherwise never find an ended one.
     */
    const byId = groupMembershipsManagementListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${groupId}/memberships?membershipId=${seatId}`)).json(),
    );
    expect(byId.memberships).toMatchObject([{ id: seatId, leftAt: "2025-02-01T00:00:00.000Z" }]);
    // And it is still one seat, not a filter anybody can widen: a seat in
    // another group is not reachable through this group's roster.
    const [allMembers] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM groups WHERE slug = 'all-members'");
    const otherGroup = groupMembershipsManagementListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${allMembers.id}/memberships?membershipId=${seatId}`)).json(),
    );
    expect(otherGroup.memberships).toEqual([]);

    const invalid = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seatId}`, {
      method: "PATCH",
      body: JSON.stringify({ leftAt: "2021-01-01T00:00:00.000Z" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "GROUP_MEMBERSHIP_INTERVAL_INVALID" } });

    const reopened = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seatId}`, {
      method: "PATCH",
      body: JSON.stringify({ leftAt: null }),
    });
    expect(reopened.status).toBe(200);
    expect(groupMembershipMutationResponseSchema.parse(await reopened.json()).memberships).toMatchObject([
      { id: seatId, leftAt: null },
    ]);
  });

  it("records a former seat for a person whose representation has already ended", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const past = await seedRepresentative(["Kirk", "Hall"], "Entrust");
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), past.identityId)
      .run();

    const liveJoin = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${past.userId}`, {
      method: "POST",
      body: JSON.stringify({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
    });
    expect(liveJoin.status).toBe(403);

    const recorded = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${past.userId}`, {
      method: "POST",
      body: JSON.stringify({
        capacitySelection: { mode: "all_eligible", confirmed: true },
        joinedAt: "2022-06-01T00:00:00.000Z",
        leftAt: "2025-02-01T00:00:00.000Z",
      }),
    });
    expect(recorded.status).toBe(200);
    const seats = await queryAll<{ member_id: string; title: string; left_at: string }>(
      env.DB,
      "SELECT member_id, title, left_at FROM group_memberships WHERE group_id = ? AND user_id = ?",
      [groupId, past.userId],
    );
    expect(seats).toEqual([{ member_id: past.memberId, title: null, left_at: "2025-02-01T00:00:00.000Z" }]);
    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE scope_type = 'group' AND scope_id = ? AND action = 'group_former_membership_recorded'",
      [groupId],
    );
    expect(audit).toHaveLength(1);
  });

  /*
   * Issue #29: the title was a free text box, so a chair was something a
   * manager had to know to write. It is a choice now, and the choices are
   * reference data — a row in `group_leadership_titles` — rather than a list
   * compiled into the bundle, so a new title is added without a deploy and
   * every surface offers the same vocabulary.
   */
  describe("the title vocabulary a group offers", () => {
    it("answers the active reference rows in their curated order, the group type's own title first", async () => {
      const admin = await seedAdmin();
      const leadership = groupLeadershipListResponseSchema.parse(
        await okJson(await call(admin.token, `/api/v1/groups/${await boardGroupId()}/leadership`)),
      );
      expect(leadership.titles).toEqual({ lead: "Chair", deputyLead: "Vice Chair" });
      expect(leadership.titleOptions).toEqual({
        lead: ["Chair", "Co-Chair", "Lead", "Co-Lead", "President"],
        deputyLead: ["Vice Chair", "Deputy Lead", "Deputy Chair", "Vice President", "Secretary"],
      });
    });

    it("promotes a type's own title to the front of its role's vocabulary without repeating it", async () => {
      const admin = await seedAdmin();
      // A task force calls its two roles Lead and Deputy Lead, and both words
      // are also shared vocabulary — so this is the case where naive
      // concatenation would offer "Lead" twice and rank it third.
      const taskForce = await createGroup(
        env.DB,
        { identityType: "user", id: admin.id, email: "", role: "admin" },
        { typeKey: "task_force", name: "Interop Task Force", slug: "interop-task-force" },
      );
      const leadership = groupLeadershipListResponseSchema.parse(
        await okJson(await call(admin.token, `/api/v1/groups/${taskForce.id}/leadership`)),
      );
      expect(leadership.titleOptions.lead[0]).toBe("Lead");
      expect(leadership.titleOptions.lead.filter((title) => title === "Lead")).toHaveLength(1);
      expect(leadership.titleOptions.deputyLead[0]).toBe("Deputy Lead");
      expect(leadership.titleOptions.deputyLead.filter((title) => title === "Deputy Lead")).toHaveLength(1);
    });

    it("offers a title the consortium adds as a row, and stops offering one it retires", async () => {
      const admin = await seedAdmin();
      const groupId = await boardGroupId();
      const options = async (): Promise<string[]> =>
        groupLeadershipListResponseSchema.parse(
          await okJson(await call(admin.token, `/api/v1/groups/${groupId}/leadership`)),
        ).titleOptions.deputyLead;
      try {
        await env.DB.prepare(
          `INSERT INTO group_leadership_titles (role_id, title, sort_order, active, created_at, updated_at)
           VALUES ('role-group_deputy_lead', 'Convenor', 5, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        ).run();
        // Retired rows are not offered, which is the point of `active`: a word
        // the consortium has stopped using must not come back through a list
        // the frontend keeps its own copy of.
        expect(await options()).not.toContain("Convenor");

        await env.DB.prepare(
          "UPDATE group_leadership_titles SET active = 1 WHERE role_id = 'role-group_deputy_lead' AND title = 'Convenor'",
        ).run();
        // Ranked by sort_order, not by insertion: the row says where it goes.
        expect((await options())[1]).toBe("Convenor");
      } finally {
        await env.DB.prepare(
          "DELETE FROM group_leadership_titles WHERE role_id = 'role-group_deputy_lead' AND title = 'Convenor'",
        ).run();
      }
    });

    it("keeps the title an assignment already carries, whatever the vocabulary now says", async () => {
      const admin = await seedAdmin();
      const groupId = await boardGroupId();
      const secretary = await seedRepresentative(["Inigo", "Barreira"], "Sectigo");
      await ensureGroupMembershipCapacity(env.DB, groupId, secretary.userId);
      const assigned = groupLeadershipListResponseSchema.parse(
        await okJson(
          await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
            method: "POST",
            body: JSON.stringify({
              userId: secretary.userId,
              identityId: await activeIdentityIdForMember(env.DB, secretary.userId, secretary.memberId),
              roleId: "role-group_deputy_lead",
              title: "Secretary",
            }),
          }),
        ),
      );
      // The vocabulary chooses what a manager may pick next; it never rewrites
      // a term already served under a title.
      expect(assigned.assignments).toMatchObject([{ title: "Secretary", roleId: "role-group_deputy_lead" }]);
    });

    it("refuses a title longer than the contract allows rather than storing it truncated", async () => {
      const admin = await seedAdmin();
      const groupId = await boardGroupId();
      const person = await seedRepresentative(["Overlong", "Titles"], "Example Member");
      await ensureGroupMembershipCapacity(env.DB, groupId, person.userId);
      const refused = await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
        method: "POST",
        body: JSON.stringify({
          userId: person.userId,
          identityId: await activeIdentityIdForMember(env.DB, person.userId, person.memberId),
          roleId: "role-group_lead",
          title: "C".repeat(81),
        }),
      });
      expect(refused.status).toBe(400);
      expect(
        groupLeadershipListResponseSchema.parse(
          await okJson(await call(admin.token, `/api/v1/groups/${groupId}/leadership`)),
        ).assignments,
      ).toEqual([]);
    });
  });

  it("assigns titled leadership terms, defaults the title from the group type, and keeps closed terms as history", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const chair = await seedRepresentative(["Chris", "Bailey"], "Entrust");
    const formerChair = await seedRepresentative(["Kirk", "Hall"], "Former Entrust");
    await ensureGroupMembershipCapacity(env.DB, groupId, chair.userId);
    await ensureGroupMembershipCapacity(env.DB, groupId, formerChair.userId);

    const assigned = await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: chair.userId,
        identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
        roleId: "role-group_lead",
        startsAt: "2025-03-01T00:00:00.000Z",
      }),
    });
    expect(assigned.status).toBe(201);
    const afterAssign = groupLeadershipListResponseSchema.parse(await assigned.json());
    expect(afterAssign.titles).toEqual({ lead: "Chair", deputyLead: "Vice Chair" });
    expect(afterAssign.assignments).toMatchObject([
      { userId: chair.userId, title: "Chair", startsAt: "2025-03-01T00:00:00.000Z", endsAt: null, active: true },
    ]);
    expect(afterAssign.past).toEqual([]);
    const currentSeats = groupMembershipsManagementListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${groupId}/memberships?active=true`)).json(),
    );
    expect(currentSeats.memberships.find((seat) => seat.userId === chair.userId)?.title).toBe("Chair");
    expect(currentSeats.page.total).toBe(2);

    const history = await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: formerChair.userId,
        identityId: await activeIdentityIdForMember(env.DB, formerChair.userId, formerChair.memberId),
        roleId: "role-group_lead",
        title: "Board Chair",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
      }),
    });
    expect(history.status).toBe(201);
    const afterHistory = groupLeadershipListResponseSchema.parse(await history.json());
    expect(afterHistory.assignments.map((assignment) => assignment.userId)).toEqual([chair.userId]);
    expect(afterHistory.past).toMatchObject([
      {
        userId: formerChair.userId,
        title: "Board Chair",
        active: false,
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
      },
    ]);
    // A closed historical term grants nothing: the row is revoked on insert.
    const revoked = await queryAll<{ revoked_at: string | null; expires_at: string | null }>(
      env.DB,
      "SELECT revoked_at, expires_at FROM user_roles WHERE user_id = ? AND context_id = ?",
      [formerChair.userId, groupId],
    );
    expect(revoked).toEqual([{ revoked_at: "2025-02-01T00:00:00.000Z", expires_at: null }]);
  });

  /*
   * Issue #26: the leadership picker read the group's own roster, so a group
   * whose participation follows from affiliation rather than from a taken seat
   * offered nobody and answered "no matches" for people the system knows. The
   * All Members forum is exactly that group, which is why it is the fixture.
   */
  it("offers every eligible person as a leadership candidate, seated or not, and seats one on appointment", async () => {
    const admin = await seedAdmin();
    const [allMembers] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM groups WHERE slug = 'all-members'");
    const chair = await seedRepresentative(["Unseated", "Candidate"], "Unseated Org");

    // No seat exists anywhere in this group.
    expect(await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id = ?", [allMembers.id])).toHaveLength(
      0,
    );

    const listed = groupLeadershipCandidatesListResponseSchema.parse(
      await okJson(await call(admin.token, `/api/v1/groups/${allMembers.id}/leadership/candidates?q=Unseated`)),
    );
    expect(listed.candidates).toMatchObject([
      { userId: chair.userId, identityId: chair.identityId, organizationName: "Unseated Org", participating: false },
    ]);

    const assigned = await call(admin.token, `/api/v1/groups/${allMembers.id}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: chair.userId,
        identityId: chair.identityId,
        roleId: "role-group_lead",
        startsAt: "2026-01-05T00:00:00.000Z",
      }),
    });
    expect(assigned.status, await assigned.clone().text()).toBe(201);
    expect(groupLeadershipListResponseSchema.parse(await assigned.json()).assignments).toMatchObject([
      { userId: chair.userId, title: "Chair", active: true },
    ]);

    // The appointment seated them: a leader participates, and the seat carries
    // the term's own start rather than the instant the button was pressed.
    expect(
      await queryAll<{ identity_id: string; joined_at: string; left_at: string | null; source: string }>(
        env.DB,
        "SELECT identity_id, joined_at, left_at, source FROM group_memberships WHERE group_id = ? AND user_id = ?",
        [allMembers.id, chair.userId],
      ),
    ).toEqual([
      { identity_id: chair.identityId, joined_at: "2026-01-05T00:00:00.000Z", left_at: null, source: "staff" },
    ]);

    // And the candidate now reads as participating rather than appearing twice.
    const relisted = groupLeadershipCandidatesListResponseSchema.parse(
      await okJson(await call(admin.token, `/api/v1/groups/${allMembers.id}/leadership/candidates?q=Unseated`)),
    );
    expect(relisted.candidates).toMatchObject([{ identityId: chair.identityId, participating: true }]);
  });

  it("records a closed historical term without seating anybody", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const former = await seedRepresentative(["Historic", "Chair"], "Historic Org");

    const recorded = await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: former.userId,
        identityId: former.identityId,
        roleId: "role-group_lead",
        startsAt: "2019-01-01T00:00:00.000Z",
        endsAt: "2023-12-31T00:00:00.000Z",
      }),
    });
    expect(recorded.status, await recorded.clone().text()).toBe(201);
    expect(groupLeadershipListResponseSchema.parse(await recorded.json()).past).toMatchObject([
      { userId: former.userId, active: false },
    ]);

    /*
     * A closed term is a record of a role, not of participation. Writing a
     * closed seat beside it would put the same person in "Past positions"
     * twice — once as the chair they were, once as a plain member for the
     * same dates.
     */
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ?", [
        groupId,
        former.userId,
      ]),
    ).toHaveLength(0);
  });

  it("refuses to appoint somebody with no Member capacity, and writes no seat for them", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    // A bare user row: known to the system, but holding no membership of any
    // kind. Seating on appointment must not become a way around that.
    const outsiderId = await insertUser(env.DB, `outsider-${crypto.randomUUID()}@example.test`);
    const [identity] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM identities WHERE user_id = ?", [
      outsiderId,
    ]);

    const refused = await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: outsiderId,
        identityId: identity?.id ?? crypto.randomUUID(),
        roleId: "role-group_lead",
      }),
    });
    expect(refused.status, await refused.clone().text()).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("GROUP_LEADER_CAPACITY_INVALID");
    expect(
      await queryAll(env.DB, "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ?", [
        groupId,
        outsiderId,
      ]),
    ).toHaveLength(0);
  });

  it("edits a term: a future end schedules expiry, a past end closes it, and null reopens it", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const chair = await seedRepresentative(["Chris", "Bailey"], "Entrust");
    await ensureGroupMembershipCapacity(env.DB, groupId, chair.userId);
    const assigned = groupLeadershipListResponseSchema.parse(
      await (
        await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
          method: "POST",
          body: JSON.stringify({
            userId: chair.userId,
            identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
            roleId: "role-group_deputy_lead",
            startsAt: isoDaysFromNow(-10),
          }),
        })
      ).json(),
    );
    const assignment = assigned.assignments[0];
    expect(assignment.title).toBe("Vice Chair");
    const path = `/api/v1/groups/${groupId}/leadership/${assignment.userRoleId}`;

    const scheduled = isoDaysFromNow(30);
    const withExpiry = groupLeadershipListResponseSchema.parse(
      await (
        await call(admin.token, path, {
          method: "PATCH",
          body: JSON.stringify({ title: "Co-Chair", endsAt: scheduled }),
        })
      ).json(),
    );
    expect(withExpiry.assignments).toMatchObject([{ title: "Co-Chair", active: true, endsAt: scheduled }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM user_roles WHERE id = ? AND expires_at = ? AND revoked_at IS NULL", [
        assignment.userRoleId,
        scheduled,
      ]),
    ).toHaveLength(1);

    const closedAt = isoDaysFromNow(-1);
    const closed = groupLeadershipListResponseSchema.parse(
      await okJson(await call(admin.token, path, { method: "PATCH", body: JSON.stringify({ endsAt: closedAt }) })),
    );
    expect(closed.assignments).toEqual([]);
    expect(closed.past).toMatchObject([{ userRoleId: assignment.userRoleId, active: false, endsAt: closedAt }]);

    const reopened = groupLeadershipListResponseSchema.parse(
      await okJson(await call(admin.token, path, { method: "PATCH", body: JSON.stringify({ endsAt: null }) })),
    );
    expect(reopened.assignments).toMatchObject([{ userRoleId: assignment.userRoleId, active: true, endsAt: null }]);

    const backwards = await call(admin.token, path, {
      method: "PATCH",
      body: JSON.stringify({ startsAt: "2030-01-01T00:00:00.000Z", endsAt: "2029-01-01T00:00:00.000Z" }),
    });
    expect(backwards.status).toBe(400);
    expect(
      (
        await call(admin.token, `/api/v1/groups/${groupId}/leadership/${crypto.randomUUID()}`, {
          method: "PATCH",
          body: JSON.stringify({ title: "Nobody" }),
        })
      ).status,
    ).toBe(404);
  });

  it("cannot reopen a term whose seat has ended", async () => {
    const admin = await seedAdmin();
    const groupId = await boardGroupId();
    const chair = await seedRepresentative(["Chris", "Bailey"], "Entrust");
    await ensureGroupMembershipCapacity(env.DB, groupId, chair.userId);
    const assigned = groupLeadershipListResponseSchema.parse(
      await (
        await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
          method: "POST",
          body: JSON.stringify({
            userId: chair.userId,
            identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
            roleId: "role-group_lead",
          }),
        })
      ).json(),
    );
    const [seat] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM group_memberships WHERE group_id = ? AND user_id = ? AND left_at IS NULL",
      [groupId, chair.userId],
    );
    const ended = await call(admin.token, `/api/v1/groups/${groupId}/memberships/${seat.id}`, {
      method: "PATCH",
      body: JSON.stringify({ leftAt: new Date().toISOString() }),
    });
    expect(ended.status).toBe(200);
    const leadership = groupLeadershipListResponseSchema.parse(
      await (await call(admin.token, `/api/v1/groups/${groupId}/leadership`)).json(),
    );
    expect(leadership.assignments).toEqual([]);
    expect(leadership.past).toMatchObject([{ userRoleId: assigned.assignments[0].userRoleId, active: false }]);

    const reopen = await call(
      admin.token,
      `/api/v1/groups/${groupId}/leadership/${assigned.assignments[0].userRoleId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ endsAt: null }),
      },
    );
    expect(reopen.status).toBe(409);
    expect(await reopen.json()).toMatchObject({ error: { code: "GROUP_LEADER_CAPACITY_INVALID" } });
  });

  it("publishes the dated roster and leadership history through the public directory, and hides the roster when unpublished", async () => {
    const admin = await seedAdmin();
    const group = await createGroup(
      env.DB,
      { identityType: "user", id: admin.id, email: "", role: "admin" },
      {
        typeKey: "board",
        name: "Public Directory Board",
        slug: "public-directory-board",
        visibility: "public",
        publicLeadership: true,
        publicRoster: true,
      },
    );
    const groupId = group.id;
    const chair = await seedRepresentative(["Chris", "Bailey"], "Entrust");
    const member = await seedRepresentative(["Mads", "Henriksveen"], "Buypass");
    const former = await seedRepresentative(["Kirk", "Hall"], "Former Entrust");
    await ensureGroupMembershipCapacity(env.DB, groupId, chair.userId);
    await call(admin.token, `/api/v1/groups/${groupId}/memberships/${member.userId}`, {
      method: "POST",
      body: JSON.stringify({
        capacitySelection: { mode: "all_eligible", confirmed: true },
        joinedAt: "2022-06-01T00:00:00.000Z",
      }),
    });
    await call(admin.token, `/api/v1/groups/${groupId}/memberships/${former.userId}`, {
      method: "POST",
      body: JSON.stringify({
        capacitySelection: { mode: "all_eligible", confirmed: true },
        joinedAt: "2022-06-01T00:00:00.000Z",
        leftAt: "2025-02-01T00:00:00.000Z",
      }),
    });
    await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: chair.userId,
        identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
        roleId: "role-group_lead",
        startsAt: "2025-03-01T00:00:00.000Z",
      }),
    });
    await call(admin.token, `/api/v1/groups/${groupId}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: former.userId,
        identityId: await activeIdentityIdForMember(env.DB, former.userId, former.memberId),
        roleId: "role-group_lead",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
      }),
    });

    const response = await call(null, "/api/v1/groups/public-directory-board/directory");
    expect(response.status).toBe(200);
    const directory = groupDirectoryResponseSchema.parse(await response.json());
    expect(directory.leadership).toMatchObject([
      {
        roleId: "role-group_lead",
        title: "Chair",
        startsAt: "2025-03-01T00:00:00.000Z",
        endsAt: null,
        person: { name: "Chris Bailey", organizationName: "Entrust", jobTitle: "Director" },
      },
    ]);
    expect(directory.pastLeadership).toMatchObject([
      {
        title: "Chair",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
        person: { name: "Kirk Hall", organizationName: "Former Entrust" },
      },
    ]);
    expect(directory.roster?.current.map((seat) => [seat.person.name, seat.title])).toEqual([
      ["Chris Bailey", "Chair"],
      ["Mads Henriksveen", "Member"],
    ]);
    expect(directory.roster?.past).toMatchObject([
      {
        person: { name: "Kirk Hall" },
        title: "Member",
        startsAt: "2022-06-01T00:00:00.000Z",
        endsAt: "2025-02-01T00:00:00.000Z",
      },
    ]);
    const body = JSON.stringify(directory);
    expect(body).not.toContain("@example.test");

    await env.DB.prepare("UPDATE groups SET public_roster = 0 WHERE id = ?").bind(groupId).run();
    const unpublished = groupDirectoryResponseSchema.parse(
      await (await call(null, "/api/v1/groups/public-directory-board/directory")).json(),
    );
    expect(unpublished.roster).toBeNull();
    expect(unpublished.leadership).toHaveLength(1);
  });

  it("still publishes a sitting leader whose Member has lost its category assignment", async () => {
    /*
     * Issue #25, as the data actually behaves: the public leadership query
     * joined the membership-category view only to borrow a job-title fallback,
     * and joined it inner — so a leader whose Member had no category row was
     * deleted from the board list outright while still appearing on the roster
     * and in past positions. "The photo and data do not render" was the seat
     * not rendering at all.
     */
    const admin = await seedAdmin();
    const group = await createGroup(
      env.DB,
      { identityType: "user", id: admin.id, email: "", role: "admin" },
      {
        typeKey: "board",
        name: "Category Loss Board",
        slug: "category-loss-board",
        visibility: "public",
        publicLeadership: true,
        publicRoster: true,
      },
    );
    const chair = await seedRepresentative(["Grace", "Hopper"], "Uncategorized Member");
    await ensureGroupMembershipCapacity(env.DB, group.id, chair.userId);
    await call(admin.token, `/api/v1/groups/${group.id}/leadership`, {
      method: "POST",
      body: JSON.stringify({
        userId: chair.userId,
        identityId: await activeIdentityIdForMember(env.DB, chair.userId, chair.memberId),
        roleId: "role-group_lead",
        startsAt: "2025-03-01T00:00:00.000Z",
      }),
    });

    const seated = groupDirectoryResponseSchema.parse(
      await (await call(null, "/api/v1/groups/category-loss-board/directory")).json(),
    );
    expect(seated.leadership.map((assignment) => assignment.person.name)).toEqual(["Grace Hopper"]);

    await env.DB.prepare("DELETE FROM member_category_assignments WHERE member_id = ?").bind(chair.memberId).run();

    const directory = groupDirectoryResponseSchema.parse(
      await (await call(null, "/api/v1/groups/category-loss-board/directory")).json(),
    );
    expect(directory.leadership.map((assignment) => assignment.person.name)).toEqual(["Grace Hopper"]);
    // The seat and the leadership list agree about who is on the board.
    expect(directory.roster?.current.map((seat) => seat.person.name)).toEqual(["Grace Hopper"]);
  });

  it("serves the consortium chair and vice chair from the All Members group directory", async () => {
    const admin = await seedAdmin();
    const [allMembers] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM groups WHERE slug = 'all-members'");
    // The seeded All Members group survives resetDb, so restore its visibility afterwards.
    await env.DB.prepare("UPDATE groups SET visibility = 'public' WHERE id = ?").bind(allMembers.id).run();
    try {
      const chair = await seedRepresentative(["Paul", "van Brouwershaven"], "Digitorus");
      const viceChair = await seedRepresentative(["Albert", "de Ruiter"], "Logius");
      for (const person of [chair, viceChair])
        await ensureGroupMembershipCapacity(env.DB, allMembers.id, person.userId);
      for (const [person, roleId, startsAt] of [
        [chair, "role-group_lead", "2021-01-01T00:00:00.000Z"],
        [viceChair, "role-group_deputy_lead", "2022-06-01T00:00:00.000Z"],
      ] as const) {
        const response = await call(admin.token, `/api/v1/groups/${allMembers.id}/leadership`, {
          method: "POST",
          body: JSON.stringify({
            userId: person.userId,
            identityId: await activeIdentityIdForMember(env.DB, person.userId, person.memberId),
            roleId,
            startsAt,
          }),
        });
        expect(response.status).toBe(201);
      }

      const directory = groupDirectoryResponseSchema.parse(
        await (await call(null, "/api/v1/groups/all-members/directory")).json(),
      );
      expect(directory.roster).toBeNull();
      expect(
        directory.leadership.map((assignment) => [assignment.person.name, assignment.title, assignment.startsAt]),
      ).toEqual([
        ["Paul van Brouwershaven", "Chair", "2021-01-01T00:00:00.000Z"],
        ["Albert de Ruiter", "Vice Chair", "2022-06-01T00:00:00.000Z"],
      ]);
      expect((await call(null, "/api/v1/leadership/consortium-chairs")).status).toBe(404);
      expect((await call(admin.token, "/api/v1/leadership/positions?body=board")).status).toBe(404);
    } finally {
      await env.DB.prepare("UPDATE groups SET visibility = 'authenticated' WHERE id = ?").bind(allMembers.id).run();
    }
  });
});
