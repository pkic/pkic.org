import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { groupDirectoryResponseSchema } from "../assets/shared/schemas/group-directory";
import { callApi } from "./helpers/app";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function insertGroup(options: {
  slug: string;
  name: string;
  typeKey?: string;
  parentGroupId?: string | null;
  visibility?: "public" | "authenticated" | "participants" | "managed";
  publicLeadership?: boolean;
  governanceInheritanceMode?: "inherited" | "local_only";
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups
       (id, type_key, parent_group_id, name, slug, description, visibility,
        governance_inheritance_mode, eligibility_mode, automatic_enrollment_mode,
        allow_automatic_opt_out, public_leadership, min_endorsers_for_ballot,
        active, revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'none', 1, ?, 0, 1, 0,
             datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      options.typeKey ?? "working_group",
      options.parentGroupId ?? null,
      options.name,
      options.slug,
      `${options.name} description`,
      options.visibility ?? "public",
      options.governanceInheritanceMode ?? "inherited",
      options.publicLeadership === false ? 0 : 1,
    )
    .run();
  return id;
}

async function insertLeader(
  groupId: string,
  roleId: "role-group_lead" | "role-group_deputy_lead",
  name: string,
  jobTitle: string | null = null,
) {
  const userId = crypto.randomUUID();
  const [firstName, ...rest] = name.split(" ");
  await env.DB.prepare(
    `INSERT INTO users
       (id, email, normalized_email, first_name, last_name, job_title, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
  )
    .bind(userId, `${userId}@example.test`, `${userId}@example.test`, firstName, rest.join(" ") || null, jobTitle)
    .run();
  if (jobTitle !== null) {
    const organizationId = await insertOrganization(env.DB, `${name} Organization`);
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId, { jobTitle });
  }
  await grantGroupLeadershipCapacity(env.DB, groupId, userId, { roleId });
  return userId;
}

describe("public generic group directory", () => {
  beforeEach(resetDb);

  it("renders every configured group type and its effective public leadership", async () => {
    const parentId = await insertGroup({ slug: "directory-parent", name: "Directory Parent" });
    const childId = await insertGroup({
      slug: "directory-committee",
      name: "Directory Committee",
      typeKey: "committee",
      parentGroupId: parentId,
    });
    await insertLeader(parentId, "role-group_lead", "Parent Leader");
    await insertLeader(childId, "role-group_deputy_lead", "Local Deputy", "Deputy PKI Officer");

    const response = await callApi(env as any, "/api/v1/groups/directory-committee/directory");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    const payload = (await response.json()) as { group: Record<string, unknown> };
    expect(payload.group).not.toHaveProperty("participantCount");
    expect(payload.group).not.toHaveProperty("eligibilityMode");
    const directory = groupDirectoryResponseSchema.parse(payload);
    expect(directory.group.type).toMatchObject({ key: "committee", singularLabel: "Committee" });
    expect(directory.leadership).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleId: "role-group_deputy_lead",
          inherited: false,
          person: expect.objectContaining({ name: "Local Deputy", jobTitle: "Deputy PKI Officer" }),
        }),
        expect.objectContaining({
          roleId: "role-group_lead",
          inherited: true,
          sourceGroup: expect.objectContaining({ id: parentId }),
          person: expect.objectContaining({ name: "Parent Leader" }),
        }),
      ]),
    );
  });

  it("does not disclose a non-public inherited source group", async () => {
    const parentId = await insertGroup({
      slug: "private-directory-parent",
      name: "Private Directory Parent",
      visibility: "managed",
    });
    await insertGroup({
      slug: "public-directory-child",
      name: "Public Directory Child",
      parentGroupId: parentId,
    });
    await insertLeader(parentId, "role-group_lead", "Inherited Leader");

    const response = await callApi(env as any, "/api/v1/groups/public-directory-child/directory");
    expect(response.status).toBe(200);
    const directory = groupDirectoryResponseSchema.parse(await response.json());
    expect(directory.leadership).toEqual([
      expect.objectContaining({
        inherited: true,
        sourceGroup: null,
        person: expect.objectContaining({ name: "Inherited Leader" }),
      }),
    ]);
  });

  it("does not expose leadership when public leadership is disabled", async () => {
    const groupId = await insertGroup({
      slug: "private-leadership",
      name: "Private Leadership",
      publicLeadership: false,
    });
    await insertLeader(groupId, "role-group_lead", "Hidden Leader");

    const response = await callApi(env as any, "/api/v1/groups/private-leadership/directory");
    expect(response.status).toBe(200);
    expect(groupDirectoryResponseSchema.parse(await response.json()).leadership).toEqual([]);
  });

  it("fails closed for a group that is not publicly visible", async () => {
    await insertGroup({
      slug: "participant-directory",
      name: "Participant Directory",
      visibility: "participants",
    });

    const response = await callApi(env as any, "/api/v1/groups/participant-directory/directory");
    expect(response.status).toBe(404);
  });
});
