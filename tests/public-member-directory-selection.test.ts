/**
 * What the public member directory can be asked to show.
 *
 * The published site mounts one directory component in several places: every
 * member, the independents, one working group's participants, one membership
 * category, or a group and a category together. A group is named by its own
 * slug, so a task force created under a working group is addressed exactly the
 * way its parent is — that is the part these tests hold, because it is what
 * lets a new group be created without touching the page that lists it.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { publicMembersListResponseSchema } from "../assets/shared/schemas/members-directory";
import { callApi } from "./helpers/app";
import { ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createGroup } from "../functions/_lib/services/groups";
import { first } from "../functions/_lib/db/queries";
import type { AuthAdmin } from "../functions/_lib/types";

const ADMIN: AuthAdmin = { id: "directory-admin", role: "admin" } as AuthAdmin;

/** The canonical groups are seeded already; a test names one rather than remaking it. */
async function groupIdForSlug(slug: string): Promise<string> {
  const row = await first<{ id: string }>(env.DB, "SELECT id FROM groups WHERE slug = ?", [slug]);
  if (!row) throw new Error(`No seeded group with slug ${slug}`);
  return row.id;
}

async function listMembers(query: string): Promise<string[]> {
  const response = await callApi(env as never, `/api/v1/members?${query}`);
  expect(response.status).toBe(200);
  const body = publicMembersListResponseSchema.parse(await response.json());
  return body.members.map((member) => member.name).sort();
}

/** One organization with one representative who can hold group seats. */
async function seedOrganizationMember(name: string, category: string): Promise<string> {
  const organizationId = await insertOrganization(env.DB, name);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, category);
  const userId = await insertUser(env.DB, `${name.replace(/\W+/g, "-").toLowerCase()}@example.test`);
  await addRepresentative(env.DB, memberId, userId, { jobTitle: "Delegate" });
  return userId;
}

describe("public member directory selection", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists one group's participants, and a task force under it lists only its own", async () => {
    const parentId = await groupIdForSlug("pqc");
    // A subgroup: the PQCMM task force inside the PQC working group.
    const taskForce = await createGroup(env.DB, ADMIN, {
      name: "PQC Maturity Model",
      parentGroupId: parentId,
      slug: "pqc-pqcmm",
      typeKey: "task_force",
    });

    const inBoth = await seedOrganizationMember("Alpha Trust", "A");
    const parentOnly = await seedOrganizationMember("Beta Systems", "A");
    // An outsider, to prove the filter excludes rather than merely orders.
    await seedOrganizationMember("Gamma Labs", "A");

    await ensureGroupMembershipCapacity(env.DB, parentId, inBoth);
    await ensureGroupMembershipCapacity(env.DB, parentId, parentOnly);
    // The child seat is explicit; membership in the parent does not imply it.
    await ensureGroupMembershipCapacity(env.DB, taskForce.id, inBoth);

    expect(await listMembers("group=all&workingGroup=pqc")).toEqual(["Alpha Trust", "Beta Systems"]);
    expect(await listMembers("group=all&workingGroup=pqc-pqcmm")).toEqual(["Alpha Trust"]);
    // Everyone is still in the unfiltered directory, including the outsider.
    expect(await listMembers("group=all")).toContain("Gamma Labs");
  });

  it("narrows to one membership category, and to a category within a group", async () => {
    const groupId = await groupIdForSlug("cm");

    const categoryA = await seedOrganizationMember("Delta CA", "A");
    const categoryB = await seedOrganizationMember("Epsilon Vendor", "B");
    await ensureGroupMembershipCapacity(env.DB, groupId, categoryA);
    await ensureGroupMembershipCapacity(env.DB, groupId, categoryB);
    await seedOrganizationMember("Zeta Outsider", "A");

    expect(await listMembers("group=all&membershipCategory=A")).toEqual(["Delta CA", "Zeta Outsider"]);
    expect(await listMembers("group=all&workingGroup=cm&membershipCategory=A")).toEqual(["Delta CA"]);
    expect(await listMembers("group=all&workingGroup=cm")).toEqual(["Delta CA", "Epsilon Vendor"]);
  });

  it("drops a participant whose seat ended and a group that was deactivated", async () => {
    const groupId = await groupIdForSlug("cbom");
    const current = await seedOrganizationMember("Eta Corp", "A");
    const former = await seedOrganizationMember("Theta Corp", "A");
    await ensureGroupMembershipCapacity(env.DB, groupId, current);
    await ensureGroupMembershipCapacity(env.DB, groupId, former);

    await env.DB.prepare("UPDATE group_memberships SET left_at = datetime('now') WHERE group_id = ? AND user_id = ?")
      .bind(groupId, former)
      .run();
    expect(await listMembers("group=all&workingGroup=cbom")).toEqual(["Eta Corp"]);

    // A dissolved group stops publishing a roster without the page changing.
    await env.DB.prepare("UPDATE groups SET active = 0 WHERE id = ?").bind(groupId).run();
    expect(await listMembers("group=all&workingGroup=cbom")).toEqual([]);
  });

  it("returns nothing rather than everything for a slug no group answers to", async () => {
    await seedOrganizationMember("Iota Ltd", "A");
    expect(await listMembers("group=all&workingGroup=no-such-group")).toEqual([]);
  });
});
