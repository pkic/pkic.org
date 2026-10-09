import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { requireUserBackedAdminFromRequest } from "../functions/_lib/auth/admin";
import {
  requestRecordingAcquisition,
  claimRecordingAcquisition,
  recordingAcquisitionObjectKey,
  finishRecordingAcquisitionProgress,
  finishRecordingAcquisitionFailure,
  type RecordingAcquisitionProgressProof,
} from "../functions/_lib/services/event-recordings/acquisitions";
import {
  beginRecordingTransfer,
  recordRecordingPart,
  recordRecordingObject,
  recordRecordingVerification,
} from "../functions/_lib/services/event-recordings/transfer-checkpoints";
import { verifyRecordingObjectRange } from "../functions/_lib/services/event-recordings/verification";
import { nowIso } from "../functions/_lib/utils/time";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { seedRecordingMeeting } from "./helpers/event-recording-fixtures";

async function fixture(kind: "part" | "object" | "verification" | "final" = "part") {
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
    created_by_user_id,created_at,updated_at) VALUES(?,?,?,'realtimekit',?,'synthetic-app',?,?,?,'UPLOADED',?,?,128,1,?,?,?,?)`,
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
  await env.DB.prepare("UPDATE event_recording_acquisitions SET attempts=9 WHERE id=?").bind(intent.id).run();
  const claim = await claimRecordingAcquisition(env.DB, intent.id);
  if (!claim) throw new Error("Expected current acquisition lease");
  const versionId = crypto.randomUUID(),
    plan = {
      versionId,
      objectKey: recordingAcquisitionObjectKey(claim, versionId),
      uploadId: crypto.randomUUID(),
      sourceEtag: '"original-source"',
      partBytes: 5 * 1024 ** 2,
      totalBytes: 128,
    };
  expect(await beginRecordingTransfer(env.DB, claim, plan)).toBe(true);
  const receipt = { uploadId: plan.uploadId, partNumber: 1, etag: "part-etag", offset: 0, bytes: 128 };
  expect(await recordRecordingPart(env.DB, claim, plan, receipt)).toBe(true);
  let proof: RecordingAcquisitionProgressProof = {
    kind: "part",
    uploadId: plan.uploadId,
    partNumber: 1,
    etag: receipt.etag,
  };
  let cleanup = async () => {};
  if (kind === "object") {
    expect(await recordRecordingObject(env.DB, claim, plan, "object-etag")).toBe(true);
    proof = { kind: "object", etag: "object-etag" };
  }
  if (kind === "verification" || kind === "final") {
    const bucket = env.SPEAKER_UPLOADS_BUCKET;
    if (!bucket) throw new Error("Native R2 fixture missing");
    const data = new Uint8Array(128);
    data.set([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 109, 112, 52, 50]);
    const object = await bucket.put(plan.objectKey, data);
    if (!object) throw new Error("Expected owned verification object");
    cleanup = () => bucket.delete(plan.objectKey);
    expect(await recordRecordingObject(env.DB, claim, plan, object.etag)).toBe(true);
    const verified = await verifyRecordingObjectRange(
      {
        objectKey: plan.objectKey,
        objectEtag: object.etag,
        expectedBytes: 128,
        leaseToken: claim.lease.token,
        priorOffset: 0,
        checkpoint: null,
        rangeBytes: kind === "final" ? 128 : 64,
      },
      {
        storage: bucket,
        checkpoint: {
          recordVerification: (progress) => recordRecordingVerification(env.DB, claim, plan, object.etag, 0, progress),
        },
      },
      2000,
    );
    proof = {
      kind: "verification",
      verifiedBytes: verified.status === "verified" ? verified.bytes : verified.verifiedBytes,
      checkpoint: verified.status === "verified" ? null : verified.checkpoint,
      ...(verified.status === "verified" ? { sha256: verified.sha256 } : {}),
    };
  }
  return { eventId, admin, sourceId, intent, claim, plan, proof, cleanup };
}
async function effects() {
  return {
    acquisitions: await queryAll(env.DB, "SELECT * FROM event_recording_acquisitions ORDER BY id"),
    parts: await queryAll(env.DB, "SELECT * FROM event_recording_parts ORDER BY part_number"),
    versions: await queryAll(env.DB, "SELECT id FROM event_recording_versions"),
    audit: await queryAll(env.DB, "SELECT id,action,entity_id,details_json FROM audit_log ORDER BY id"),
  };
}
describe("lease continuation from durable recording progress", () => {
  beforeEach(resetDb);
  it.each(["part", "object", "verification", "final"] as const)(
    "releases actual %s progress and resets only the consecutive retry budget",
    async (kind) => {
      const f = await fixture(kind);
      try {
        expect(f.claim.acquisition.attempts).toBe(10);
        const before = await effects();
        expect(await finishRecordingAcquisitionProgress(env.DB, f.claim, f.proof)).toBe(true);
        const released = await effects();
        expect(released.acquisitions).toEqual([
          {
            ...before.acquisitions[0],
            status: "queued",
            attempts: 0,
            next_attempt_at: expect.any(String),
            processing_token: null,
            claimed_at: null,
            lease_expires_at: null,
            last_failure_kind: null,
            last_provider_status: null,
            updated_at: expect.any(String),
          },
        ]);
        expect(released.parts).toEqual(before.parts);
        expect(released.audit).toEqual(before.audit);
        expect(released.versions).toEqual([]);
        const next = await claimRecordingAcquisition(env.DB, f.intent.id);
        if (!next) throw new Error("Expected immediate continuation claim");
        expect(next.lease.token).not.toBe(f.claim.lease.token);
        expect(next.acquisition.attempts).toBe(1);
        const claimed = await effects();
        expect(await finishRecordingAcquisitionProgress(env.DB, f.claim, f.proof)).toBe(false);
        expect(await finishRecordingAcquisitionFailure(env.DB, f.claim, "download_unavailable", 503)).toBe(false);
        expect(await effects()).toEqual(claimed);
        expect(await finishRecordingAcquisitionFailure(env.DB, next, "download_unavailable", 503)).toBe(true);
        expect((await effects()).acquisitions[0]).toMatchObject({
          status: "retrying",
          attempts: 1,
          last_failure_kind: "download_unavailable",
          last_provider_status: 503,
        });
      } finally {
        await f.cleanup();
      }
    },
  );
  it.each(["missing", "upload", "number", "etag", "offset", "checkpoint", "digest"])(
    "refuses %s progress without resetting attempts or changing any effects",
    async (difference) => {
      const f = await fixture(["offset", "checkpoint", "digest"].includes(difference) ? "verification" : "part");
      try {
        let proof = { ...f.proof };
        if (proof.kind === "part") {
          if (difference === "missing")
            await env.DB.prepare("DELETE FROM event_recording_parts WHERE acquisition_id=?").bind(f.intent.id).run();
          if (difference === "upload") proof.uploadId = "foreign-upload";
          if (difference === "number") proof.partNumber = 2;
          if (difference === "etag") proof.etag = "foreign-part";
        } else if (proof.kind === "verification") {
          if (difference === "offset") proof.verifiedBytes++;
          if (difference === "checkpoint") proof.checkpoint = "{}";
          if (difference === "digest")
            proof = { kind: "verification", verifiedBytes: 128, checkpoint: null, sha256: "a".repeat(64) };
        }
        const before = await effects();
        expect(await finishRecordingAcquisitionProgress(env.DB, f.claim, proof)).toBe(false);
        expect(await effects()).toEqual(before);
        expect(before.acquisitions[0]).toMatchObject({ status: "processing", attempts: 10 });
      } finally {
        await f.cleanup();
      }
    },
  );
  it.each(["source", "permission", "expired"])("refuses %s changes despite an exact saved receipt", async (change) => {
    const f = await fixture();
    if (change === "source")
      await env.DB.prepare("UPDATE event_recording_sources SET metadata_revision=2 WHERE id=?").bind(f.sourceId).run();
    if (change === "permission")
      await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(nowIso(), f.admin.id).run();
    if (change === "expired")
      await env.DB.prepare("UPDATE event_recording_acquisitions SET claimed_at=?,lease_expires_at=? WHERE id=?")
        .bind("2000-01-01T00:00:00.000Z", "2000-01-01T00:05:00.000Z", f.intent.id)
        .run();
    const before = await effects();
    expect(await finishRecordingAcquisitionProgress(env.DB, f.claim, f.proof)).toBe(false);
    expect(await effects()).toEqual(before);
  });
});
