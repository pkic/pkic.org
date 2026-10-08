import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserBackedAdminFromRequest } from "../functions/_lib/auth/admin";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import { SCHEDULED_JOB_DEFINITIONS } from "../functions/_lib/services/scheduled-jobs/registry";
import { eventRecordingAcquireSchema } from "../assets/shared/schemas/event-recordings";
import {
  claimRecordingAcquisition,
  finishRecordingAcquisitionFailure,
  prepareRecordingAcquisitionCompletion,
  recordingAcquisitionObjectKey,
  requestRecordingAcquisition,
} from "../functions/_lib/services/event-recordings/acquisitions";
import {
  cleanupRecordingAcquisition,
  dueRecordingAcquisitionCleanupIds,
  terminalizeUnclaimableRecordingAcquisition,
  type RecordingAcquisitionCleanupStorage,
} from "../functions/_lib/services/event-recordings/acquisition-cleanup";
import { beginRecordingTransfer } from "../functions/_lib/services/event-recordings/transfer-checkpoints";
import { nowIso } from "../functions/_lib/utils/time";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";
import { resetDb } from "./helpers/reset-db";

async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB),
    now = nowIso();
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId: admin.id, now });
  const sourceId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_recording_sources
    (id,event_id,meeting_link_id,provider_type,provider_account_id,provider_app_id,provider_meeting_id,
    provider_session_id,provider_recording_id,provider_status,provider_invoked_at,provider_started_at,
    provider_file_size,metadata_revision,observed_at,created_by_user_id,created_at,updated_at)
    VALUES(?,?,?,'realtimekit',?,?,?, ?,?,'UPLOADED',?,?,16,1,?,?,?,?)`,
  )
    .bind(
      sourceId,
      eventId,
      meeting.meetingLinkId,
      meeting.providerAccountId,
      meeting.providerAppId,
      meeting.providerMeetingId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      now,
      now,
      now,
      admin.id,
      now,
      now,
    )
    .run();
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const actor = await requireUserBackedAdminFromRequest(
    env.DB,
    new Request("https://test.invalid/", { headers: { authorization: `Bearer ${token}` } }),
    env,
  );
  const receipt = await requestRecordingAcquisition(
    env.DB,
    eventId,
    sourceId,
    actor,
    eventRecordingAcquireSchema.parse({ operationId: crypto.randomUUID(), expectedMetadataRevision: 1 }),
  );
  const claim = async () => {
    const owned = await claimRecordingAcquisition(env.DB, receipt.id);
    if (!owned) throw new Error("Expected a live acquisition claim");
    return owned;
  };
  const transfer = async () => {
    const owned = await claim(),
      versionId = crypto.randomUUID();
    const plan = {
      versionId,
      objectKey: recordingAcquisitionObjectKey(owned, versionId),
      uploadId: crypto.randomUUID(),
      sourceEtag: '"synthetic-source-etag"',
      partBytes: 5 * 1024 ** 2,
      totalBytes: 16,
    };
    expect(await beginRecordingTransfer(env.DB, owned, plan)).toBe(true);
    return { owned, plan };
  };
  const failTransfer = async () => {
    const result = await transfer();
    await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?").bind(nowIso(), sourceId).run();
    expect(await finishRecordingAcquisitionFailure(env.DB, result.owned, "source_changed")).toBe(true);
    await env.DB.prepare("UPDATE event_recording_acquisitions SET next_attempt_at=? WHERE id=?")
      .bind(nowIso(), receipt.id)
      .run();
    return result;
  };
  return { eventId, admin, sourceId, id: receipt.id, claim, transfer, failTransfer };
}
async function intent(id: string) {
  return env.DB.prepare(
    `SELECT status,last_failure_kind,attempts,next_attempt_at,processing_token,claimed_at,
    lease_expires_at,completed_version_id,transfer_version_id,transfer_r2_key,transfer_upload_id,
    transfer_source_etag,transfer_part_bytes,transfer_total_bytes,verification_object_etag,
    verification_offset,verification_checkpoint,verified_digest,verified_mime_type
    FROM event_recording_acquisitions WHERE id=?`,
  )
    .bind(id)
    .first();
}
const deletions = () =>
  queryAll(env.DB, "SELECT bucket,object_key,status FROM storage_deletion_outbox ORDER BY object_key");
const cleanupAudits = () =>
  queryAll(
    env.DB,
    "SELECT action,entity_id FROM audit_log WHERE action IN('recording_acquisition_cancelled','recording_acquisition_cleanup_completed') ORDER BY action",
  );
const revoke = (id: string) =>
  env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), id).run();
const restore = (id: string) => env.DB.prepare("UPDATE user_roles SET revoked_at=NULL WHERE user_id=?").bind(id).run();
const storage = (outcome: "aborted" | "already_terminated" = "aborted") =>
  ({ abortMultipart: vi.fn(async () => outcome) }) satisfies RecordingAcquisitionCleanupStorage;

describe("owned recording acquisition terminal disposition and cleanup", () => {
  beforeEach(resetDb);

  it("uses the same scheduler owner to abort and hand off failed private uploads after provider config removal", async () => {
    const f = await fixture();
    const bucket = env.SPEAKER_UPLOADS_BUCKET;
    if (!bucket) throw new Error("Expected native private recording bucket");
    const owned = await f.claim(),
      versionId = crypto.randomUUID();
    const objectKey = recordingAcquisitionObjectKey(owned, versionId);
    const upload = await bucket.createMultipartUpload(objectKey, {
      customMetadata: {
        eventId: f.eventId,
        sourceId: f.sourceId,
        acquisitionId: f.id,
        versionId,
      },
    });
    expect(
      await beginRecordingTransfer(env.DB, owned, {
        versionId,
        objectKey,
        uploadId: upload.uploadId,
        sourceEtag: '"synthetic-source-etag"',
        partBytes: 5 * 1024 ** 2,
        totalBytes: 16,
      }),
    ).toBe(true);
    await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?")
      .bind(nowIso(), f.sourceId)
      .run();
    expect(await finishRecordingAcquisitionFailure(env.DB, owned, "source_changed")).toBe(true);
    await env.DB.prepare("UPDATE event_recording_acquisitions SET next_attempt_at=? WHERE id=?")
      .bind(nowIso(), f.id)
      .run();
    const definition = SCHEDULED_JOB_DEFINITIONS.find((job) => job.key === "recording_acquisitions");
    if (!definition) throw new Error("Expected canonical recording retry owner");
    const provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Provider must not be contacted"));
    try {
      const { db, budget } = createD1QueryBudgetedDatabase(env.DB, 200);
      const result = await definition.run({
        env: {
          ...env,
          DB: db,
          SPEAKER_UPLOADS_BUCKET: bucket,
          REALTIMEKIT_ACCOUNT_ID: undefined,
          REALTIMEKIT_APP_ID: undefined,
          REALTIMEKIT_API_TOKEN: undefined,
          REALTIMEKIT_RECORDING_DOWNLOAD_ORIGINS: "invalid JSON",
        },
        d1QueryBudget: budget,
      });
      expect(result).toMatchObject({
        summary: { configuration: "unavailable", selected: 0, processed: 0, cleanupSelected: 1, cleanupCompleted: 1 },
      });
      expect(provider).not.toHaveBeenCalled();
      expect(await intent(f.id)).toMatchObject({
        status: "failed",
        last_failure_kind: "source_changed",
        transfer_upload_id: null,
        transfer_r2_key: null,
        processing_token: null,
      });
      expect(await deletions()).toEqual([{ bucket: "speaker_uploads", object_key: objectKey, status: "queued" }]);
    } finally {
      provider.mockRestore();
    }
  });

  it.each(["revoked", "inactive", "disabled", "revision", "provider status"] as const)(
    "retires due %s intent once with fixed disposition",
    async (change) => {
      const f = await fixture();
      if (change === "revoked") await revoke(f.admin.id);
      else if (change === "inactive")
        await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(f.admin.id).run();
      else if (change === "disabled")
        await env.DB.prepare("UPDATE event_recording_sources SET disabled_at=? WHERE id=?")
          .bind(nowIso(), f.sourceId)
          .run();
      else if (change === "revision")
        await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=2 WHERE id=?")
          .bind(f.sourceId)
          .run();
      else
        await env.DB.prepare("UPDATE event_recording_sources SET provider_status='ERRORED' WHERE id=?")
          .bind(f.sourceId)
          .run();
      expect(await claimRecordingAcquisition(env.DB, f.id)).toBeNull();
      expect(await terminalizeUnclaimableRecordingAcquisition(env.DB, f.id)).toBe(true);
      expect(await intent(f.id)).toMatchObject({
        status: "failed",
        last_failure_kind: ["revoked", "inactive"].includes(change) ? "authority_changed" : "source_changed",
        processing_token: null,
        completed_version_id: null,
      });
      expect(await terminalizeUnclaimableRecordingAcquisition(env.DB, f.id)).toBe(false);
      expect(await cleanupAudits()).toEqual([{ action: "recording_acquisition_cancelled", entity_id: f.id }]);
      expect(await deletions()).toEqual([]);
    },
  );

  it.each(["healthy", "not due", "live lease"] as const)("leaves %s acquisition unchanged", async (state) => {
    const f = await fixture();
    if (state === "live lease") await f.claim();
    if (state !== "healthy") await revoke(f.admin.id);
    if (state === "not due")
      await env.DB.prepare("UPDATE event_recording_acquisitions SET next_attempt_at=? WHERE id=?")
        .bind("2099-01-01T00:00:00.000Z", f.id)
        .run();
    const before = await intent(f.id);
    expect(await terminalizeUnclaimableRecordingAcquisition(env.DB, f.id)).toBe(false);
    expect(await intent(f.id)).toEqual(before);
    expect(await cleanupAudits()).toEqual([]);
  });

  it.each(["authority", "source"] as const)("rechecks restored %s inside the cancellation batch", async (restored) => {
    const f = await fixture();
    if (restored === "authority") await revoke(f.admin.id);
    else
      await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=2 WHERE id=?").bind(f.sourceId).run();
    const raced = mutateBeforeNextBatch(env.DB, async () => {
      if (restored === "authority") await restore(f.admin.id);
      else
        await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=1 WHERE id=?")
          .bind(f.sourceId)
          .run();
    });
    expect(await terminalizeUnclaimableRecordingAcquisition(raced, f.id)).toBe(false);
    expect(await intent(f.id)).toMatchObject({ status: "queued", last_failure_kind: null });
    expect(await cleanupAudits()).toEqual([]);
  });

  it("cannot cancel a successor's actual restored-authority lease", async () => {
    const f = await fixture();
    await revoke(f.admin.id);
    let token: string | undefined;
    const raced = mutateBeforeNextBatch(env.DB, async () => {
      await restore(f.admin.id);
      token = (await f.claim()).lease.token;
    });
    expect(await terminalizeUnclaimableRecordingAcquisition(raced, f.id)).toBe(false);
    expect(await intent(f.id)).toMatchObject({ status: "processing", processing_token: token });
    expect(await cleanupAudits()).toEqual([]);
  });

  it("retires an expired transfer lease without losing its multipart cleanup tuple", async () => {
    const f = await fixture(),
      { plan } = await f.transfer();
    await revoke(f.admin.id);
    await env.DB.prepare("UPDATE event_recording_acquisitions SET claimed_at=?,lease_expires_at=? WHERE id=?")
      .bind("2000-01-01T00:00:00.000Z", "2000-01-01T00:05:00.000Z", f.id)
      .run();
    expect(await terminalizeUnclaimableRecordingAcquisition(env.DB, f.id)).toBe(true);
    expect(await intent(f.id)).toMatchObject({
      status: "failed",
      last_failure_kind: "authority_changed",
      transfer_r2_key: plan.objectKey,
      transfer_upload_id: plan.uploadId,
    });
    expect(await dueRecordingAcquisitionCleanupIds(env.DB, 1)).toEqual([f.id]);
  });

  it("retains the exact tuple after abort failure without storing external error text", async () => {
    const f = await fixture(),
      { plan } = await f.failTransfer();
    const unavailable = {
      abortMultipart: vi.fn(async () => {
        throw new Error("private provider credential");
      }),
    };
    expect(await cleanupRecordingAcquisition(env.DB, f.id, unavailable)).toBe(false);
    const retained = await intent(f.id);
    expect(retained).toMatchObject({
      status: "failed",
      last_failure_kind: "source_changed",
      transfer_r2_key: plan.objectKey,
      transfer_upload_id: plan.uploadId,
      processing_token: null,
    });
    expect(JSON.stringify(retained)).not.toContain("private provider credential");
    expect(await dueRecordingAcquisitionCleanupIds(env.DB, 100)).toEqual([]);
    expect(await deletions()).toEqual([]);
    expect(await cleanupAudits()).toEqual([]);
  });

  it.each(["aborted", "already_terminated"] as const)(
    "atomically hands confirmed %s cleanup to the existing deletion owner once",
    async (outcome) => {
      const f = await fixture(),
        { plan } = await f.failTransfer(),
        backend = storage(outcome);
      expect(await cleanupRecordingAcquisition(env.DB, f.id, backend)).toBe(true);
      expect(backend.abortMultipart).toHaveBeenCalledExactlyOnceWith({
        objectKey: plan.objectKey,
        uploadId: plan.uploadId,
        objectEtag: null,
      });
      expect(await intent(f.id)).toMatchObject({
        status: "failed",
        transfer_r2_key: null,
        transfer_upload_id: null,
        transfer_version_id: null,
        verification_offset: 0,
        verification_checkpoint: null,
        verified_digest: null,
        verified_mime_type: null,
        processing_token: null,
      });
      expect(await deletions()).toEqual([{ bucket: "speaker_uploads", object_key: plan.objectKey, status: "queued" }]);
      expect(await cleanupRecordingAcquisition(env.DB, f.id, backend)).toBe(false);
      expect(backend.abortMultipart).toHaveBeenCalledTimes(1);
      expect(await cleanupAudits()).toEqual([{ action: "recording_acquisition_cleanup_completed", entity_id: f.id }]);
    },
  );

  it("preserves the tuple when abort succeeds but its atomic completion fails, then retries already-terminated safely", async () => {
    const f = await fixture(),
      { plan } = await f.failTransfer(),
      backend = storage();
    const raced = mutateBeforeNextBatch(env.DB, async () => {
      throw new Error("Synthetic D1 commit unavailable");
    });
    await expect(cleanupRecordingAcquisition(raced, f.id, backend)).rejects.toThrow("Synthetic D1 commit unavailable");
    expect(await intent(f.id)).toMatchObject({
      transfer_r2_key: plan.objectKey,
      transfer_upload_id: plan.uploadId,
      processing_token: null,
    });
    expect(await deletions()).toEqual([]);
    await env.DB.prepare("UPDATE event_recording_acquisitions SET next_attempt_at=? WHERE id=?")
      .bind(nowIso(), f.id)
      .run();
    expect(await cleanupRecordingAcquisition(env.DB, f.id, storage("already_terminated"))).toBe(true);
    expect(await deletions()).toHaveLength(1);
  });

  it("cannot finish cleanup or clear a successor cleanup lease after external abort", async () => {
    const f = await fixture(),
      { plan } = await f.failTransfer(),
      token = crypto.randomUUID();
    const backend: RecordingAcquisitionCleanupStorage = {
      abortMultipart: vi.fn(async (): Promise<"aborted"> => {
        await env.DB.prepare(
          "UPDATE event_recording_acquisitions SET processing_token=?,claimed_at=?,lease_expires_at=? WHERE id=?",
        )
          .bind(token, nowIso(), "2099-01-01T00:00:00.000Z", f.id)
          .run();
        return "aborted";
      }),
    };
    expect(await cleanupRecordingAcquisition(env.DB, f.id, backend)).toBe(false);
    expect(await intent(f.id)).toMatchObject({
      transfer_r2_key: plan.objectKey,
      transfer_upload_id: plan.uploadId,
      processing_token: token,
    });
    expect(await deletions()).toEqual([]);
    expect(await cleanupAudits()).toEqual([]);
  });

  it("refuses arbitrary keys without abort or deletion", async () => {
    const f = await fixture();
    await f.failTransfer();
    await env.DB.prepare("UPDATE event_recording_acquisitions SET transfer_r2_key='unrelated-object' WHERE id=?")
      .bind(f.id)
      .run();
    const before = await intent(f.id),
      backend = storage();
    expect(await cleanupRecordingAcquisition(env.DB, f.id, backend)).toBe(false);
    expect(backend.abortMultipart).not.toHaveBeenCalled();
    expect(await intent(f.id)).toEqual(before);
    expect(await deletions()).toEqual([]);
  });

  it("does not abort or enqueue deletion for an immutable version referencing an incomplete intent", async () => {
    const f = await fixture(),
      { plan } = await f.failTransfer();
    await env.DB.prepare(
      `INSERT INTO event_recording_versions
      (id,event_id,source_id,acquisition_id,version_number,source_metadata_revision,r2_key,digest,file_size,mime_type,object_etag,acquired_at)
      VALUES(?,?,?,?,1,1,?,?,16,'video/mp4','verified-etag',?)`,
    )
      .bind(plan.versionId, f.eventId, f.sourceId, f.id, plan.objectKey, "a".repeat(64), nowIso())
      .run();
    const before = await intent(f.id),
      backend = storage();
    expect(await cleanupRecordingAcquisition(env.DB, f.id, backend)).toBe(false);
    expect(await dueRecordingAcquisitionCleanupIds(env.DB, 100)).toEqual([]);
    expect(backend.abortMultipart).not.toHaveBeenCalled();
    expect(await intent(f.id)).toEqual(before);
    expect(await deletions()).toEqual([]);
    expect(await cleanupAudits()).toEqual([]);
  });

  it("never cancels or cleans a completed immutable version", async () => {
    const f = await fixture(),
      { owned, plan } = await f.transfer();
    await env.DB.batch(
      prepareRecordingAcquisitionCompletion(env.DB, owned, {
        id: plan.versionId,
        eventId: f.eventId,
        sourceId: f.sourceId,
        acquisitionId: f.id,
        version: 1,
        sourceMetadataRevision: 1,
        r2Key: plan.objectKey,
        objectETag: "verified-etag",
        digest: "a".repeat(64),
        fileBytes: 16,
        mimeType: "video/mp4",
        acquiredAt: nowIso(),
        deletedAt: null,
      }),
    );
    await revoke(f.admin.id);
    const before = await intent(f.id),
      backend = storage();
    expect(await terminalizeUnclaimableRecordingAcquisition(env.DB, f.id)).toBe(false);
    expect(await cleanupRecordingAcquisition(env.DB, f.id, backend)).toBe(false);
    expect(await dueRecordingAcquisitionCleanupIds(env.DB, 100)).toEqual([]);
    expect(backend.abortMultipart).not.toHaveBeenCalled();
    expect(await intent(f.id)).toEqual(before);
    expect(await deletions()).toEqual([]);
  });
});
