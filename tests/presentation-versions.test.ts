/**
 * presentation-versions.test.ts
 *
 * Covers:
 *  1. Speaker uploads a presentation — presentation_versions row created with is_current = 1
 *  2. Admin uploads a presentation on behalf of a speaker
 *  3. Speaker uploads a second presentation — previous version becomes is_current = 0, new one is is_current = 1
 *  4. Admin lists versions, downloads a version, and submits a review
 *  5. Admin attempts to delete the only approved version — expects 409
 *  6. Speaker GET endpoint returns a presentationUrl with the correct token
 *  7. Speaker download endpoint retrieves the current uploaded file
 *  8. Migration backfill: proposal with existing presentation data gets version 1 row
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { seedWorkflowEmailTemplates } from "./helpers/event-workflow";
import { createProposal, addProposalSpeaker, finalizeProposalDecision } from "../functions/_lib/services/proposals";
import {
  createPresentationVersion,
  deletePresentationVersion,
  getPresentationVersion,
  listProposalPresentationVersions,
  presentationDownloadResponse,
  reviewPresentationVersion,
} from "../functions/_lib/services/presentation-versions";
import { getPresentationUploader } from "../functions/_lib/services/proposals-speaker-profile";
import app from "../functions/router";
import { processPendingStorageDeletions } from "../functions/_lib/services/storage-deletion-outbox";
import {
  MAX_PRESENTATION_BYTES,
  PRESENTATION_FILE_NAME_HEADER,
  PRESENTATION_FILE_SIZE_HEADER,
  presentationUploadRequest,
} from "../assets/shared/presentation-upload";
import {
  getPresentationProposalContext,
  uploadProposalPresentation,
} from "../functions/_lib/services/presentation-upload";
import { mutateBeforeNextBatch } from "./helpers/database-races";

interface StoredObject {
  body: ReadableStream | null;
  size: number;
  contentType: string;
}

class FakePresentationBucket {
  private readonly objects = new Map<string, { buf: ArrayBuffer; contentType: string }>();
  readonly getFailures = new Set<string>();
  putCalls = 0;
  putKeys: string[] = [];
  lastPutWasStream = false;
  deleteFailuresRemaining = 0;

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
    options?: Record<string, unknown>,
  ) {
    this.putCalls += 1;
    this.putKeys.push(key);
    this.lastPutWasStream = value instanceof ReadableStream;
    let buf: ArrayBuffer;
    if (value instanceof ArrayBuffer) {
      buf = value;
    } else if (ArrayBuffer.isView(value)) {
      buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    } else if (typeof value === "string") {
      buf = new TextEncoder().encode(value).buffer;
    } else if (value instanceof Blob) {
      buf = await value.arrayBuffer();
    } else if (value === null) {
      buf = new ArrayBuffer(0);
    } else {
      buf = await new Response(value).arrayBuffer();
    }
    const contentType =
      (options?.httpMetadata as { contentType?: string } | undefined)?.contentType ?? "application/octet-stream";
    this.objects.set(key, { buf, contentType });
    return { size: buf.byteLength };
  }

  async get(key: string): Promise<StoredObject | null> {
    if (this.getFailures.has(key)) throw new Error("Simulated R2 retrieval failure");
    const stored = this.objects.get(key);
    if (!stored) return null;
    const buf = stored.buf;
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        },
      }),
      size: buf.byteLength,
      contentType: stored.contentType,
    };
  }

  async delete(key: string) {
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1;
      throw new Error("Simulated R2 deletion failure");
    }
    this.objects.delete(key);
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

class CountingPresentationBucket {
  bytesWritten = 0;
  lastPutWasStream = false;

  async put(_key: string, value: ReadableStream) {
    this.lastPutWasStream = value instanceof ReadableStream;
    const reader = value.getReader();
    let written = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      written += chunk.byteLength;
    }
    this.bytesWritten += written;
    return { size: written };
  }

  async delete() {}
}

class BlockingPresentationBucket extends FakePresentationBucket {
  private readonly releasePromise: Promise<void>;
  private releaseUpload!: () => void;
  private signalStarted!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.signalStarted = resolve;
  });

  constructor() {
    super();
    this.releasePromise = new Promise<void>((resolve) => {
      this.releaseUpload = resolve;
    });
  }

  release(): void {
    this.releaseUpload();
  }

  override async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob | null,
    options?: Record<string, unknown>,
  ) {
    this.signalStarted();
    await this.releasePromise;
    return super.put(key, value, options);
  }
}

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF magic bytes

function makePdf(name = "slides.pdf") {
  return new File([FAKE_PDF], name, { type: "application/pdf" });
}

function presentationRequest(name = "slides.pdf") {
  return presentationUploadRequest(makePdf(name));
}

async function seed() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
  await seedWorkflowEmailTemplates(env.DB, adminRow.id);
  const adminToken = await createAdminSession(env.DB, adminRow.id, "presentation-test-admin-token");

  const speakerUserId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, data_json, created_at, updated_at)
     VALUES (?, 'pv-speaker@test.example', 'pv-speaker@test.example', 'Pat', 'Speaker', NULL, datetime('now'), datetime('now'))`,
  )
    .bind(speakerUserId)
    .run();

  const { proposal } = await createProposal(env.DB, {
    eventId,
    proposerUserId: speakerUserId,
    proposalType: "talk",
    title: "Post-Quantum Key Exchange",
    abstract: "A deep dive into lattice-based algorithms for TLS 1.3.",
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  const { manageToken: speakerToken } = await addProposalSpeaker(env.DB, {
    proposalId: proposal.id,
    userId: speakerUserId,
    role: "proposer",
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });

  // Accept the proposal so uploads are allowed.
  await finalizeProposalDecision(env.DB, {
    proposalId: proposal.id,
    actor: { identityType: "user", id: adminRow.id, email: "admin@pkic.org", role: "admin" },
    finalStatus: "accepted",
    minReviewsRequired: 0,
  });

  return {
    eventId,
    proposalId: proposal.id,
    speakerToken,
    speakerUserId,
    adminUserId: adminRow.id,
    adminToken,
  };
}

async function scopedPresentationActor(
  eventId: string,
  grantedByUserId: string,
  permission: "proposals:read" | "proposals:manage" = "proposals:manage",
) {
  const userId = crypto.randomUUID();
  const email = `presentation-manager-${userId}@example.test`;
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(userId, email, email)
    .run();
  const grantId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO permission_grants (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, 'event', ?, ?, datetime('now'))`,
  )
    .bind(grantId, userId, permission, eventId, grantedByUserId)
    .run();
  return {
    grantId,
    actor: {
      identityType: "user" as const,
      id: userId,
      email,
      role: "user",
      grants: [{ permission, contextType: "event", contextId: eventId }],
    },
  };
}

async function applyTestMigration(name: string): Promise<void> {
  const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name === name);
  if (!migration) throw new Error(`Missing test migration: ${name}`);
  for (const query of migration.queries) {
    await env.DB.prepare(query).run();
  }
}

describe("presentation versioning", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } })),
    );
  });

  it("uploading a presentation creates a version row with is_current = 1", async () => {
    const { proposalId, speakerToken } = await seed();
    const bucket = new FakePresentationBucket();

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest(),
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(bucket.lastPutWasStream).toBe(true);
    expect(bucket.putKeys[0]).toMatch(
      new RegExp(`^presentations/pqc-2026/post-quantum-key-exchange--${proposalId}/\\d+-[a-f0-9-]+-slides\\.pdf$`),
    );

    const versions = await queryAll<{ version_number: number; is_current: number; deleted_at: string | null }>(
      env.DB,
      "SELECT version_number, is_current, deleted_at FROM presentation_versions WHERE proposal_id = ?",
      proposalId,
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].version_number).toBe(1);
    expect(versions[0].is_current).toBe(1);
    expect(versions[0].deleted_at).toBeNull();
  });

  it("rejects an invited speaker upload before writing to storage or D1", async () => {
    const { proposalId, speakerToken } = await seed();
    await env.DB.prepare("UPDATE proposal_speakers SET status = 'invited', confirmed_at = NULL WHERE proposal_id = ?")
      .bind(proposalId)
      .run();
    const bucket = new FakePresentationBucket();

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest("invited.pdf"),
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SPEAKER_NOT_CONFIRMED" } });
    expect(bucket.keys()).toEqual([]);
    await expect(
      queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId),
    ).resolves.toHaveLength(0);
  });

  it("enforces confirmed speaker status at the upload service boundary", async () => {
    const { proposalId, speakerUserId } = await seed();
    await env.DB.prepare("UPDATE proposal_speakers SET status = 'invited', confirmed_at = NULL WHERE proposal_id = ?")
      .bind(proposalId)
      .run();
    const bucket = new FakePresentationBucket();
    const context = await getPresentationProposalContext(env.DB, proposalId);

    const speaker = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM proposal_speakers WHERE proposal_id = ?", proposalId)
    )[0];
    await expect(
      uploadProposalPresentation(
        env.DB,
        bucket as any,
        new Request("https://app.test/upload", { method: "PUT", ...presentationRequest("service-invited.pdf") }),
        context,
        {
          actor: { type: "user", userId: speakerUserId },
          enforceDeadline: true,
          authority: {
            speaker: {
              id: speaker.id,
              userId: speakerUserId,
              role: "proposer",
              status: "invited",
              inviteGeneration: 1,
            },
          },
        },
      ),
    ).rejects.toMatchObject({ status: 403, code: "SPEAKER_NOT_CONFIRMED" });
    expect(bucket.keys()).toEqual([]);
  });

  it("rejects a speaker upload when capability status changes during the R2 stream", async () => {
    const { proposalId, speakerToken } = await seed();
    const bucket = new BlockingPresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const uploadPromise = app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest("stale-speaker.pdf"),
      }),
      envWithBucket,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    await bucket.started;
    await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ?")
      .bind(proposalId)
      .run();
    bucket.release();

    const response = await uploadPromise;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PRESENTATION_UPLOAD_CONFLICT" } });
    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId),
    ).toHaveLength(0);
  });

  it("rejects a speaker upload when the proposal deadline changes during the R2 stream", async () => {
    const { proposalId, speakerToken } = await seed();
    const bucket = new BlockingPresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const uploadPromise = app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest("stale-deadline.pdf"),
      }),
      envWithBucket,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    await bucket.started;
    await env.DB.prepare("UPDATE session_proposals SET presentation_deadline = ? WHERE id = ?")
      .bind("2099-01-01T00:00:00.000Z", proposalId)
      .run();
    bucket.release();

    const response = await uploadPromise;
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PRESENTATION_UPLOAD_CONFLICT" } });
    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId),
    ).toHaveLength(0);
  });

  it("rejects a speaker upload when its unchanged deadline passes during the R2 stream", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const startedAt = new Date("2026-08-22T12:00:00.000Z");
      vi.setSystemTime(startedAt);
      const { proposalId, speakerToken } = await seed();
      const deadline = new Date(startedAt.getTime() + 60_000).toISOString();
      await env.DB.prepare("UPDATE session_proposals SET presentation_deadline = ? WHERE id = ?")
        .bind(deadline, proposalId)
        .run();
      const bucket = new BlockingPresentationBucket();
      const uploadPromise = app.fetch(
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
          method: "PUT",
          ...presentationRequest("deadline-passed.pdf"),
        }),
        { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );

      await bucket.started;
      vi.setSystemTime(new Date(startedAt.getTime() + 120_000));
      bucket.release();

      const response = await uploadPromise;
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "PRESENTATION_UPLOAD_CONFLICT" } });
      expect(bucket.keys()).toEqual([]);
      expect(
        await queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("admin can upload a presentation on behalf of a speaker", async () => {
    const { proposalId, adminUserId, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    const upload = presentationRequest("admin-upload.pdf");

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations`, {
        method: "POST",
        ...upload,
        headers: { authorization: `Bearer ${adminToken}`, ...upload.headers },
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });

    const versions = await queryAll<{
      file_name: string | null;
      uploaded_by_user_id: string | null;
      is_current: number;
    }>(
      env.DB,
      "SELECT file_name, uploaded_by_user_id, is_current FROM presentation_versions WHERE proposal_id = ?",
      proposalId,
    );
    expect(versions).toEqual([{ file_name: "admin-upload.pdf", uploaded_by_user_id: adminUserId, is_current: 1 }]);

    const auditRows = await queryAll<{ actor_type: string; actor_id: string | null }>(
      env.DB,
      "SELECT actor_type, actor_id FROM audit_log WHERE action = 'presentation_uploaded' AND entity_id = ?",
      proposalId,
    );
    expect(auditRows).toEqual([{ actor_type: "admin", actor_id: adminUserId }]);
  });

  it("keeps API-key audit identity separate from the nullable presentation uploader user", async () => {
    const { proposalId } = await seed();
    const bucket = new FakePresentationBucket();
    const upload = presentationRequest("api-key-upload.pdf");

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations`, {
        method: "POST",
        ...upload,
        headers: {
          authorization: `Bearer ${env.ADMIN_API_KEY ?? "test-admin-key"}`,
          ...upload.headers,
        },
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const versions = await queryAll<{ r2_key: string; uploaded_by_user_id: string | null }>(
      env.DB,
      "SELECT r2_key, uploaded_by_user_id FROM presentation_versions WHERE proposal_id = ?",
      proposalId,
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].uploaded_by_user_id).toBeNull();
    expect(bucket.keys()).toEqual([versions[0].r2_key]);
    expect(
      await queryAll<{ actor_id: string | null }>(
        env.DB,
        "SELECT actor_id FROM audit_log WHERE action = 'presentation_uploaded' AND entity_id = ?",
        proposalId,
      ),
    ).toEqual([{ actor_id: "api-key" }]);
  });

  it("durably retains upload cleanup when D1 commit and immediate R2 compensation both fail", async () => {
    const { proposalId, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    bucket.deleteFailuresRemaining = 1;
    await env.DB.prepare(
      `CREATE TRIGGER fail_presentation_upload_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'presentation_uploaded'
       BEGIN
         SELECT RAISE(ABORT, 'forced presentation upload audit failure');
       END`,
    ).run();
    const upload = presentationRequest("orphan-safe.pdf");

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations`, {
        method: "POST",
        ...upload,
        headers: { authorization: `Bearer ${adminToken}`, ...upload.headers },
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    await env.DB.prepare("DROP TRIGGER fail_presentation_upload_audit").run();

    expect(response.status).toBe(500);
    expect(
      await queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId),
    ).toHaveLength(0);
    expect(bucket.keys()).toHaveLength(1);
    const [intent] = await queryAll<{ object_key: string; status: string }>(
      env.DB,
      "SELECT object_key, status FROM storage_deletion_outbox WHERE bucket = 'speaker_uploads'",
    );
    expect(intent).toEqual({ object_key: bucket.keys()[0], status: "queued" });

    await env.DB.prepare("UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now')").run();
    await expect(
      processPendingStorageDeletions(env.DB, { SPEAKER_UPLOADS_BUCKET: bucket as unknown as R2Bucket }, 10),
    ).resolves.toEqual({ processed: 1, failed: 0 });
    expect(bucket.keys()).toEqual([]);
  });

  it("rejects an oversized presentation before sending its body to R2", async () => {
    const { speakerToken } = await seed();
    const bucket = new FakePresentationBucket();
    const upload = presentationRequest();

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...upload,
        headers: { ...upload.headers, [PRESENTATION_FILE_SIZE_HEADER]: String(MAX_PRESENTATION_BYTES + 1) },
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "FILE_TOO_LARGE" } });
    expect(bucket.putCalls).toBe(0);
  });

  it("rejects a short dishonest stream without committing an R2 object", async () => {
    const { speakerToken, proposalId } = await seed();
    const bucket = new FakePresentationBucket();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        headers: {
          "content-type": "application/pdf",
          [PRESENTATION_FILE_NAME_HEADER]: encodeURIComponent("short.pdf"),
          [PRESENTATION_FILE_SIZE_HEADER]: "4",
        },
        body,
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "FILE_SIZE_MISMATCH" } });
    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId),
    ).toHaveLength(0);
  });

  it("rejects an oversized chunked presentation before any R2 write", async () => {
    const { speakerToken, proposalId } = await seed();
    const bucket = new FakePresentationBucket();
    const oversizedChunk = new Uint8Array(MAX_PRESENTATION_BYTES + 1);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(oversizedChunk);
        controller.close();
      },
    });

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        headers: {
          "content-type": "application/pdf",
          [PRESENTATION_FILE_NAME_HEADER]: encodeURIComponent("oversized.pdf"),
          [PRESENTATION_FILE_SIZE_HEADER]: String(MAX_PRESENTATION_BYTES),
        },
        body,
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "FILE_TOO_LARGE" } });
    expect(bucket.putCalls).toBe(1);
    expect(bucket.keys()).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId),
    ).toHaveLength(0);
  });

  it("streams a large presentation with bounded size verification", async () => {
    const { speakerToken } = await seed();
    const bucket = new CountingPresentationBucket();
    const uploadSize = 95 * 1024 * 1024;
    const chunk = new Uint8Array(1024 * 1024);
    let remaining = uploadSize;
    const body = new ReadableStream({
      pull(controller) {
        if (remaining === 0) {
          controller.close();
          return;
        }
        const next = Math.min(chunk.byteLength, remaining);
        controller.enqueue(chunk.subarray(0, next));
        remaining -= next;
      },
    });

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        headers: {
          "content-type": "application/pdf",
          [PRESENTATION_FILE_NAME_HEADER]: encodeURIComponent("large-deck.pdf"),
          [PRESENTATION_FILE_SIZE_HEADER]: String(uploadSize),
        },
        body,
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(200);
    expect(bucket.lastPutWasStream).toBe(true);
    expect(bucket.bytesWritten).toBe(uploadSize);
  });

  it("second upload creates version 2 with is_current = 1 and demotes version 1 to is_current = 0", async () => {
    const { proposalId, speakerToken } = await seed();
    const bucket = new FakePresentationBucket();

    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    let res2: Response;
    try {
      await app.fetch(
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
          method: "PUT",
          ...presentationRequest("v1.pdf"),
        }),
        envWithBucket,
        execCtx,
      );

      res2 = await app.fetch(
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
          method: "PUT",
          ...presentationRequest("v2.pdf"),
        }),
        envWithBucket,
        execCtx,
      );
    } finally {
      nowSpy.mockRestore();
    }
    expect(res2.status).toBe(200);
    expect(new Set(bucket.putKeys)).toHaveLength(2);

    const versions = await queryAll<{ version_number: number; is_current: number }>(
      env.DB,
      "SELECT version_number, is_current FROM presentation_versions WHERE proposal_id = ? ORDER BY version_number",
      proposalId,
    );
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version_number: 1, is_current: 0 });
    expect(versions[1]).toMatchObject({ version_number: 2, is_current: 1 });
  });

  it("streams all current event presentations in a human-readable ZIP archive", async () => {
    const { eventId, proposalId, speakerToken, speakerUserId, adminUserId, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    for (const [name, content] of [
      ["superseded.pdf", "%PDF superseded-version-marker"],
      ["current.pdf", "%PDF current-version-marker"],
    ]) {
      const upload = presentationUploadRequest(new File([content], name, { type: "application/pdf" }));
      const response = await app.fetch(
        new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
          method: "PUT",
          ...upload,
        }),
        envWithBucket,
        execCtx,
      );
      expect(response.status).toBe(200);
    }

    const { proposal: secondProposal } = await createProposal(env.DB, {
      eventId,
      proposerUserId: speakerUserId,
      proposalType: "talk",
      title: "Another Session",
      abstract: "A second accepted session with a legacy R2 object key.",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });
    await finalizeProposalDecision(env.DB, {
      proposalId: secondProposal.id,
      actor: { identityType: "user", id: adminUserId, email: "admin@pkic.org", role: "admin" },
      finalStatus: "accepted",
      minReviewsRequired: 0,
    });
    const secondKey = "presentations/legacy-second.pptx";
    const secondContent = "PPTX second-presentation-marker";
    await bucket.put(secondKey, secondContent, {
      httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    });
    await createPresentationVersion(env.DB, secondProposal.id, {
      r2Key: secondKey,
      fileName: "second-deck.pptx",
      fileSize: secondContent.length,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      uploadedByUserId: adminUserId,
    });
    bucket.getFailures.add(secondKey);

    const response = await app.fetch(
      new Request("https://app.test/api/v1/events/pqc-2026/presentations/archive", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="pqc-2026-presentations.zip"');
    const archive = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const archiveText = new TextDecoder().decode(archive);
    expect(archiveText).toContain(`001 - Another Session - ${secondProposal.id.slice(0, 12)}.pptx`);
    expect(archiveText).toContain(`002 - Post-Quantum Key Exchange - ${proposalId.slice(0, 12)}.pdf`);
    expect(archiveText).toContain(`_missing/001 - Another Session - ${secondProposal.id.slice(0, 12)}.pptx.txt`);
    expect(archiveText).toContain('The stored file for "Another Session" could not be found.');
    expect(archiveText).toContain("current-version-marker");
    expect(archiveText).not.toContain("superseded-version-marker");
    expect(archiveText).not.toContain("second-presentation-marker");

    const retiredRoute = await app.fetch(
      new Request("https://app.test/api/v1/admin/events/pqc-2026/presentations/content", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    expect(retiredRoute.status).toBe(404);

    bucket.getFailures.clear();
    const allVersionsResponse = await app.fetch(
      new Request("https://app.test/api/v1/events/pqc-2026/presentations/archive?versions=all", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    expect(allVersionsResponse.status).toBe(200);
    expect(allVersionsResponse.headers.get("content-disposition")).toBe(
      'attachment; filename="pqc-2026-presentations-all-versions.zip"',
    );
    const allVersionsText = new TextDecoder().decode(await allVersionsResponse.arrayBuffer());
    expect(allVersionsText).toContain("second-presentation-marker");
    expect(allVersionsText).toContain("superseded-version-marker");
    expect(allVersionsText).toContain(`002 - Post-Quantum Key Exchange - ${proposalId.slice(0, 12)} - v001.pdf`);
    expect(allVersionsText).toContain(
      `003 - Post-Quantum Key Exchange - ${proposalId.slice(0, 12)} - v002-current.pdf`,
    );
  });

  it("serializes concurrent version creation and keeps exactly one current version", async () => {
    const { proposalId, speakerUserId } = await seed();

    await Promise.all([
      createPresentationVersion(env.DB, proposalId, {
        r2Key: "presentations/concurrent-a.pdf",
        fileName: "concurrent-a.pdf",
        fileSize: 4,
        mimeType: "application/pdf",
        uploadedByUserId: speakerUserId,
      }),
      createPresentationVersion(env.DB, proposalId, {
        r2Key: "presentations/concurrent-b.pdf",
        fileName: "concurrent-b.pdf",
        fileSize: 4,
        mimeType: "application/pdf",
        uploadedByUserId: speakerUserId,
      }),
    ]);

    const versions = await queryAll<{ version_number: number; is_current: number }>(
      env.DB,
      "SELECT version_number, is_current FROM presentation_versions WHERE proposal_id = ? ORDER BY version_number",
      proposalId,
    );
    expect(versions.map((version) => version.version_number)).toEqual([1, 2]);
    expect(versions.filter((version) => version.is_current === 1)).toHaveLength(1);
    expect(versions[1].is_current).toBe(1);
  });

  it("rejects a stale deletion after another deletion promotes that version", async () => {
    const { proposalId, speakerUserId, adminUserId } = await seed();
    const first = await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/delete-race-first.pdf",
      fileName: "delete-race-first.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });
    const second = await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/delete-race-second.pdf",
      fileName: "delete-race-second.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });

    const staleDelete = deletePresentationVersion(
      mutateBeforeNextBatch(env.DB, () => deletePresentationVersion(env.DB, proposalId, second.id, adminUserId)),
      proposalId,
      first.id,
      adminUserId,
    );
    await expect(staleDelete).rejects.toMatchObject({ status: 409, code: "PRESENTATION_VERSION_CONFLICT" });

    const versions = await queryAll<{ id: string; is_current: number; deleted_at: string | null }>(
      env.DB,
      "SELECT id, is_current, deleted_at FROM presentation_versions WHERE proposal_id = ? ORDER BY version_number",
      proposalId,
    );
    expect(versions).toEqual([
      { id: first.id, is_current: 1, deleted_at: null },
      { id: second.id, is_current: 0, deleted_at: expect.any(String) },
    ]);
  });

  it("admin can list versions, download, and submit a review", async () => {
    const { proposalId, speakerToken, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest(),
      }),
      envWithBucket,
      execCtx,
    );

    // List versions
    const listRes = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      versions: Array<{ id: string; versionNumber: number }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(listBody.versions).toHaveLength(1);
    expect(listBody.page).toEqual({ limit: 25, offset: 0, total: 1, hasMore: false });
    const versionId = listBody.versions[0].id;
    expect(listBody.versions[0].versionNumber).toBe(1);

    // Download
    const dlRes = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations/${versionId}/content`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-disposition")).toMatch(/attachment/);
    const dlBody = await dlRes.arrayBuffer();
    expect(new Uint8Array(dlBody).slice(0, 4)).toEqual(FAKE_PDF);

    // Submit a review
    const reviewRes = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations/${versionId}/reviews`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "needs_revision", note: "Please add speaker notes." }),
      }),
      envWithBucket,
      execCtx,
    );
    expect(reviewRes.status).toBe(200);
    const reviewBody = (await reviewRes.json()) as { version: { latestReview: { status: string; note: string } } };
    expect(reviewBody.version.latestReview.status).toBe("needs_revision");
    expect(reviewBody.version.latestReview.note).toBe("Please add speaker notes.");
  });

  it("rechecks scoped presentation access while listing and loading a version", async () => {
    const { eventId, proposalId, speakerUserId, adminUserId } = await seed();
    const version = await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/guarded-read.pdf",
      fileName: "guarded-read.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });
    const { actor, grantId } = await scopedPresentationActor(eventId, adminUserId, "proposals:read");
    const authorization = { actor, permission: "proposals:read" as const, eventId, proposalId };
    const { proposal: otherProposal } = await createProposal(env.DB, {
      eventId,
      proposerUserId: speakerUserId,
      proposalType: "talk",
      title: "Other proposal",
      abstract: "Cross-proposal guard test",
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
    });

    await expect(
      getPresentationVersion(env.DB, version.id, {
        actor,
        permission: "proposals:read",
        eventId,
        proposalId: otherProposal.id,
      }),
    ).rejects.toMatchObject({ status: 404, code: "VERSION_NOT_FOUND" });

    const listDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(grantId)
        .run();
    });
    await expect(
      listProposalPresentationVersions(listDb, proposalId, { limit: 25, offset: 0 }, authorization),
    ).rejects.toMatchObject({ code: "PRESENTATION_AUTHORIZATION_CHANGED" });

    const { actor: freshActor, grantId: freshGrantId } = await scopedPresentationActor(
      eventId,
      adminUserId,
      "proposals:read",
    );
    const getDb = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(freshGrantId)
        .run();
    });
    await expect(
      getPresentationVersion(getDb, version.id, {
        actor: freshActor,
        permission: "proposals:read",
        eventId,
        proposalId,
      }),
    ).rejects.toMatchObject({ code: "PRESENTATION_AUTHORIZATION_CHANGED" });
  });

  it("rolls back a review when scoped presentation permission is revoked before commit", async () => {
    const { eventId, proposalId, speakerUserId, adminUserId } = await seed();
    const version = await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/review-guard.pdf",
      fileName: "review-guard.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });
    const { actor, grantId } = await scopedPresentationActor(eventId, adminUserId);
    const db = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(grantId)
        .run();
    });

    await expect(
      reviewPresentationVersion(db, proposalId, version.id, actor, { status: "needs_revision", note: "No access" }),
    ).rejects.toMatchObject({ code: "PRESENTATION_AUTHORIZATION_CHANGED" });
    await expect(
      queryAll(env.DB, "SELECT id FROM presentation_version_reviews WHERE version_id = ?", version.id),
    ).resolves.toHaveLength(0);
  });

  it("compensates an admin upload when scoped presentation permission is revoked before commit", async () => {
    const { eventId, proposalId, adminUserId } = await seed();
    const { actor, grantId } = await scopedPresentationActor(eventId, adminUserId);
    const bucket = new FakePresentationBucket();
    const context = await getPresentationProposalContext(env.DB, proposalId);
    const db = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(grantId)
        .run();
    });

    await expect(
      uploadProposalPresentation(
        db,
        bucket as any,
        new Request("https://app.test/upload", { method: "PUT", ...presentationRequest("upload-guard.pdf") }),
        context,
        { actor: { type: "admin", admin: actor }, enforceDeadline: false },
      ),
    ).rejects.toMatchObject({ code: "PRESENTATION_UPLOAD_CONFLICT" });
    expect(bucket.keys()).toEqual([]);
    await expect(
      queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId),
    ).resolves.toHaveLength(0);
  });

  it("rolls back deletion when scoped presentation permission is revoked before commit", async () => {
    const { eventId, proposalId, speakerUserId, adminUserId } = await seed();
    const version = await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/delete-guard.pdf",
      fileName: "delete-guard.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });
    const { actor, grantId } = await scopedPresentationActor(eventId, adminUserId);
    const db = mutateBeforeNextBatch(env.DB, async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(grantId)
        .run();
    });

    await expect(deletePresentationVersion(db, proposalId, version.id, actor)).rejects.toMatchObject({
      code: "PRESENTATION_AUTHORIZATION_CHANGED",
    });
    await expect(
      queryAll(env.DB, "SELECT deleted_at FROM presentation_versions WHERE id = ?", version.id),
    ).resolves.toEqual([{ deleted_at: null }]);
  });

  it("rejects API-key presentation reviews before writing review or audit rows", async () => {
    const { proposalId, speakerUserId } = await seed();
    const version = await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/api-key-review.pdf",
      fileName: "api-key-review.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations/${version.id}/reviews`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.ADMIN_API_KEY ?? "test-admin-key"}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "needs_revision", note: "Must not be attributable to a shared key." }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
    await expect(
      queryAll(env.DB, "SELECT id FROM presentation_version_reviews WHERE version_id = ?", version.id),
    ).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'presentation_version_reviewed'"),
    ).resolves.toHaveLength(0);
  });

  it("filters, sorts, and paginates presentation versions in D1", async () => {
    const { proposalId, speakerUserId, adminToken } = await seed();
    await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/first.pdf",
      fileName: "first.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });
    await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/second.pptx",
      fileName: "second.pptx",
      fileSize: 4,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      uploadedByUserId: speakerUserId,
    });

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations?q=second&sort=versionNumber&limit=1`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      versions: Array<{ fileName: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(body.versions.map((version) => version.fileName)).toEqual(["second.pptx"]);
    expect(body.page).toEqual({ limit: 1, offset: 0, total: 1, hasMore: false });
  });

  it("rolls back presentation review and deletion when their audit write fails", async () => {
    const { proposalId, speakerUserId, adminToken } = await seed();
    const version = await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/audit-rollback.pdf",
      fileName: "audit-rollback.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });
    const requestContext = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    await env.DB.prepare(
      `CREATE TRIGGER fail_presentation_review_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'presentation_version_reviewed'
       BEGIN
         SELECT RAISE(ABORT, 'forced presentation review audit failure');
       END`,
    ).run();
    const reviewResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations/${version.id}/reviews`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "needs_revision", note: "Must roll back" }),
      }),
      env,
      requestContext,
    );
    await env.DB.prepare("DROP TRIGGER fail_presentation_review_audit").run();
    expect(reviewResponse.status).toBe(500);
    expect(
      await queryAll(env.DB, "SELECT id FROM presentation_version_reviews WHERE version_id = ?", version.id),
    ).toHaveLength(0);

    await env.DB.prepare(
      `CREATE TRIGGER fail_presentation_delete_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'presentation_version_deleted'
       BEGIN
         SELECT RAISE(ABORT, 'forced presentation delete audit failure');
       END`,
    ).run();
    const deleteResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations/${version.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      env,
      requestContext,
    );
    await env.DB.prepare("DROP TRIGGER fail_presentation_delete_audit").run();
    expect(deleteResponse.status).toBe(500);
    const [stored] = await queryAll<{ deleted_at: string | null; is_current: number }>(
      env.DB,
      "SELECT deleted_at, is_current FROM presentation_versions WHERE id = ?",
      version.id,
    );
    expect(stored).toEqual({ deleted_at: null, is_current: 1 });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM storage_deletion_outbox WHERE object_key = ?",
        "presentations/audit-rollback.pdf",
      ),
    ).toHaveLength(0);
  });

  it("soft-deletes a presentation and atomically queues its R2 object for deletion", async () => {
    const { proposalId, speakerUserId, adminUserId } = await seed();
    const version = await createPresentationVersion(env.DB, proposalId, {
      r2Key: "presentations/durable-delete.pdf",
      fileName: "durable-delete.pdf",
      fileSize: 4,
      mimeType: "application/pdf",
      uploadedByUserId: speakerUserId,
    });

    await deletePresentationVersion(env.DB, proposalId, version.id, adminUserId);

    expect(
      await queryAll(
        env.DB,
        "SELECT deleted_at IS NOT NULL AS deleted FROM presentation_versions WHERE id = ?",
        version.id,
      ),
    ).toEqual([{ deleted: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT bucket, object_key, status FROM storage_deletion_outbox WHERE object_key = ?",
        version.r2Key,
      ),
    ).toEqual([{ bucket: "speaker_uploads", object_key: version.r2Key, status: "queued" }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? AND action = 'presentation_version_deleted'",
        version.id,
      ),
    ).toEqual([{ action: "presentation_version_deleted" }]);
  });

  it("admin cannot delete the only approved version — returns 409", async () => {
    const { proposalId, speakerToken, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest(),
      }),
      envWithBucket,
      execCtx,
    );

    const listRes = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    const { versions } = (await listRes.json()) as { versions: Array<{ id: string }> };
    const versionId = versions[0].id;

    // Approve the version
    await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations/${versionId}/reviews`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }),
      envWithBucket,
      execCtx,
    );

    // Attempt to delete — must be blocked
    const deleteRes = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations/${versionId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    expect(deleteRes.status).toBe(409);
    const deleteBody = (await deleteRes.json()) as { error: { code: string } };
    expect(deleteBody.error.code).toBe("CANNOT_DELETE_APPROVED");
  });

  it("speaker GET endpoint returns a presentationUrl containing the speaker token", async () => {
    const { speakerToken } = await seed();
    const bucket = new FakePresentationBucket();

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}`),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    const body = (await res.json()) as { proposal: Record<string, unknown> };
    // presentationUrl lives inside the proposal object; it is computed server-side
    // from the event's frontend route config and always embeds the speaker token.
    expect(body.proposal).toHaveProperty("presentationUrl");
    const presentationUrl = body.proposal.presentationUrl as string;
    expect(typeof presentationUrl).toBe("string");
    expect(presentationUrl).toContain(speakerToken);
    expect(presentationUrl).toContain("presentation");
  });

  it("speaker can download their current presentation via the download endpoint", async () => {
    const { speakerToken } = await seed();
    const bucket = new FakePresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    // Upload first
    await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest("quantum-talk.pdf"),
      }),
      envWithBucket,
      execCtx,
    );

    // Download
    const dlRes = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`),
      envWithBucket,
      execCtx,
    );

    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(dlRes.headers.get("content-type")).toBe("application/pdf");
    expect(dlRes.headers.get("content-disposition")).toMatch(/quantum-talk\.pdf/);
    const buf = await dlRes.arrayBuffer();
    expect(new Uint8Array(buf).slice(0, 4)).toEqual(FAKE_PDF);
  });

  it("rejects presentation downloads for declined speakers and inactive proposals", async () => {
    const { proposalId, speakerToken } = await seed();
    const bucket = new FakePresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    const uploadResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest("state-guard.pdf"),
      }),
      envWithBucket,
      execCtx,
    );
    expect(uploadResponse.status).toBe(200);

    await env.DB.prepare("UPDATE proposal_speakers SET status = 'declined' WHERE proposal_id = ?")
      .bind(proposalId)
      .run();
    const declinedResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`),
      envWithBucket,
      execCtx,
    );
    expect(declinedResponse.status).toBe(403);
    await expect(declinedResponse.json()).resolves.toMatchObject({ error: { code: "SPEAKER_DECLINED" } });

    await env.DB.prepare("UPDATE proposal_speakers SET status = 'confirmed' WHERE proposal_id = ?")
      .bind(proposalId)
      .run();
    await env.DB.prepare("UPDATE session_proposals SET status = 'canceled' WHERE id = ?").bind(proposalId).run();
    const canceledResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`),
      envWithBucket,
      execCtx,
    );
    expect(canceledResponse.status).toBe(409);
    await expect(canceledResponse.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_NOT_ACCEPTED" } });
  });

  it("redacts internal presentation storage keys from upload and admin list responses", async () => {
    const { proposalId, speakerToken, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    const uploadResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest("redacted.pdf"),
      }),
      envWithBucket,
      execCtx,
    );
    expect(uploadResponse.status).toBe(200);
    await expect(uploadResponse.json()).resolves.toEqual({ success: true });

    const listResponse = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/${proposalId}/presentations`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { versions: Array<Record<string, unknown>> };
    expect(listBody.versions).toHaveLength(1);
    expect(listBody.versions[0]).not.toHaveProperty("r2Key");
  });

  it("encodes presentation download filenames with an ASCII fallback", () => {
    const response = presentationDownloadResponse(
      { body: new Blob([FAKE_PDF]).stream(), size: FAKE_PDF.byteLength },
      {
        fileName: `a\\b "é"('*)\r\n.pdf`,
        mimeType: "application/pdf",
        versionNumber: 1,
      },
    );
    const disposition = response.headers.get("content-disposition") ?? "";

    expect(disposition).not.toMatch(/[^\x20-\x7e]/);
    expect(disposition).not.toContain("\\");
    expect(disposition).not.toContain("é");
    expect(disposition).toContain(`filename="a_b ___('*)__.pdf"`);
    expect(disposition).toContain("filename*=UTF-8''a%5Cb%20%22%C3%A9%22%28%27%2A%29%0D%0A.pdf");
  });

  it("post-migration schema stores presentation uploads only in version rows", async () => {
    const { proposalId, speakerToken } = await seed();
    const bucket = new FakePresentationBucket();
    const upload = presentationRequest("current.pdf");
    await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speakers/access/${speakerToken}/presentation`, {
        method: "PUT",
        ...upload,
      }),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    const cols = await queryAll<{ name: string }>(env.DB, "PRAGMA table_info(session_proposals)");
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain("presentation_r2_key");
    expect(colNames).not.toContain("presentation_uploaded_at");
    expect(colNames).not.toContain("presentation_uploaded_by_user_id");

    const versions = await queryAll<{ version_number: number; is_current: number; file_name: string | null }>(
      env.DB,
      "SELECT version_number, is_current, file_name FROM presentation_versions WHERE proposal_id = ? AND deleted_at IS NULL",
      proposalId,
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version_number: 1, is_current: 1, file_name: "current.pdf" });
  });

  it("migration backfills a legacy upload with no uploader into version 1", async () => {
    const { proposalId } = await seed();

    await env.DB.prepare("DROP TABLE presentation_version_reviews").run();
    await env.DB.prepare("DROP TABLE presentation_versions").run();
    await env.DB.prepare("ALTER TABLE session_proposals ADD COLUMN presentation_r2_key TEXT").run();
    await env.DB.prepare("ALTER TABLE session_proposals ADD COLUMN presentation_uploaded_at TEXT").run();
    await env.DB.prepare("ALTER TABLE session_proposals ADD COLUMN presentation_uploaded_by_user_id TEXT").run();
    await env.DB.prepare(
      "UPDATE session_proposals SET presentation_r2_key = ?, presentation_uploaded_at = NULL, presentation_uploaded_by_user_id = NULL WHERE id = ?",
    )
      .bind("presentations/legacy.pdf", proposalId)
      .run();

    await applyTestMigration("0033_presentation_versions.sql");
    await applyTestMigration("0034_presentation_version_invariants.sql");

    const versions = await queryAll<{
      version_number: number;
      r2_key: string;
      uploaded_by_user_id: string | null;
      uploaded_at: string;
      is_current: number;
    }>(
      env.DB,
      "SELECT version_number, r2_key, uploaded_by_user_id, uploaded_at, is_current FROM presentation_versions WHERE proposal_id = ?",
      proposalId,
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version_number: 1,
      r2_key: "presentations/legacy.pdf",
      uploaded_by_user_id: null,
      is_current: 1,
    });
    expect(versions[0].uploaded_at).toBeTruthy();
    await expect(getPresentationUploader(env.DB, proposalId)).resolves.toMatchObject({
      firstName: null,
      lastName: null,
      uploadedAt: versions[0].uploaded_at,
    });

    const cols = await queryAll<{ name: string }>(env.DB, "PRAGMA table_info(session_proposals)");
    const colNames = cols.map((column) => column.name);
    expect(colNames).not.toContain("presentation_r2_key");
    expect(colNames).not.toContain("presentation_uploaded_at");
    expect(colNames).not.toContain("presentation_uploaded_by_user_id");
  });
});
