import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { listPermissionTargets } from "../functions/_lib/services/access-control/catalogs";
import { permissionTargetsListQuerySchema, accessGrantCreateSchema } from "../assets/shared/schemas/access-control";

describe("canonical event sponsor permission targets", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("accepts catalog sponsorship IDs and rejects unknown/composite targets on insert and update", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const now = new Date().toISOString();
    const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const sponsorId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Synthetic sponsor','active',?,?)",
    )
      .bind(sponsorId, eventId, now, now)
      .run();
    const catalog = await listPermissionTargets(
      env.DB,
      permissionTargetsListQuerySchema.parse({ contextType: "event_sponsor" }),
    );
    expect(catalog.targets).toEqual([
      { id: sponsorId, type: "event_sponsor", name: "Synthetic sponsor — PQC Conference 2026" },
    ]);
    const payload = accessGrantCreateSchema.parse({
      userId: user.id,
      permission: "agenda:leads_capture",
      contextType: "event_sponsor",
      contextId: catalog.targets[0].id,
    });
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(grantId, payload.userId, payload.permission, payload.contextType, payload.contextId, now)
      .run();
    await expect(
      env.DB.prepare("UPDATE permission_grants SET context_id=? WHERE id=?")
        .bind(`${eventId}:${sponsorId}`, grantId)
        .run(),
    ).rejects.toThrow("PERMISSION_GRANT_CONTEXT_INVALID");
    await expect(
      env.DB.prepare(
        "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:leads_capture','event_sponsor',?,?)",
      )
        .bind(crypto.randomUUID(), user.id, crypto.randomUUID(), now)
        .run(),
    ).rejects.toThrow("PERMISSION_GRANT_CONTEXT_INVALID");
    const roleId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user_roles(id,user_id,role_id,context_type,context_id,created_at) VALUES(?,?,'role-event_volunteer','event_sponsor',?,?)",
    )
      .bind(roleId, user.id, sponsorId, now)
      .run();
    await expect(
      env.DB.prepare("UPDATE user_roles SET context_id=? WHERE id=?").bind(crypto.randomUUID(), roleId).run(),
    ).rejects.toThrow("USER_ROLE_CONTEXT_INVALID");
  });
});
