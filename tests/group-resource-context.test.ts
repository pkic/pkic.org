import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  requireGroupManagementActor,
  requireGroupParticipantMember,
  requireGroupResourceContext,
} from "../functions/api/v1/groups/group-resource-context";
import { createGroup } from "../functions/_lib/services/groups";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function actor(email: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

beforeEach(resetDb);

describe("group resource context", () => {
  it("preserves member-only participation from the canonical user session", async () => {
    const root = await actor(`group-context-root-${crypto.randomUUID()}@example.test`, "admin");
    const group = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Member-only target ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const { userId, memberId } = await insertIndividualMember(
      env.DB,
      "H5",
      `group-context-member-${crypto.randomUUID()}@example.test`,
    );
    const token = await createMemberSession(env.DB, userId, crypto.randomUUID());

    const context = await requireGroupResourceContext(
      env.DB,
      new Request(`https://app.test/api/v1/groups/${group.id}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      group.id,
    );

    expect(context.viewer.admin).toBeUndefined();
    expect(requireGroupParticipantMember(context)).toMatchObject({ userId, memberId });
  });

  it("preserves staff and member capacities together in one canonical user session", async () => {
    const root = await actor(`group-context-dual-${crypto.randomUUID()}@example.test`, "admin");
    const group = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Dual-capacity target ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const memberId = await seedOrganizationAggregate(
      env.DB,
      await insertOrganization(env.DB, `Dual-capacity organization ${crypto.randomUUID()}`),
    );
    await addRepresentative(env.DB, memberId, root.id);
    const token = await createAdminSession(env.DB, root.id, crypto.randomUUID());

    const context = await requireGroupResourceContext(
      env.DB,
      new Request(`https://app.test/api/v1/groups/${group.id}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      group.id,
    );

    expect(context.viewer.admin?.id).toBe(root.id);
    expect(requireGroupParticipantMember(context)).toMatchObject({ userId: root.id, memberId });
    expect(requireGroupManagementActor(context).id).toBe(root.id);
  });

  it("does not turn an unrelated staff capacity into selected-group management", async () => {
    const root = await actor(`group-context-root-${crypto.randomUUID()}@example.test`, "admin");
    const staff = await actor(`group-context-staff-${crypto.randomUUID()}@example.test`);
    const visibleGroup = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Visible target ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const unrelatedGroup = await createGroup(env.DB, root, {
      typeKey: "working_group",
      name: `Unrelated management ${crypto.randomUUID()}`,
      visibility: "public",
    });
    const { memberId } = await grantGroupLeadershipCapacity(env.DB, unrelatedGroup.id, staff.id);
    staff.memberId = memberId;
    const token = await createAdminSession(env.DB, staff.id, crypto.randomUUID(), undefined, memberId);

    const context = await requireGroupResourceContext(
      env.DB,
      new Request(`https://app.test/api/v1/groups/${visibleGroup.id}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      visibleGroup.id,
    );

    expect(context.viewer.admin?.id).toBe(staff.id);
    expect(context.capabilities).toEqual(["view"]);
    expect(() => requireGroupManagementActor(context)).toThrowError(
      expect.objectContaining({ status: 403, code: "GROUP_MANAGEMENT_REQUIRED" }),
    );
  });
});
