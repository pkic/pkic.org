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
  claimPendingGoogleGroupsSyncRows,
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
    return Promise.resolve(new Response(null, { status: directoryApiStatus }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubGoogleFetchWithFirstDirectoryCallPaused(firstDirectoryStatus = 200): {
  fetchMock: ReturnType<typeof vi.fn>;
  directoryStarted: Promise<void>;
  releaseDirectory: () => void;
} {
  let notifyDirectoryStarted!: () => void;
  let releaseDirectory!: () => void;
  const directoryStarted = new Promise<void>((resolve) => {
    notifyDirectoryStarted = resolve;
  });
  const directoryGate = new Promise<void>((resolve) => {
    releaseDirectory = resolve;
  });
  let directoryCalls = 0;
  const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "fake-access-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    directoryCalls++;
    if (directoryCalls === 1) {
      notifyDirectoryStarted();
      await directoryGate;
    }
    return new Response(null, {
      status: directoryCalls === 1 ? firstDirectoryStatus : init?.method === "DELETE" ? 204 : 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, directoryStarted, releaseDirectory };
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

  it("coalesces concurrent duplicate active actions", async () => {
    const userId = await insertUser("gg-dedupe@example.test");
    const params = {
      userId,
      googleGroupEmail: "pqc@lists.pkic.org",
      action: "add_to_list" as const,
      idempotencyKey: `test:add:${userId}:pqc`,
    };
    const [firstId, secondId] = await Promise.all([
      enqueueGoogleGroupsSync(env.DB, params),
      enqueueGoogleGroupsSync(env.DB, params),
    ]);

    expect(firstId).toBe(secondId);
    expect(
      await queryAll(
        env.DB,
        `SELECT id FROM google_groups_sync_queue
         WHERE user_id = ? AND google_group_email = ? AND action = ? AND status IN ('pending', 'processing')`,
        userId,
        params.googleGroupEmail,
        params.action,
      ),
    ).toHaveLength(1);
    expect(
      await queryAll<{ generation: number; desired_action: string }>(
        env.DB,
        `SELECT generation, desired_action
           FROM google_groups_membership_desired_state
          WHERE user_id = ? AND google_group_email = ?`,
        userId,
        params.googleGroupEmail,
      ),
    ).toEqual([{ generation: 1, desired_action: "add_to_list" }]);
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

  it("leaves rows unclaimed when OAuth returns a successful but malformed token response", async () => {
    const userId = await insertUser("gg-invalid-oauth@example.test");
    const queueId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "pqc@lists.pkic.org",
      action: "add_to_list",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ token_type: "Bearer" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    expect(await processGoogleGroupsSyncQueue(env.DB, await fakeServiceAccountEnv(), 10)).toMatchObject({
      processed: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(
      await queryAll<{ status: string; processing_token: string | null }>(
        env.DB,
        "SELECT status, processing_token FROM google_groups_sync_queue WHERE id = ?",
        queueId,
      ),
    ).toEqual([{ status: "pending", processing_token: null }]);
  });

  it("treats provider already-present and already-absent responses as idempotent success", async () => {
    const userId = await insertUser("gg-provider-idempotency@example.test");
    await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "present@lists.pkic.org",
      action: "add_to_list",
    });
    await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "absent@lists.pkic.org",
      action: "remove_from_list",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return Promise.resolve(
            new Response(JSON.stringify({ access_token: "fake-access-token" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.resolve(new Response(null, { status: init?.method === "DELETE" ? 404 : 409 }));
      }),
    );

    expect(await processGoogleGroupsSyncQueue(env.DB, await fakeServiceAccountEnv(), 10)).toMatchObject({
      processed: 2,
      succeeded: 2,
      failed: 0,
    });
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
       VALUES (?, ?, 'add_to_list', 'pqc@lists.pkic.org', 'pending', ?, NULL, ?, ?, NULL)`,
    )
      .bind(queueId, userId, MAX_SYNC_ATTEMPTS - 1, new Date().toISOString(), new Date().toISOString())
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

  it("P9-R03: two concurrent claim calls on the same pending rows never both claim the same row (compare-and-set)", async () => {
    const userId = await insertUser("gg-concurrent-claim@example.test");
    const queueIds = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        enqueueGoogleGroupsSync(env.DB, {
          userId,
          googleGroupEmail: `group-${i}@lists.pkic.org`,
          action: "add_to_list",
        }),
      ),
    );

    // Two overlapping "cron invocations" racing to claim from the same
    // pending backlog — the pre-fix bare-SELECT claim step would let both
    // of these see and return the same rows.
    const [claimedA, claimedB] = await Promise.all([
      claimPendingGoogleGroupsSyncRows(env.DB, 10),
      claimPendingGoogleGroupsSyncRows(env.DB, 10),
    ]);

    const idsA = claimedA.map((r) => r.id);
    const idsB = claimedB.map((r) => r.id);

    // Disjoint: no row was handed to both callers.
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toEqual([]);

    // Every claimed row was flipped to 'processing' by whichever caller won it.
    expect(claimedA.every((r) => r.status === "processing")).toBe(true);
    expect(claimedB.every((r) => r.status === "processing")).toBe(true);

    // Together, the two disjoint claim sets cover every pending row exactly once.
    const combined = [...idsA, ...idsB].sort();
    expect(combined).toEqual([...queueIds].sort());

    // A third caller arriving after both have claimed gets nothing left to claim.
    const claimedC = await claimPendingGoogleGroupsSyncRows(env.DB, 10);
    expect(claimedC).toEqual([]);

    const rows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM google_groups_sync_queue WHERE user_id = ?",
      userId,
    );
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.status === "processing")).toBe(true);
  });

  it("P9-R03: two concurrent processGoogleGroupsSyncQueue runs never double-process (double-call the Directory API for) the same row", async () => {
    const userId = await insertUser("gg-concurrent-process@example.test");
    const queueIds = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        enqueueGoogleGroupsSync(env.DB, {
          userId,
          googleGroupEmail: `group-${i}@lists.pkic.org`,
          action: "add_to_list",
        }),
      ),
    );

    const serviceAccountEnv = await fakeServiceAccountEnv();
    const fetchMock = stubGoogleFetch(200);

    const [resultA, resultB] = await Promise.all([
      processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10),
      processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10),
    ]);

    // Every enqueued row was processed exactly once in total across the two
    // overlapping invocations — never lost, never double-processed.
    expect(resultA.processed + resultB.processed).toBe(queueIds.length);
    expect(resultA.succeeded + resultB.succeeded).toBe(queueIds.length);

    const rows = await queryAll<{ id: string; status: string; attempts: number }>(
      env.DB,
      "SELECT id, status, attempts FROM google_groups_sync_queue WHERE user_id = ?",
      userId,
    );
    expect(rows).toHaveLength(queueIds.length);
    for (const row of rows) {
      expect(row.status).toBe("completed");
      // attempts is incremented via SQL `attempts + 1`, so a row that was
      // double-claimed (the pre-fix bug) would show attempts === 2 here.
      expect(row.attempts).toBe(1);
    }

    // The Directory API "add member" endpoint was called exactly once per
    // row, not twice for any row — the direct symptom of the old race.
    const addMemberCalls = fetchMock.mock.calls.filter(([url]) => typeof url === "string" && url.includes("/members"));
    expect(addMemberCalls).toHaveLength(queueIds.length);
  });

  it("reclaims an expired processing lease with a new token and completes it", async () => {
    const userId = await insertUser("gg-expired-lease@example.test");
    const queueId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "lease@lists.pkic.org",
      action: "remove_from_list",
    });
    await env.DB.prepare(
      `UPDATE google_groups_sync_queue
          SET status = 'processing', processing_token = 'abandoned-token',
              lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 minute')
        WHERE id = ?`,
    )
      .bind(queueId)
      .run();
    stubGoogleFetch(204);

    const result = await processGoogleGroupsSyncQueue(env.DB, await fakeServiceAccountEnv(), 10);

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    expect(
      await queryAll<{ status: string; processing_token: string | null; lease_expires_at: string | null }>(
        env.DB,
        "SELECT status, processing_token, lease_expires_at FROM google_groups_sync_queue WHERE id = ?",
        queueId,
      ),
    ).toEqual([{ status: "completed", processing_token: null, lease_expires_at: null }]);
  });

  it("does not reclaim a processing lease before it expires", async () => {
    const userId = await insertUser("gg-live-lease@example.test");
    const queueId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "lease@lists.pkic.org",
      action: "remove_from_list",
    });
    await env.DB.prepare(
      `UPDATE google_groups_sync_queue
          SET status = 'processing', processing_token = 'current-token',
              lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+5 minutes')
        WHERE id = ?`,
    )
      .bind(queueId)
      .run();

    expect(await claimPendingGoogleGroupsSyncRows(env.DB, 10)).toEqual([]);
  });

  it("supersedes an unclaimed action and claims only the latest desired state for a user/group pair", async () => {
    const userId = await insertUser("gg-action-order@example.test");
    const addId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "ordered@lists.pkic.org",
      action: "add_to_list",
    });
    const removeId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: "ordered@lists.pkic.org",
      action: "remove_from_list",
    });

    expect((await claimPendingGoogleGroupsSyncRows(env.DB, 10)).map((row) => row.id)).toEqual([removeId]);
    expect(
      await queryAll<{ id: string; status: string; generation: number }>(
        env.DB,
        "SELECT id, status, generation FROM google_groups_sync_queue WHERE user_id = ? ORDER BY rowid",
        userId,
      ),
    ).toEqual([
      { id: addId, status: "superseded", generation: 1 },
      { id: removeId, status: "processing", generation: 2 },
    ]);
  });

  it("retains add-remove-add transitions, including both updates enqueued while the first action is processing", async () => {
    const userId = await insertUser("gg-add-remove-add@example.test");
    const group = "alternating@lists.pkic.org";
    const firstAdd = await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: group, action: "add_to_list" });
    expect((await claimPendingGoogleGroupsSyncRows(env.DB, 10)).map((row) => row.id)).toEqual([firstAdd]);
    const remove = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: group,
      action: "remove_from_list",
    });
    const finalAdd = await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: group, action: "add_to_list" });
    expect(
      await queryAll(
        env.DB,
        "SELECT id, action FROM google_groups_sync_queue WHERE user_id = ? ORDER BY rowid",
        userId,
      ),
    ).toEqual([
      { id: firstAdd, action: "add_to_list" },
      { id: remove, action: "remove_from_list" },
      { id: finalAdd, action: "add_to_list" },
    ]);

    expect((await claimPendingGoogleGroupsSyncRows(env.DB, 10)).map((row) => row.id)).toEqual([finalAdd]);
    expect(
      await queryAll<{ id: string; status: string }>(
        env.DB,
        "SELECT id, status FROM google_groups_sync_queue WHERE user_id = ? ORDER BY rowid",
        userId,
      ),
    ).toEqual([
      // A newer generation fences the already-claimed row in D1. Its
      // Directory call may still finish, but it can no longer be reclaimed or
      // overwrite the latest desired generation.
      { id: firstAdd, status: "superseded" },
      { id: remove, status: "superseded" },
      { id: finalAdd, status: "processing" },
    ]);
  });

  it("applies add-remove-add in order when the final desired state changes during an in-flight Directory call", async () => {
    const userId = await insertUser("gg-add-remove-add-processing@example.test");
    const group = "alternating-processing@lists.pkic.org";
    await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: group, action: "add_to_list" });
    const serviceAccountEnv = await fakeServiceAccountEnv();
    const { fetchMock, directoryStarted, releaseDirectory } = stubGoogleFetchWithFirstDirectoryCallPaused();

    const firstRun = processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10);
    await directoryStarted;
    await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: group, action: "remove_from_list" });
    await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: group, action: "add_to_list" });
    releaseDirectory();
    expect(await firstRun).toMatchObject({ processed: 1, succeeded: 1 });
    expect(await processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10)).toMatchObject({ processed: 0 });

    const methods = fetchMock.mock.calls
      .filter(([url]) => typeof url === "string" && url.includes("/members"))
      .map(([, init]) => (init as RequestInit | undefined)?.method);
    expect(methods).toEqual(["POST"]);
    expect(
      await queryAll<{ action: string; status: string }>(
        env.DB,
        "SELECT action, status FROM google_groups_sync_queue WHERE user_id = ? ORDER BY rowid",
        userId,
      ),
    ).toEqual([
      { action: "add_to_list", status: "superseded" },
      { action: "remove_from_list", status: "superseded" },
      { action: "add_to_list", status: "completed" },
    ]);
  });

  it("does not retry a failed in-flight action after an opposite desired state supersedes it", async () => {
    const userId = await insertUser("gg-stale-failure@example.test");
    const group = "stale-failure@lists.pkic.org";
    const addId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: group,
      action: "add_to_list",
    });
    const serviceAccountEnv = await fakeServiceAccountEnv();
    const { directoryStarted, releaseDirectory } = stubGoogleFetchWithFirstDirectoryCallPaused(500);

    const staleRun = processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10);
    await directoryStarted;
    const removeId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: group,
      action: "remove_from_list",
    });
    releaseDirectory();

    expect(await staleRun).toMatchObject({ processed: 1, succeeded: 0, failed: 0 });
    expect(
      await queryAll<{ id: string; status: string; next_attempt_at: string | null }>(
        env.DB,
        "SELECT id, status, next_attempt_at FROM google_groups_sync_queue WHERE user_id = ? ORDER BY rowid",
        userId,
      ),
    ).toEqual([
      { id: addId, status: "superseded", next_attempt_at: null },
      { id: removeId, status: "pending", next_attempt_at: expect.any(String) },
    ]);
  });

  it("retains remove-add-remove transitions without coalescing the final desired removal", async () => {
    const userId = await insertUser("gg-remove-add-remove@example.test");
    const group = "alternating-reverse@lists.pkic.org";
    const ids = [
      await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: group, action: "remove_from_list" }),
      await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: group, action: "add_to_list" }),
      await enqueueGoogleGroupsSync(env.DB, { userId, googleGroupEmail: group, action: "remove_from_list" }),
    ];

    expect(
      await queryAll(env.DB, "SELECT action FROM google_groups_sync_queue WHERE user_id = ? ORDER BY rowid", userId),
    ).toEqual([{ action: "remove_from_list" }, { action: "add_to_list" }, { action: "remove_from_list" }]);
    expect((await claimPendingGoogleGroupsSyncRows(env.DB, 10)).map((row) => row.id)).toEqual([ids[2]]);
    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM google_groups_sync_queue WHERE user_id = ? ORDER BY rowid",
        userId,
      ),
    ).toEqual([{ status: "superseded" }, { status: "superseded" }, { status: "processing" }]);
  });

  it("requeues the latest desired removal when an expired-lease add call completes after that removal", async () => {
    const userId = await insertUser("gg-expired-lease-order@example.test");
    const group = "lease-order@lists.pkic.org";
    const addId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: group,
      action: "add_to_list",
    });
    const serviceAccountEnv = await fakeServiceAccountEnv();
    let releaseFirstAdd!: () => void;
    let notifyFirstAddStarted!: () => void;
    const firstAddStarted = new Promise<void>((resolve) => {
      notifyFirstAddStarted = resolve;
    });
    const firstAddGate = new Promise<void>((resolve) => {
      releaseFirstAdd = resolve;
    });
    const appliedEffects: string[] = [];
    let directoryCall = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return new Response(JSON.stringify({ access_token: "fake-access-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        directoryCall++;
        const effect = init?.method === "DELETE" ? "remove" : "add";
        if (directoryCall === 1) {
          notifyFirstAddStarted();
          await firstAddGate;
        }
        appliedEffects.push(effect);
        return new Response(null, { status: effect === "remove" ? 204 : 200 });
      }),
    );

    const staleWorker = processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10);
    await firstAddStarted;
    await env.DB.prepare(
      "UPDATE google_groups_sync_queue SET lease_expires_at = ? WHERE id = ? AND status = 'processing'",
    )
      .bind(new Date(Date.now() - 1000).toISOString(), addId)
      .run();
    expect(await processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10)).toMatchObject({
      processed: 1,
      succeeded: 1,
    });

    const removeId = await enqueueGoogleGroupsSync(env.DB, {
      userId,
      googleGroupEmail: group,
      action: "remove_from_list",
    });
    expect(await processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10)).toMatchObject({
      processed: 1,
      succeeded: 1,
    });
    releaseFirstAdd();
    expect(await staleWorker).toMatchObject({ processed: 1, succeeded: 0 });
    expect(appliedEffects).toEqual(["add", "remove", "add"]);
    expect(
      await queryAll<{ status: string }>(env.DB, "SELECT status FROM google_groups_sync_queue WHERE id = ?", removeId),
    ).toEqual([{ status: "pending" }]);

    expect(await processGoogleGroupsSyncQueue(env.DB, serviceAccountEnv, 10)).toMatchObject({
      processed: 1,
      succeeded: 1,
    });
    expect(appliedEffects).toEqual(["add", "remove", "add", "remove"]);
    expect(
      await queryAll<{ desired_action: string; status: string }>(
        env.DB,
        `SELECT desired.desired_action, queue.status
           FROM google_groups_membership_desired_state desired
           JOIN google_groups_sync_queue queue
             ON queue.user_id = desired.user_id
            AND queue.google_group_email = desired.google_group_email
            AND queue.generation = desired.generation
          WHERE desired.user_id = ? AND desired.google_group_email = ?`,
        userId,
        group,
      ),
    ).toEqual([{ desired_action: "remove_from_list", status: "completed" }]);
  });
});
