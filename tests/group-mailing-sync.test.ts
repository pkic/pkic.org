import { seedPersona } from "./personas/seed";
import { expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { insertUser } from "./helpers/membership";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { enqueueGoogleGroupsSync, listPendingGoogleGroupsSync } from "../functions/_lib/services/google-groups";
import { mailingListSyncResponseSchema } from "../assets/shared/schemas/mailing-list-sync";

it("pauses only the selected mailing list's intents, persists settings, and queues a bounded worker reconciliation on request", async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  const token = await createAdminSession(env.DB, admin.id, "group-sync-admin");
  const [list] = await queryAll<{ id: string; email: string; group_id: string }>(
    env.DB,
    "SELECT id, email, group_id FROM mailing_lists WHERE group_id IS NOT NULL LIMIT 1",
  );
  const base = `/api/v1/groups/${list.group_id}/mailing-lists/${list.id}/synchronization`;
  const userId = await insertUser(env.DB, "user@example.test");
  const siblingId = "99999999-1111-4111-8111-111111111111";
  await env.DB.prepare(
    `INSERT INTO mailing_lists (id, email, label, purpose, group_id, created_at, updated_at)
    VALUES (?, 'sibling@example.test', 'Sibling list', 'group', ?, ?, ?)`,
  )
    .bind(siblingId, list.group_id, new Date().toISOString(), new Date().toISOString())
    .run();
  const siblingQueueId = await enqueueGoogleGroupsSync(env.DB, {
    userId,
    action: "add_to_list",
    googleGroupEmail: "sibling@example.test",
  });
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
  expect(mailingListSyncResponseSchema.parse(await (await call("GET")).json()).synchronization).toEqual({
    enabled: true,
    revision: 0,
  });
  expect((await call("PATCH", { enabled: false, expectedRevision: 0 })).status).toBe(200);
  expect((await listPendingGoogleGroupsSync(env.DB)).map((row) => row.id).sort()).toEqual(
    [unrelatedId, siblingQueueId].sort(),
  );
  await env.DB.prepare("UPDATE scheduled_jobs SET wake_requested = 0 WHERE job_key = 'google_groups_sync'").run();
  expect((await call("POST", { expectedRevision: 1 }, "/runs")).status).toBe(409);
  expect((await call("PATCH", { enabled: true, expectedRevision: 0 })).status).toBe(409);
  expect(
    await env.DB.prepare("SELECT wake_requested FROM scheduled_jobs WHERE job_key = 'google_groups_sync'").first(
      "wake_requested",
    ),
  ).toBe(0);
  expect((await call("PATCH", { enabled: true, expectedRevision: 1 })).status).toBe(200);
  expect(
    await env.DB.prepare("SELECT wake_requested FROM scheduled_jobs WHERE job_key = 'google_groups_sync'").first(
      "wake_requested",
    ),
  ).toBe(1);
  expect((await listPendingGoogleGroupsSync(env.DB)).map((row) => row.id)).toContain(ownedId);
  await env.DB.prepare("UPDATE google_groups_sync_queue SET next_attempt_at = '2099-01-01T00:00:00.000Z' WHERE id = ?")
    .bind(siblingQueueId)
    .run();
  const run = await call("POST", { expectedRevision: 2 }, "/runs");
  expect(run.status, await run.clone().text()).toBe(200);
  expect(await run.json()).toMatchObject({ queued: expect.any(Number) });
  expect(
    await env.DB.prepare("SELECT next_attempt_at FROM google_groups_sync_queue WHERE id = ?")
      .bind(siblingQueueId)
      .first("next_attempt_at"),
  ).toBe("2099-01-01T00:00:00.000Z");
  expect(
    (
      await callApi(env, base.replace(list.id, "99999999-2222-4222-8222-222222222222"), {
        headers: { authorization: `Bearer ${token}` },
      })
    ).status,
  ).toBe(404);
  const audit = await queryAll(
    env.DB,
    "SELECT id FROM audit_log WHERE action = 'mailing_list_sync_requested' AND scope_id = ?",
    list.group_id,
  );
  expect(audit).toHaveLength(1);
  const ordinary = (await seedPersona(env.DB, "membershipReader")).token!;
  expect((await call("PATCH", { enabled: false, expectedRevision: 2 }, "", ordinary)).status).toBe(403);
  expect((await call("POST", { expectedRevision: 2 }, "/runs", ordinary)).status).toBe(403);
});
