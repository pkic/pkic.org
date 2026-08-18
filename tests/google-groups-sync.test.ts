/**
 * google-groups-sync.test.ts
 *
 * Google Groups sync queue + processor
 * (functions/_lib/services/google-groups.ts). No live Google Workspace is
 * available in this environment, so this covers the queue mechanics and the
 * graceful unconfigured path — not a real Directory API call.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import {
  enqueueGoogleGroupsSync,
  isGoogleGroupsSyncConfigured,
  listPendingGoogleGroupsSync,
  processGoogleGroupsSyncQueue,
  MAX_SYNC_ATTEMPTS,
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

/** A real (not mocked) RSA keypair, PEM-wrapped, so getServiceAccountAccessToken's
 * Web Crypto JWT signing runs for real — only the two outbound `fetch` calls
 * (OAuth token exchange, Directory API) are mocked. */
async function fakeServiceAccountEnv(): Promise<{
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
  GOOGLE_WORKSPACE_ADMIN_EMAIL: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  let binary = "";
  for (const byte of new Uint8Array(pkcs8)) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const pem = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@project.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: pem,
    GOOGLE_WORKSPACE_ADMIN_EMAIL: "admin@pkic.org",
  };
}

function stubGoogleFetch(directoryApiStatus: number): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "fake-access-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("", { status: directoryApiStatus }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Google Groups sync", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("PR #1 review §9.1: a transient Directory API failure schedules a backoff retry instead of dead-lettering immediately", async () => {
    const userId = await insertUser("gg-retry@example.test");
    const queueId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "pqc@lists.pkic.org",
      action: "add_to_list",
    });
    const serviceAccountEnv = await fakeServiceAccountEnv();
    stubGoogleFetch(500);

    const beforeCall = Date.now();
    const result = await processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10);
    expect(result.skippedUnconfigured).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);

    const rows = await queryAll<{
      status: string;
      attempts: number;
      last_error: string | null;
      next_attempt_at: string | null;
    }>(
      env.DB,
      "SELECT status, attempts, last_error, next_attempt_at FROM google_groups_sync_queue WHERE id = ?",
      queueId,
    );
    expect(rows[0].status).toBe("pending");
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toBeTruthy();
    expect(rows[0].next_attempt_at).toBeTruthy();
    expect(new Date(rows[0].next_attempt_at!).getTime()).toBeGreaterThan(beforeCall);

    // Not yet eligible for another claim — backoff hasn't elapsed.
    const pending = await listPendingGoogleGroupsSync(env.DB, 10);
    expect(pending).toHaveLength(0);
  });

  it(`PR #1 review §9.1: a row still failing after ${MAX_SYNC_ATTEMPTS} attempts is dead-lettered ('failed') and stops being retried`, async () => {
    const userId = await insertUser("gg-deadletter@example.test");
    const queueId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO google_groups_sync_queue (id, user_id, action, google_group_email, status, attempts, last_error, next_attempt_at, created_at, processed_at)
       VALUES (?, ?, 'add_to_list', 'pqc@lists.pkic.org', 'pending', ?, NULL, NULL, datetime('now'), NULL)`,
    )
      .bind(queueId, userId, MAX_SYNC_ATTEMPTS - 1)
      .run();

    const serviceAccountEnv = await fakeServiceAccountEnv();
    stubGoogleFetch(500);

    const result = await processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10);
    expect(result.failed).toBe(1);

    const rows = await queryAll<{ status: string; attempts: number; next_attempt_at: string | null }>(
      env.DB,
      "SELECT status, attempts, next_attempt_at FROM google_groups_sync_queue WHERE id = ?",
      queueId,
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].attempts).toBe(MAX_SYNC_ATTEMPTS);
    expect(rows[0].next_attempt_at).toBeNull();

    // Dead-lettered rows are never selected for another claim.
    const pending = await listPendingGoogleGroupsSync(env.DB, 10);
    expect(pending).toHaveLength(0);
  });

  it("PR #1 review §9.1: once the backoff window elapses, a retried row succeeds and is claimable again", async () => {
    const userId = await insertUser("gg-retry-success@example.test");
    const queueId = crypto.randomUUID();
    const pastAttemptAt = new Date(Date.now() - 1000).toISOString();
    await env.DB.prepare(
      `INSERT INTO google_groups_sync_queue (id, user_id, action, google_group_email, status, attempts, last_error, next_attempt_at, created_at, processed_at)
       VALUES (?, ?, 'add_to_list', 'pqc@lists.pkic.org', 'pending', 1, 'previous transient failure', ?, datetime('now'), NULL)`,
    )
      .bind(queueId, userId, pastAttemptAt)
      .run();

    const serviceAccountEnv = await fakeServiceAccountEnv();
    stubGoogleFetch(200);

    const result = await processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10);
    expect(result.succeeded).toBe(1);

    const rows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM google_groups_sync_queue WHERE id = ?",
      queueId,
    );
    expect(rows[0].status).toBe("completed");
  });
});
