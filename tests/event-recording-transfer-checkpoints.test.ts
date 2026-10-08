import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { requireUserBackedAdminFromRequest } from "../functions/_lib/auth/admin";
import { nowIso } from "../functions/_lib/utils/time";
import type { DatabaseLike } from "../functions/_lib/types";
import {
  claimRecordingAcquisition,
  getRecordingAcquisition,
  recordingAcquisitionObjectKey,
  requestRecordingAcquisition,
} from "../functions/_lib/services/event-recordings/acquisitions";
import {
  beginRecordingTransfer,
  recordRecordingPart,
  recordRecordingObject,
  recordRecordingVerification,
  type RecordingTransferPlan,
} from "../functions/_lib/services/event-recordings/transfer-checkpoints";
import type { RecordingPartReceipt } from "../functions/_lib/services/event-recordings/transfer";
import {
  verifyRecordingObjectRange,
  type RecordingVerificationProgress,
} from "../functions/_lib/services/event-recordings/verification";
import { recordingSourceEtagSchema } from "../functions/_lib/services/event-recordings/source-validator";
import { readRecordingTransferState } from "../functions/_lib/services/event-recordings/transfer-state";
import { createAdminSession } from "./helpers/auth";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";

const partBytes = 5 * 1024 ** 2;
async function fixture(totalBytes = 129) {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID());
  const actor = await requireUserBackedAdminFromRequest(
    env.DB,
    new Request("https://test.invalid/", {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
  );
  const sourceId = crypto.randomUUID(),
    now = nowIso();
  const meeting = await seedRecordingMeeting(env.DB, { eventId, userId: admin.id, now });
  await env.DB.prepare(
    `INSERT INTO event_recording_sources(id,event_id,meeting_link_id,provider_type,provider_account_id,
    provider_app_id,provider_meeting_id,provider_session_id,provider_recording_id,provider_status,
    provider_invoked_at,provider_started_at,provider_file_size,metadata_revision,observed_at,
    created_by_user_id,created_at,updated_at) VALUES(?,?,?,'realtimekit',?,'synthetic-app',?,?,?,'UPLOADED',?,?,?,1,?,?,?,?)`,
  )
    .bind(
      sourceId,
      eventId,
      meeting.meetingLinkId,
      meeting.providerAccountId,
      meeting.providerMeetingId,
      crypto.randomUUID(),
      crypto.randomUUID(),
      now,
      now,
      totalBytes,
      now,
      admin.id,
      now,
      now,
    )
    .run();
  const intent = await requestRecordingAcquisition(env.DB, eventId, sourceId, actor, {
    operationId: crypto.randomUUID(),
    expectedMetadataRevision: 1,
  });
  const claim = await claimRecordingAcquisition(env.DB, intent.id);
  if (!claim) throw new Error("Expected an owned acquisition claim");
  const versionId = crypto.randomUUID();
  const plan: RecordingTransferPlan = {
    versionId,
    objectKey: recordingAcquisitionObjectKey(claim, versionId),
    uploadId: crypto.randomUUID(),
    sourceEtag: recordingSourceEtagSchema.parse('"synthetic-source-validator"'),
    partBytes,
    totalBytes,
  };
  const receipt = (partNumber = 1): RecordingPartReceipt => ({
    uploadId: plan.uploadId,
    partNumber,
    etag: `part-${partNumber}`,
    offset: (partNumber - 1) * partBytes,
    bytes: Math.min(partBytes, totalBytes - (partNumber - 1) * partBytes),
  });
  const reclaim = async () => {
    await env.DB.prepare("UPDATE event_recording_acquisitions SET claimed_at=?,lease_expires_at=? WHERE id=?")
      .bind("2000-01-01T00:00:00.000Z", "2000-01-01T00:05:00.000Z", intent.id)
      .run();
    const next = await claimRecordingAcquisition(env.DB, intent.id);
    if (!next) throw new Error("Expected a reclaimed acquisition");
    return next;
  };
  return { eventId, admin, actor, sourceId, intent, claim, plan, receipt, reclaim };
}
const state = () =>
  queryAll(
    env.DB,
    `SELECT id,status,attempts,transfer_version_id,transfer_r2_key,
  transfer_upload_id,transfer_source_etag,transfer_part_bytes,transfer_total_bytes,verification_object_etag,
  verification_offset,verification_checkpoint,verified_digest,verified_mime_type,updated_at
  FROM event_recording_acquisitions ORDER BY id`,
  );
const parts = () =>
  queryAll(
    env.DB,
    `SELECT event_id,source_id,acquisition_id,upload_id,part_number,
  etag,byte_offset,byte_length,recorded_at FROM event_recording_parts ORDER BY part_number`,
  );
const effects = async () => ({
  state: await state(),
  parts: await parts(),
  audits: await queryAll(env.DB, "SELECT action,entity_id FROM audit_log WHERE action LIKE 'recording_%' ORDER BY id"),
  versions: await queryAll(env.DB, "SELECT id FROM event_recording_versions"),
});
function loseCommittedResponse(): DatabaseLike {
  let lost = false;
  return {
    prepare: (sql) => env.DB.prepare(sql),
    batch: async (statements) => {
      const result = await env.DB.batch(statements as D1PreparedStatement[]);
      if (!lost) {
        lost = true;
        throw new Error("Lost committed checkpoint response");
      }
      return result;
    },
  };
}
async function preparedObject(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await beginRecordingTransfer(env.DB, f.claim, f.plan)).toBe(true);
  expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt())).toBe(true);
  expect(await recordRecordingObject(env.DB, f.claim, f.plan, "owned-etag")).toBe(true);
}
const finalProgress = (bytes: number): RecordingVerificationProgress => ({
  verifiedBytes: bytes,
  checkpoint: null,
  sha256: "a".repeat(64),
  mimeType: "video/mp4",
});

describe("durable lease-owned recording transfer checkpoints", () => {
  beforeEach(resetDb);
  it("replays the identical plan and part without another write or audit", async () => {
    const f = await fixture();
    expect(await beginRecordingTransfer(env.DB, f.claim, f.plan)).toBe(true);
    expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt())).toBe(true);
    const before = await effects();
    expect(await beginRecordingTransfer(env.DB, f.claim, f.plan)).toBe(true);
    expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt())).toBe(true);
    expect(await effects()).toEqual(before);
    expect(before.audits).toHaveLength(1);
    expect(before.versions).toEqual([]);
  });
  it("reads the exact private transfer state for the current reclaimed lease only", async () => {
    const f = await fixture(partBytes + 7);
    expect(await readRecordingTransferState(env.DB, f.claim)).toEqual({
      plan: null,
      parts: [],
      objectEtag: null,
      verifiedBytes: 0,
      checkpoint: null,
      sha256: null,
      mimeType: null,
    });
    await beginRecordingTransfer(env.DB, f.claim, f.plan);
    await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt(2));
    await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt(1));
    await recordRecordingObject(env.DB, f.claim, f.plan, "owned-etag");
    const current = await f.reclaim(),
      before = await effects();
    expect(await readRecordingTransferState(env.DB, f.claim)).toBeNull();
    expect(await readRecordingTransferState(env.DB, current)).toEqual({
      plan: f.plan,
      parts: [f.receipt(1), f.receipt(2)],
      objectEtag: "owned-etag",
      verifiedBytes: 0,
      checkpoint: null,
      sha256: null,
      mimeType: null,
    });
    const publicReceipt = await getRecordingAcquisition(env.DB, f.eventId, f.sourceId, f.intent.id, f.actor);
    expect(publicReceipt).toMatchObject({ status: "processing", attempts: 2 });
    for (const privateValue of [f.plan.objectKey, f.plan.uploadId, f.plan.sourceEtag, "owned-etag"])
      expect(JSON.stringify(publicReceipt)).not.toContain(privateValue);
    expect(publicReceipt).not.toHaveProperty("checkpoint");
    expect(await effects()).toEqual(before);
  });
  it.each(["key", "upload", "bytes", "version", "source_validator"])(
    "refuses a different %s plan without partial effects",
    async (difference) => {
      const f = await fixture();
      await beginRecordingTransfer(env.DB, f.claim, f.plan);
      const changed = { ...f.plan };
      if (difference === "key") changed.objectKey = "foreign/object";
      if (difference === "upload") changed.uploadId = crypto.randomUUID();
      if (difference === "bytes") changed.totalBytes++;
      if (difference === "version") changed.versionId = crypto.randomUUID();
      if (difference === "source_validator") changed.sourceEtag = recordingSourceEtagSchema.parse('"different-source"');
      const before = await effects();
      expect(await beginRecordingTransfer(env.DB, f.claim, changed)).toBe(false);
      expect(await effects()).toEqual(before);
    },
  );
  it.each(["upload", "offset", "bytes", "etag", "number"])(
    "refuses a mismatched %s part receipt",
    async (difference) => {
      const f = await fixture();
      await beginRecordingTransfer(env.DB, f.claim, f.plan);
      const original = f.receipt();
      await recordRecordingPart(env.DB, f.claim, f.plan, original);
      const changed = { ...original };
      if (difference === "upload") changed.uploadId = "another-upload";
      if (difference === "offset") changed.offset++;
      if (difference === "bytes") changed.bytes--;
      if (difference === "etag") changed.etag = "another-etag";
      if (difference === "number") changed.partNumber = 2;
      const before = await effects();
      expect(await recordRecordingPart(env.DB, f.claim, f.plan, changed)).toBe(false);
      expect(await effects()).toEqual(before);
    },
  );
  it("binds every progress receipt to the originally persisted source validator", async () => {
    const f = await fixture();
    await beginRecordingTransfer(env.DB, f.claim, f.plan);
    await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt());
    const forged = { ...f.plan, sourceEtag: recordingSourceEtagSchema.parse('"forged-source-validator"') };
    const before = await effects();
    expect(await recordRecordingPart(env.DB, f.claim, forged, f.receipt())).toBe(false);
    expect(await recordRecordingObject(env.DB, f.claim, forged, "owned-etag")).toBe(false);
    expect(await effects()).toEqual(before);
    expect(await recordRecordingObject(env.DB, f.claim, f.plan, "owned-etag")).toBe(true);
    const storedObject = await effects();
    expect(
      await recordRecordingVerification(env.DB, f.claim, forged, "owned-etag", 0, finalProgress(f.plan.totalBytes)),
    ).toBe(false);
    expect(await effects()).toEqual(storedObject);
  });
  it("requires every exact part including the short final part before object completion", async () => {
    const f = await fixture(2 * partBytes + 7);
    await beginRecordingTransfer(env.DB, f.claim, f.plan);
    await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt(1));
    await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt(3));
    const gap = await effects();
    expect(await recordRecordingObject(env.DB, f.claim, f.plan, "owned-etag")).toBe(false);
    expect(await effects()).toEqual(gap);
    expect(await recordRecordingPart(env.DB, f.claim, f.plan, { ...f.receipt(2), bytes: partBytes - 1 })).toBe(false);
    expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt(4))).toBe(false);
    expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt(2))).toBe(true);
    expect(await recordRecordingObject(env.DB, f.claim, f.plan, "owned-etag")).toBe(true);
    expect((await state())[0].verification_object_etag).toBe("owned-etag");
    const finished = await effects();
    expect(await recordRecordingObject(env.DB, f.claim, f.plan, "changed-etag")).toBe(false);
    expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt(1))).toBe(false);
    expect(await effects()).toEqual(finished);
  });
  it.each(["source", "permission", "expired"])(
    "refuses all %s progress with zero dependent effects",
    async (change) => {
      const f = await fixture();
      await preparedObject(f);
      if (change === "source")
        await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=2 WHERE id=?")
          .bind(f.sourceId)
          .run();
      if (change === "permission")
        await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
      if (change === "expired")
        await env.DB.prepare("UPDATE event_recording_acquisitions SET claimed_at=?,lease_expires_at=? WHERE id=?")
          .bind("2000-01-01T00:00:00.000Z", "2000-01-01T00:05:00.000Z", f.intent.id)
          .run();
      const before = await effects();
      expect(await readRecordingTransferState(env.DB, f.claim)).toBeNull();
      expect(await beginRecordingTransfer(env.DB, f.claim, f.plan)).toBe(false);
      expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt())).toBe(false);
      expect(await recordRecordingObject(env.DB, f.claim, f.plan, "owned-etag")).toBe(false);
      expect(
        await recordRecordingVerification(env.DB, f.claim, f.plan, "owned-etag", 0, finalProgress(f.plan.totalBytes)),
      ).toBe(false);
      expect(await effects()).toEqual(before);
    },
  );
  it("reclaims the stable transfer plan while refusing every old-token progress write", async () => {
    const f = await fixture();
    await beginRecordingTransfer(env.DB, f.claim, f.plan);
    const current = await f.reclaim();
    const before = await effects();
    expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt())).toBe(false);
    expect(await effects()).toEqual(before);
    expect(recordingAcquisitionObjectKey(current, f.plan.versionId)).toBe(f.plan.objectKey);
    expect(await beginRecordingTransfer(env.DB, current, f.plan)).toBe(true);
    expect(await recordRecordingPart(env.DB, current, f.plan, f.receipt())).toBe(true);
    expect(await recordRecordingObject(env.DB, current, f.plan, "owned-etag")).toBe(true);
    expect(
      await recordRecordingVerification(env.DB, f.claim, f.plan, "owned-etag", 0, finalProgress(f.plan.totalBytes)),
    ).toBe(false);
    expect(
      await recordRecordingVerification(env.DB, current, f.plan, "owned-etag", 0, finalProgress(f.plan.totalBytes)),
    ).toBe(true);
    expect((await state())[0].verified_digest).toBe("a".repeat(64));
  });
  it.each(["etag", "offset", "length", "digest"])(
    "rejects changed final %s without verification effects",
    async (change) => {
      const f = await fixture();
      await preparedObject(f);
      const before = await effects();
      const progress = finalProgress(f.plan.totalBytes);
      if (progress.checkpoint !== null) throw new Error("Expected final fixture");
      if (change === "length") progress.verifiedBytes--;
      if (change === "digest") progress.sha256 = "not-a-digest";
      expect(
        await recordRecordingVerification(
          env.DB,
          f.claim,
          f.plan,
          change === "etag" ? "changed" : "owned-etag",
          change === "offset" ? 64 : 0,
          progress,
        ),
      ).toBe(false);
      expect(await effects()).toEqual(before);
    },
  );
  it("recovers exact plan and part receipts after actual committed responses are lost", async () => {
    const f = await fixture();
    await expect(beginRecordingTransfer(loseCommittedResponse(), f.claim, f.plan)).rejects.toThrow("Lost committed");
    expect(await beginRecordingTransfer(env.DB, f.claim, f.plan)).toBe(true);
    await expect(recordRecordingPart(loseCommittedResponse(), f.claim, f.plan, f.receipt())).rejects.toThrow(
      "Lost committed",
    );
    const before = await effects();
    expect(await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt())).toBe(true);
    expect(await effects()).toEqual(before);
  });
  it("refuses malformed or unaligned pending verification without changing durable progress", async () => {
    const f = await fixture();
    await preparedObject(f);
    const before = await effects();
    for (const progress of [
      { verifiedBytes: 64, checkpoint: "{}" },
      { verifiedBytes: 63, checkpoint: "{}" },
    ]) {
      expect(await recordRecordingVerification(env.DB, f.claim, f.plan, "owned-etag", 0, progress)).toBe(false);
    }
    expect(await effects()).toEqual(before);
  });
  it("recovers a final verification receipt after its actual successful commit response is lost", async () => {
    const f = await fixture();
    await preparedObject(f);
    const final = finalProgress(f.plan.totalBytes);
    await expect(
      recordRecordingVerification(loseCommittedResponse(), f.claim, f.plan, "owned-etag", 0, final),
    ).rejects.toThrow("Lost committed");
    const committed = await effects();
    expect(await recordRecordingVerification(env.DB, f.claim, f.plan, "owned-etag", 0, final)).toBe(true);
    expect(await effects()).toEqual(committed);
    expect(committed.state[0]).toMatchObject({
      verification_offset: f.plan.totalBytes,
      verified_digest: "a".repeat(64),
      verified_mime_type: "video/mp4",
      status: "processing",
    });
    expect(committed.versions).toEqual([]);
  });
  it("persists actual R2 range checkpoints and full digest through reclaimed leases and lost acknowledgments", async () => {
    const f = await fixture(),
      bucket = env.SPEAKER_UPLOADS_BUCKET;
    if (!bucket) throw new Error("Worker R2 fixture binding missing");
    const bytes = Uint8Array.from({ length: f.plan.totalBytes }, (_, index) => index % 251);
    bytes.set([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 109, 112, 52, 50]);
    const object = await bucket.put(f.plan.objectKey, bytes);
    if (!object) throw new Error("Expected owned R2 object");
    try {
      await beginRecordingTransfer(env.DB, f.claim, f.plan);
      await recordRecordingPart(env.DB, f.claim, f.plan, f.receipt());
      await recordRecordingObject(env.DB, f.claim, f.plan, object.etag);
      const captured: RecordingVerificationProgress[] = [];
      const initial = {
        objectKey: f.plan.objectKey,
        objectEtag: object.etag,
        expectedBytes: bytes.length,
        leaseToken: f.claim.lease.token,
        priorOffset: 0,
        checkpoint: null,
        rangeBytes: 64,
      };
      await verifyRecordingObjectRange(
        initial,
        {
          storage: bucket,
          checkpoint: {
            recordVerification: async (progress) => {
              captured.push(progress);
              return true;
            },
          },
        },
        2000,
      );
      const pending = captured[0];
      if (!pending || pending.checkpoint === null) throw new Error("Expected canonical SHA checkpoint");
      await expect(
        recordRecordingVerification(loseCommittedResponse(), f.claim, f.plan, object.etag, 0, pending),
      ).rejects.toThrow("Lost committed");
      const before = await effects();
      expect(await recordRecordingVerification(env.DB, f.claim, f.plan, object.etag, 0, pending)).toBe(true);
      expect(await effects()).toEqual(before);
      expect(await readRecordingTransferState(env.DB, f.claim)).toEqual({
        plan: f.plan,
        parts: [f.receipt()],
        objectEtag: object.etag,
        verifiedBytes: pending.verifiedBytes,
        checkpoint: pending.checkpoint,
        sha256: null,
        mimeType: null,
      });
      const current = await f.reclaim();
      const result = await verifyRecordingObjectRange(
        {
          ...initial,
          leaseToken: current.lease.token,
          priorOffset: pending.verifiedBytes,
          checkpoint: pending.checkpoint,
          rangeBytes: 128,
        },
        {
          storage: bucket,
          checkpoint: {
            recordVerification: async (progress) => {
              captured.push(progress);
              return recordRecordingVerification(env.DB, current, f.plan, object.etag, pending.verifiedBytes, progress);
            },
          },
        },
        2000,
      );
      expect(result.status).toBe("verified");
      const final = captured[1];
      if (!final || final.checkpoint !== null) throw new Error("Expected canonical final digest");
      const expected = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      expect(final.sha256).toBe(expected);
      expect((await state())[0]).toMatchObject({
        verification_offset: bytes.length,
        verification_checkpoint: null,
        verified_digest: expected,
        verified_mime_type: "video/mp4",
        status: "processing",
      });
      expect(await readRecordingTransferState(env.DB, current)).toEqual({
        plan: f.plan,
        parts: [f.receipt()],
        objectEtag: object.etag,
        verifiedBytes: bytes.length,
        checkpoint: null,
        sha256: expected,
        mimeType: "video/mp4",
      });
      const finished = await effects();
      expect(
        await recordRecordingVerification(env.DB, current, f.plan, object.etag, pending.verifiedBytes, final),
      ).toBe(true);
      expect(
        await recordRecordingVerification(env.DB, current, f.plan, object.etag, pending.verifiedBytes, {
          ...final,
          sha256: "b".repeat(64),
        }),
      ).toBe(false);
      expect(await effects()).toEqual(finished);
    } finally {
      await bucket.delete(f.plan.objectKey);
    }
  });
});
