import { seedPersona } from "./personas/seed";
import { expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { insertUser } from "./helpers/membership";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { enqueueGoogleGroupsSync, listPendingGoogleGroupsSync } from "../functions/_lib/services/google-groups";
import { groupMailingSyncResponseSchema } from "../assets/shared/schemas/group-mailing-sync";

it("pauses only the owning group's intents, persists settings, and queues a bounded worker reconciliation on request", async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  const token = await createAdminSession(env.DB, admin.id, "group-sync-admin");
  const [list] = await queryAll<{ email: string; group_id: string }>(
    env.DB,
    "SELECT email, group_id FROM mailing_lists WHERE group_id IS NOT NULL LIMIT 1",
  );
  const base = `/api/v1/groups/${list.group_id}/mailing-lists/synchronization`;
  const userId = await insertUser(env.DB, "user@example.test");
  const unrelatedId = await enqueueGoogleGroupsSync(env.DB, {
    userId,
    action: "add_to_list",
    googleGroupEmail: "unrelated@example.test",
  });
  const ownedId = await enqueueGoogleGroupsSync(env.DB, {
    userId,
    action: "add_to_list",
    googleGroupEmail: list.email,
  });
  function call(method: string, body?: unknown, suffix = "", auth = token) {
    return callApi(env, base + suffix, {
      method,
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  expect(groupMailingSyncResponseSchema.parse(await (await call("GET")).json()).synchronization).toEqual({
    enabled: true,
    revision: 0,
  });
  expect((await call("PATCH", { enabled: false, expectedRevision: 0 })).status).toBe(200);
  expect((await listPendingGoogleGroupsSync(env.DB)).map((row) => row.id)).toEqual([unrelatedId]);
  expect((await call("POST", { expectedRevision: 1 }, "/runs")).status).toBe(409);
  expect((await call("PATCH", { enabled: true, expectedRevision: 0 })).status).toBe(409);
  expect((await call("PATCH", { enabled: true, expectedRevision: 1 })).status).toBe(200);
  expect((await listPendingGoogleGroupsSync(env.DB)).map((row) => row.id)).toContain(ownedId);
  const run = await call("POST", { expectedRevision: 2 }, "/runs");
  expect(run.status, await run.clone().text()).toBe(200);
  expect(await run.json()).toMatchObject({ queued: expect.any(Number) });
  const audit = await queryAll(
    env.DB,
    "SELECT id FROM audit_log WHERE action = 'group_mailing_sync_requested' AND scope_id = ?",
    list.group_id,
  );
  expect(audit).toHaveLength(1);
  const ordinary = (await seedPersona(env.DB, "membershipReader")).token!;
  expect((await call("PATCH", { enabled: false, expectedRevision: 2 }, "", ordinary)).status).toBe(403);
  expect((await call("POST", { expectedRevision: 2 }, "/runs", ordinary)).status).toBe(403);
});
