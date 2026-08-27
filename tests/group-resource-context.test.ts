import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  requireGroupManagementActor,
  requireGroupResourceContext,
} from "../functions/api/v1/groups/group-resource-context";
import { createGroup } from "../functions/_lib/services/groups";
import type { AuthAdmin } from "../functions/_lib/types";
import { createAdminSession } from "./helpers/auth";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function actor(email: string, role = "user"): Promise<AuthAdmin> {
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function grantGroupLeadership(groupId: string, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
     VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), userId, groupId)
    .run();
}

beforeEach(resetDb);

describe("group resource context", () => {
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
    await grantGroupLeadership(unrelatedGroup.id, staff.id);
    const token = await createAdminSession(env.DB, staff.id, crypto.randomUUID());

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
