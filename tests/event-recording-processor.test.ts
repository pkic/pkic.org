import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserBackedAdminFromRequest } from "../functions/_lib/auth/admin";
import type { DatabaseLike } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import {
  claimRecordingAcquisition,
  requestRecordingAcquisition,
} from "../functions/_lib/services/event-recordings/acquisitions";
import {
  processRecordingAcquisition,
  type RecordingAcquisitionProcessorDependencies,
} from "../functions/_lib/services/event-recordings/processor";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";
import { resetDb } from "./helpers/reset-db";

const origin = "https://recordings.example.test";
const sourceEtag = '"immutable-provider-bytes"';
const keys = new Set<string>();
async function fixture(bytes = 129) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId: admin.id });
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const actor = await requireUserBackedAdminFromRequest(
    env.DB,
    new Request("https://test.invalid/", {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
  );
  const sourceId = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
    recordingId = crypto.randomUUID(),
    now = nowIso();
  await env.DB.prepare(
    `INSERT INTO event_recording_sources(id,event_id,meeting_link_id,provider_type,
    provider_account_id,provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,
    provider_status,provider_invoked_at,provider_started_at,provider_file_size,metadata_revision,observed_at,
    created_by_user_id,created_at,updated_at) VALUES(?,?,?,'realtimekit',?,?,?,?,?,'UPLOADED',?,?,?,1,?,?,?,?)`,
  )
    .bind(
      sourceId,
      eventId,
      meeting.meetingLinkId,
      meeting.providerAccountId,
      meeting.providerAppId,
      meeting.providerMeetingId,
      sessionId,
      recordingId,
      now,
      now,
      bytes,
      now,
      admin.id,
      now,
      now,
    )
    .run();
  const enqueue = () =>
    requestRecordingAcquisition(env.DB, eventId, sourceId, actor, {
      operationId: crypto.randomUUID(),
      expectedMetadataRevision: 1,
    });
  const intent = await enqueue();
  const bucket = env.SPEAKER_UPLOADS_BUCKET;
  if (!bucket) throw new Error("Expected native recording bucket");
  const data = new Uint8Array(bytes);
  data.set([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 109, 112, 52, 50]);
  let etag = sourceEtag,
    signed = 0,
    beforeRange: (() => Promise<void>) | undefined;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.cloudflare.com/")) {
      expect(url.endsWith(`/recordings/${recordingId}`)).toBe(true);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-provider-token");
      signed++;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: recordingId,
            session_id: sessionId,
            meeting: { id: meeting.providerMeetingId },
            status: "UPLOADED",
            invoked_time: now,
            started_time: now,
            file_size: bytes,
            download_url: `${origin}/owned.mp4?signature=private-${signed}`,
            download_url_expiry: new Date(Date.now() + 600_000).toISOString(),
          },
        }),
      );
    }
    expect(new URL(url).origin).toBe(origin);
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(init?.credentials).toBe("omit");
    const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("Range") ?? "");
    if (!range) throw new Error("Expected bounded provider range");
    const start = Number(range[1]),
      end = Number(range[2]);
    if (new Headers(init?.headers).has("If-Match")) {
      expect(new Headers(init?.headers).get("If-Match")).toBe(sourceEtag);
      await beforeRange?.();
    }
    return new Response(data.slice(start, end + 1), {
      status: 206,
      headers: {
        ETag: etag,
        "Content-Range": `bytes ${start}-${end}/${bytes}`,
        "Content-Length": String(end - start + 1),
      },
    });
  });
  const dependencies: RecordingAcquisitionProcessorDependencies = {
    configuration: {
      accountId: meeting.providerAccountId,
      appId: meeting.providerAppId,
      apiToken: "synthetic-provider-token",
    },
    configuredOrigins: [origin],
    fetcher,
    bucket: {
      head: (key) => bucket.head(key),
      get: (key, options) => bucket.get(key, options),
      createMultipartUpload: (key, options) => {
        keys.add(key);
        return bucket.createMultipartUpload(key, options);
      },
      resumeMultipartUpload: (key, uploadId) => bucket.resumeMultipartUpload(key, uploadId),
    },
  };
  const step = (db: DatabaseLike = env.DB, id = intent.id) => processRecordingAcquisition(db, id, dependencies);
  const row = () =>
    env.DB.prepare(
      `SELECT status,attempts,processing_token,transfer_upload_id,transfer_r2_key,
    verification_offset,verified_digest,completed_version_id,last_failure_kind FROM event_recording_acquisitions WHERE id=?`,
    )
      .bind(intent.id)
      .first();
  const partRows = () =>
    queryAll(
      env.DB,
      "SELECT upload_id,part_number,etag,byte_offset,byte_length FROM event_recording_parts WHERE acquisition_id=?",
      intent.id,
    );
  const versions = () =>
    queryAll(
      env.DB,
      "SELECT id,acquisition_id,r2_key,digest,file_size,deleted_at FROM event_recording_versions WHERE source_id=?",
      sourceId,
    );
  const retryNow = () =>
    env.DB.prepare("UPDATE event_recording_acquisitions SET next_attempt_at=? WHERE id=?")
      .bind(nowIso(), intent.id)
      .run();
  return {
    eventId,
    admin,
    actor,
    sourceId,
    intent,
    dependencies,
    step,
    row,
    partRows,
    versions,
    bucket,
    data,
    fetcher,
    enqueue,
    retryNow,
    setEtag: (value: string) => {
      etag = value;
    },
    setBeforeRange: (callback: () => Promise<void>) => {
      beforeRange = callback;
    },
  };
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, id = f.intent.id) {
  const stages = [];
  for (let index = 0; index < 12; index++) {
    const stage = await f.step(env.DB, id);
    stages.push(stage);
    if (stage.status === "completed") return stages;
    expect(stage.status).toBe("progress");
  }
  throw new Error("Expected bounded recording completion");
}
beforeEach(resetDb);
afterEach(async () => {
  const bucket = env.SPEAKER_UPLOADS_BUCKET;
  if (bucket) await Promise.all([...keys].map((key) => bucket.delete(key)));
  keys.clear();
  vi.restoreAllMocks();
});

describe("recording acquisition processor", () => {
  it("streams owned bytes, verifies the actual digest and completes once without private result fields", async () => {
    const f = await fixture();
    const stages = await complete(f);
    expect(stages.map((stage) => stage.status)).toEqual(["progress", "progress", "progress", "completed"]);
    expect(stages.map((stage) => stage.partsTransferred)).toEqual([1, 0, 0, 0]);
    expect(stages.map((stage) => stage.verifiedBytes)).toEqual([0, 0, 129, 0]);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", f.data)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(await f.versions()).toEqual([
      expect.objectContaining({ acquisition_id: f.intent.id, digest, file_size: 129, deleted_at: null }),
    ]);
    expect(await f.step()).toEqual({ status: "skipped", partsTransferred: 0, verifiedBytes: 0 });
    expect(
      await queryAll(env.DB, "SELECT action FROM audit_log WHERE action='recording_acquisition_completed'"),
    ).toHaveLength(1);
    expect(JSON.stringify(stages)).not.toMatch(/signature|token|objectKey|uploadId|sourceUrl|digest|versionId/);
  });
  it("performs only one multipart part or SHA range per invocation and refreshes private URLs", async () => {
    const f = await fixture(8 * 1024 ** 2 + 129);
    expect(await f.step()).toMatchObject({ status: "progress", partsTransferred: 1, verifiedBytes: 0 });
    expect(await f.partRows()).toHaveLength(1);
    expect(await f.versions()).toHaveLength(0);
    expect(await f.step()).toMatchObject({ status: "progress", partsTransferred: 1 });
    expect(await f.partRows()).toHaveLength(2);
    const downloadCalls = f.fetcher.mock.calls.filter(([input]) => String(input).startsWith(origin));
    expect(new Set(downloadCalls.map(([input]) => String(input)))).toHaveProperty("size", 2);
    expect(await f.step()).toMatchObject({ status: "progress", verifiedBytes: 0 });
    expect(await f.step()).toMatchObject({ status: "progress", verifiedBytes: 8 * 1024 ** 2 });
    expect(await f.row()).toMatchObject({ verification_offset: 8 * 1024 ** 2, verified_digest: null });
    expect(await f.step()).toMatchObject({ status: "progress", verifiedBytes: 129 });
    expect(await f.step()).toMatchObject({ status: "completed" });
  });
  it("pins the original provider ETag across URL renewal and refuses changed source bytes", async () => {
    const f = await fixture(8 * 1024 ** 2 + 129);
    await f.step();
    f.setEtag('"replacement-provider-bytes"');
    expect(await f.step()).toMatchObject({ status: "failed", partsTransferred: 0 });
    expect(await f.row()).toMatchObject({ last_failure_kind: "source_changed", status: "failed" });
    expect(await f.partRows()).toHaveLength(1);
    expect(await f.versions()).toHaveLength(0);
  });
  it("recovers multipart completion after its actual storage acknowledgment is lost", async () => {
    const f = await fixture();
    await f.step();
    const resume = f.dependencies.bucket.resumeMultipartUpload;
    const completed = vi.fn();
    f.dependencies.bucket.resumeMultipartUpload = (key, uploadId) => {
      const upload = resume(key, uploadId);
      return {
        key,
        uploadId,
        uploadPart: (number, value, options) => upload.uploadPart(number, value, options),
        abort: () => upload.abort(),
        complete: async (parts) => {
          completed();
          await upload.complete(parts);
          throw new Error("Lost complete acknowledgment");
        },
      };
    };
    expect(await f.step()).toMatchObject({ status: "progress" });
    expect(completed).toHaveBeenCalledTimes(1);
    await complete(f);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(await f.versions()).toHaveLength(1);
  });
  it("recovers an adopted multipart plan after a real D1 commit response is lost", async () => {
    const f = await fixture();
    let lost = false;
    const db: DatabaseLike = {
      prepare: (sql) => env.DB.prepare(sql),
      batch: async (statements) => {
        const output = await env.DB.batch(statements as D1PreparedStatement[]);
        if (!lost && (await f.row())?.transfer_upload_id) {
          lost = true;
          throw new Error("Lost persisted plan response");
        }
        return output;
      },
    };
    expect(await f.step(db)).toMatchObject({ status: "progress", partsTransferred: 1 });
    expect(lost).toBe(true);
    expect(await f.partRows()).toHaveLength(1);
    await complete(f);
    expect(await f.versions()).toHaveLength(1);
  });
  it("recovers committed completion without a second version or audit after D1 response loss", async () => {
    const f = await fixture();
    await f.step();
    await f.step();
    await f.step();
    let lost = false;
    const db: DatabaseLike = {
      prepare: (sql) => env.DB.prepare(sql),
      batch: async (statements) => {
        const output = await env.DB.batch(statements as D1PreparedStatement[]);
        if (!lost && (await f.row())?.status === "completed") {
          lost = true;
          throw new Error("Lost version completion response");
        }
        return output;
      },
    };
    expect(await f.step(db)).toMatchObject({ status: "completed" });
    expect(lost).toBe(true);
    expect(await f.versions()).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT action FROM audit_log WHERE action='recording_acquisition_completed'"),
    ).toHaveLength(1);
  });
  it("reuses only a live digest with exact owned head and atomically queues duplicate-object cleanup", async () => {
    const f = await fixture();
    await complete(f);
    const prior = await f.versions(),
      second = await f.enqueue();
    await complete(f, second.id);
    expect(await f.versions()).toEqual(prior);
    const receipt = await env.DB.prepare(
      "SELECT completed_version_id,transfer_r2_key FROM event_recording_acquisitions WHERE id=?",
    )
      .bind(second.id)
      .first<{ completed_version_id: string; transfer_r2_key: string }>();
    expect(receipt?.completed_version_id).toBe(prior[0].id);
    expect(await queryAll(env.DB, "SELECT bucket,object_key FROM storage_deletion_outbox")).toEqual([
      { bucket: "speaker_uploads", object_key: receipt?.transfer_r2_key },
    ]);
  });
  it("does not reuse a live version whose actual owned ETag has changed", async () => {
    const f = await fixture();
    await complete(f);
    const prior = await f.versions();
    await f.bucket.put(String(prior[0].r2_key), new Uint8Array(f.data.length));
    const second = await f.enqueue();
    await f.step(env.DB, second.id);
    await f.step(env.DB, second.id);
    await f.step(env.DB, second.id);
    expect(await f.step(env.DB, second.id)).toMatchObject({ status: "failed" });
    expect(await f.versions()).toEqual(prior);
    expect(await queryAll(env.DB, "SELECT id FROM storage_deletion_outbox")).toHaveLength(0);
  });
  it("uses a fresh immutable version and key for the same digest after prior version deletion", async () => {
    const f = await fixture();
    await complete(f);
    const prior = await f.versions();
    await env.DB.prepare("UPDATE event_recording_versions SET deleted_at=? WHERE id=?")
      .bind(nowIso(), prior[0].id)
      .run();
    const second = await f.enqueue();
    await complete(f, second.id);
    const rows = await f.versions();
    expect(rows).toHaveLength(2);
    const fresh = rows.find((row) => row.acquisition_id === second.id);
    expect(fresh?.digest).toBe(prior[0].digest);
    expect(fresh?.r2_key).not.toBe(prior[0].r2_key);
    expect(rows.filter((row) => row.deleted_at === null)).toHaveLength(1);
  });
  it.each(["revision", "revocation", "expiry"])(
    "refuses final part checkpoint on a concurrent %s change",
    async (change) => {
      const f = await fixture();
      f.setBeforeRange(async () => {
        if (change === "revision")
          await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=2 WHERE id=?")
            .bind(f.sourceId)
            .run();
        if (change === "revocation")
          await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
        if (change === "expiry")
          await env.DB.prepare(
            "UPDATE event_recording_acquisitions SET claimed_at='1999-12-31T23:55:00.000Z',lease_expires_at=? WHERE id=?",
          )
            .bind("2000-01-01T00:00:00.000Z", f.intent.id)
            .run();
      });
      expect((await f.step()).status).toBe(change === "expiry" ? "lost_lease" : "failed");
      expect(await f.partRows()).toHaveLength(0);
      expect(await f.versions()).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT action FROM audit_log WHERE action='recording_acquisition_completed'"),
      ).toHaveLength(0);
    },
  );
  it("terminalizes a due revoked requester without provider or storage work", async () => {
    const f = await fixture();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
    expect(await f.step()).toMatchObject({ status: "failed" });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await f.partRows()).toHaveLength(0);
    expect(await f.row()).toMatchObject({ status: "failed", last_failure_kind: "authority_changed" });
  });
  it("keeps a transient download failure retryable without adopting storage or exposing provider diagnostics", async () => {
    const f = await fixture();
    f.fetcher.mockResolvedValueOnce(new Response("PRIVATE_URL_AND_TOKEN", { status: 503 }));
    expect(await f.step()).toEqual({ status: "retrying", partsTransferred: 0, verifiedBytes: 0 });
    expect(await f.row()).toMatchObject({ status: "retrying", last_failure_kind: "download_unavailable" });
    expect(await f.partRows()).toHaveLength(0);
    expect(await f.versions()).toHaveLength(0);
    await f.retryNow();
    await complete(f);
  });
  it("fails binary-container verification instead of creating an immutable media version", async () => {
    const f = await fixture();
    f.data.fill(0);
    await f.step();
    await f.step();
    expect(await f.step()).toMatchObject({ status: "failed" });
    expect(await f.row()).toMatchObject({ status: "failed", last_failure_kind: "integrity_failed" });
    expect(await f.versions()).toHaveLength(0);
  });
  it("aborts an unadopted upload and retains an unrelated database failure as retryable", async () => {
    const f = await fixture();
    await env.DB.prepare(
      `CREATE TRIGGER test_recording_begin_refusal BEFORE UPDATE OF transfer_upload_id
      ON event_recording_acquisitions WHEN NEW.transfer_upload_id IS NOT NULL
      BEGIN SELECT RAISE(ABORT,'TEST_UNRELATED_TRANSFER_FAILURE'); END`,
    ).run();
    const create = f.dependencies.bucket.createMultipartUpload;
    const abort = vi.fn();
    f.dependencies.bucket.createMultipartUpload = async (key, options) => {
      const upload = await create(key, options);
      return {
        key,
        uploadId: upload.uploadId,
        uploadPart: (number, value, options) => upload.uploadPart(number, value, options),
        complete: (parts) => upload.complete(parts),
        abort: async () => {
          abort();
          await upload.abort();
        },
      };
    };
    try {
      expect(await f.step()).toMatchObject({ status: "retrying" });
      expect(abort).toHaveBeenCalledTimes(1);
      expect(await f.row()).toMatchObject({
        status: "retrying",
        last_failure_kind: "storage_unavailable",
        transfer_upload_id: null,
      });
      expect(await f.partRows()).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER test_recording_begin_refusal").run();
    }
  });
  it("terminally refuses altered owned bytes during range verification", async () => {
    const f = await fixture();
    await f.step();
    await f.step();
    const row = await f.row();
    await f.bucket.put(String(row?.transfer_r2_key), new Uint8Array(129));
    expect(await f.step()).toMatchObject({ status: "failed" });
    expect(await f.row()).toMatchObject({ status: "failed", last_failure_kind: "integrity_failed" });
    expect(await f.versions()).toHaveLength(0);
  });
  it("terminally refuses a malformed persisted SHA checkpoint without completing media", async () => {
    const f = await fixture(8 * 1024 ** 2 + 129);
    await f.step();
    await f.step();
    await f.step();
    await f.step();
    await env.DB.prepare("UPDATE event_recording_acquisitions SET verification_checkpoint=? WHERE id=?")
      .bind('{"corrupt":true}', f.intent.id)
      .run();
    expect(await f.step()).toMatchObject({ status: "failed" });
    expect(await f.row()).toMatchObject({ status: "failed", last_failure_kind: "integrity_failed" });
    expect(await f.versions()).toHaveLength(0);
  });
  it("reclaims an expired lease and resumes the exact adopted upload and key", async () => {
    const f = await fixture();
    await f.step();
    const before = await f.row(),
      old = await claimRecordingAcquisition(env.DB, f.intent.id);
    expect(old).not.toBeNull();
    await env.DB.prepare(
      "UPDATE event_recording_acquisitions SET claimed_at='1999-12-31T23:55:00.000Z',lease_expires_at=? WHERE id=?",
    )
      .bind("2000-01-01T00:00:00.000Z", f.intent.id)
      .run();
    expect(await f.step()).toMatchObject({ status: "progress", partsTransferred: 0 });
    expect(await f.row()).toMatchObject({
      transfer_upload_id: before?.transfer_upload_id,
      transfer_r2_key: before?.transfer_r2_key,
      processing_token: null,
      attempts: 0,
    });
    expect(await f.partRows()).toHaveLength(1);
    await complete(f);
    expect(await f.versions()).toHaveLength(1);
  });
  it("retains a committed part after lost database acknowledgment and does not upload it twice", async () => {
    const f = await fixture();
    let lost = false;
    const db: DatabaseLike = {
      prepare: (sql) => env.DB.prepare(sql),
      batch: async (statements) => {
        const output = await env.DB.batch(statements as D1PreparedStatement[]);
        if (!lost && (await f.partRows()).length === 1) {
          lost = true;
          throw new Error("Lost part receipt acknowledgment");
        }
        return output;
      },
    };
    expect(await f.step(db)).toMatchObject({ status: "retrying" });
    expect(await f.partRows()).toHaveLength(1);
    const rangeCount = () =>
      f.fetcher.mock.calls.filter(([, init]) => new Headers(init?.headers).has("If-Match")).length;
    expect(rangeCount()).toBe(1);
    await f.retryNow();
    await complete(f);
    expect(rangeCount()).toBe(1);
    expect(await f.versions()).toHaveLength(1);
  });
});
