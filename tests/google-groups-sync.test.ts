/**
 * google-groups-sync.test.ts
 *
 * PRD §4.7/§4.9 Google Groups sync queue + processor
 * (functions/_lib/services/google-groups.ts). No live Google Workspace is
 * available in this environment, so this covers the queue mechanics and the
 * graceful unconfigured path — not a real Directory API call.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import {
  enqueueGoogleGroupsSync,
  isGoogleGroupsSyncConfigured,
  listPendingGoogleGroupsSync,
  processGoogleGroupsSyncQueue,
} from "../functions/_lib/services/google-groups";
import { queryAll } from "./helpers/context";

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

describe("Google Groups sync (PRD §4.7/§4.9)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("enqueues a pending sync row", async () => {
    const userId = await insertUser("gg-enqueue@example.test");
    const id = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "pqc@lists.pkic.org",
      action: "add_to_list",
    });
    expect(id).toBeTruthy();

    const rows = await queryAll<{ status: string; action: string }>(
      env.DB,
      "SELECT status, action FROM google_groups_sync_queue WHERE id = ?",
      id,
    );
    expect(rows[0].status).toBe("pending");
    expect(rows[0].action).toBe("add_to_list");
  });

  it("lists pending rows in FIFO order", async () => {
    const userId = await insertUser("gg-fifo@example.test");
    await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: "a@lists.pkic.org", action: "add_to_list" });
    await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: "b@lists.pkic.org", action: "add_to_list" });

    const rows = await listPendingGoogleGroupsSync(env.DB, 10);
    expect(rows).toHaveLength(2);
    expect(rows[0].google_group_email).toBe("a@lists.pkic.org");
  });

  it("isGoogleGroupsSyncConfigured is false when secrets are absent", () => {
    expect(isGoogleGroupsSyncConfigured({})).toBe(false);
  });

  it("isGoogleGroupsSyncConfigured is true when all three secrets are present", () => {
    expect(
      isGoogleGroupsSyncConfigured({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        GOOGLE_WORKSPACE_ADMIN_EMAIL: "admin@pkic.org",
      }),
    ).toBe(true);
  });

  it("processGoogleGroupsSyncQueue leaves rows pending and logs when unconfigured (no secrets in this environment)", async () => {
    const userId = await insertUser("gg-unconfigured@example.test");
    await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: "pqc@lists.pkic.org", action: "add_to_list" });

    const result = await processGoogleGroupsSyncQueue(env.DB, {}, 10);
    expect(result.skippedUnconfigured).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.completedAddsByUser).toEqual({});

    const rows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM google_groups_sync_queue WHERE user_id = ?",
      userId,
    );
    expect(rows[0].status).toBe("pending");
  });
});
