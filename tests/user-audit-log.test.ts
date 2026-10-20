import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { scopedAuditLogResponseSchema } from "../assets/shared/schemas/audit-log";
import { prepareAuditLog, serializeAuditDetails } from "../functions/_lib/services/audit";
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

  it.each(["legacy", "normalized"])(
    "includes %s role and permission changes after revocation without crossing account boundaries",
    async (format) => {
      const reader = await seedPersona(env.DB, onlyPersona("users:read"));
      const target = await seedPersona(env.DB, onlyPersona("admin:read"));
      const changes = [
        ["user_roles", "user_role_assigned"],
        ["user_roles", "user_role_expiry_updated"],
        ["user_roles", "user_role_revoked"],
        ["permission_grant", "access_grant_created"],
        ["permission_grant", "access_grant_revoked"],
      ] as const;
      const expected: string[] = [];
      // Access records need not still exist: audit ownership survives their removal.
      for (const [index, [entityType, action]] of changes.entries()) {
        for (const subject of [target.userId, reader.userId]) {
          const id = crypto.randomUUID();
          const details = { userId: subject, permission: "events:read" };
          await env.DB.prepare(
            `INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,details_json,created_at)
             VALUES(?,'admin',?,?,?,?,?,?)`,
          )
            .bind(
              id,
              target.userId,
              action,
              entityType,
              crypto.randomUUID(),
              format === "normalized" ? serializeAuditDetails(details) : JSON.stringify(details),
              `2026-10-20T09:00:0${index}.000Z`,
            )
            .run();
          if (subject === target.userId) expected.push(id);
        }
      }
      await prepareAuditLog(
        env.DB,
        "admin",
        target.userId,
        "registration_created",
        "registration",
        crypto.randomUUID(),
        { userId: target.userId },
      ).run();
      const headers = { authorization: `Bearer ${reader.token}` };
      const path = `/api/v1/users/${target.userId}/audit-log`;
      const read = async (query: string) => {
        const response = await callApi(env, `${path}?${query}`, { headers });
        expect(response.status).toBe(200);
        return scopedAuditLogResponseSchema.parse(await response.json());
      };
      const page = await read("limit=2&offset=2&sort=createdAt");
      expect(page.auditLog.map((entry) => entry.id)).toEqual(expected.slice(2, 4));
      expect(page.page).toMatchObject({ total: 5, hasMore: true });
      const all = await read("sort=createdAt");
      expect(all.auditLog.map((entry) => entry.id)).toEqual(expected);
      const filtered = await read("action=access_grant_revoked&q=events");
      expect(filtered.auditLog.map((entry) => entry.id)).toEqual([expected[4]]);
      expect((await read(`entityId=${crypto.randomUUID()}`)).page.total).toBe(0);
    },
  );

  it("requires users:read even for the subject and does not expose history through self access", async () => {
    const subject = await seedPersona(env.DB, onlyPersona("admin:read"));
    const path = `/api/v1/users/${subject.userId}/audit-log`;
    expect((await callApi(env, path)).status).toBe(401);
    expect((await callApi(env, path, { headers: { authorization: `Bearer ${subject.token}` } })).status).toBe(403);
  });
});
