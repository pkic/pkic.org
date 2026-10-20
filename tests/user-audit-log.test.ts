import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { scopedAuditLogResponseSchema } from "../assets/shared/schemas/audit-log";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { onlyPersona } from "./personas/catalog";
import { seedPersona } from "./personas/seed";

beforeEach(() => resetDb());

describe("User account audit history", () => {
  it("reads only the target account's changes with shared search, sort, filters and paging", async () => {
    const reader = await seedPersona(env.DB, onlyPersona("users:read"));
    const target = await seedPersona(env.DB, onlyPersona("admin:read"));
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, id] of ids.entries()) {
      await env.DB.prepare(
        `INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,details_json,created_at)
         VALUES(?,'admin',?,'user_updated',?,?,?,?)`,
      )
        .bind(
          id,
          target.userId,
          index === 3 ? "registration" : "user",
          index === 2 ? reader.userId : target.userId,
          JSON.stringify({ firstName: { from: null, to: index === 0 ? "Ada" : "Grace" } }),
          `2026-10-20T09:00:0${index}.000Z`,
        )
        .run();
    }
    const path = `/api/v1/users/${target.userId}/audit-log`;
    const headers = { authorization: `Bearer ${reader.token}` };
    const response = await callApi(env, `${path}?limit=1&sort=createdAt`, { headers });
    expect(response.status).toBe(200);
    const page = scopedAuditLogResponseSchema.parse(await response.json());
    expect(page.auditLog.map((entry) => entry.id)).toEqual([ids[0]]);
    expect(page.page).toMatchObject({ total: 2, hasMore: true });
    const last = scopedAuditLogResponseSchema.parse(
      await (await callApi(env, `${path}?limit=1&offset=1&sort=createdAt`, { headers })).json(),
    );
    expect(last.auditLog.map((entry) => entry.id)).toEqual([ids[1]]);
    const searched = scopedAuditLogResponseSchema.parse(
      await (await callApi(env, `${path}?q=Ada&action=user_updated`, { headers })).json(),
    );
    expect(searched.auditLog.map((entry) => entry.id)).toEqual([ids[0]]);
    const escaped = scopedAuditLogResponseSchema.parse(
      await (await callApi(env, `${path}?entityId=${reader.userId}`, { headers })).json(),
    );
    expect(escaped.page.total).toBe(0);
    expect((await callApi(env, `${path}?limit=0`, { headers })).status).toBe(400);
    expect((await callApi(env, `${path}?sort=details_json`, { headers })).status).toBe(400);
    expect((await callApi(env, `/api/v1/users/${crypto.randomUUID()}/audit-log`, { headers })).status).toBe(404);
  });

  it("requires users:read even for the subject and does not expose history through self access", async () => {
    const subject = await seedPersona(env.DB, onlyPersona("admin:read"));
    const path = `/api/v1/users/${subject.userId}/audit-log`;
    expect((await callApi(env, path)).status).toBe(401);
    expect((await callApi(env, path, { headers: { authorization: `Bearer ${subject.token}` } })).status).toBe(403);
  });
});
