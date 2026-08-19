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
  presentationDownloadResponse,
} from "../functions/_lib/services/presentation-versions";
import { getPresentationUploader, recordPresentationUpload } from "../functions/_lib/services/proposals-speaker-profile";
import app from "../functions/router";
import {
  MAX_PRESENTATION_BYTES,
  PRESENTATION_FILE_NAME_HEADER,
  PRESENTATION_FILE_SIZE_HEADER,
  presentationUploadRequest,
} from "../assets/shared/presentation-upload";

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
    this.objects.delete(key);
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
    decidedByUserId: adminRow.id,
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
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
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

  it("admin can upload a presentation on behalf of a speaker", async () => {
    const { proposalId, adminUserId, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    const upload = presentationRequest("admin-upload.pdf");

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/presentation/versions`, {
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

  it("rejects an oversized presentation before sending its body to R2", async () => {
    const { speakerToken } = await seed();
    const bucket = new FakePresentationBucket();
    const upload = presentationRequest();

    const res = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
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

  it("streams a large presentation without buffering it", async () => {
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
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
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
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
          method: "PUT",
          ...presentationRequest("v1.pdf"),
        }),
        envWithBucket,
        execCtx,
      );

      res2 = await app.fetch(
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
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
        new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
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
      decidedByUserId: adminUserId,
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
      new Request("https://app.test/api/v1/admin/events/pqc-2026/presentations/download", {
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

    bucket.getFailures.clear();
    const allVersionsResponse = await app.fetch(
      new Request("https://app.test/api/v1/admin/events/pqc-2026/presentations/download?versions=all", {
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

  it("upload atomicity (PR #1 review §9.2 principle): a D1 batch failure after a successful R2 put does not leave an orphaned object", async () => {
    const { proposalId } = await seed();
    const bucket = new FakePresentationBucket();
    const r2Key = "presentations/orphan-test/orphan.pdf";
    // storePresentationFile has already succeeded by the time createPresentationVersion
    // runs in the real upload flow, so simulate that here directly.
    await bucket.put(r2Key, "%PDF orphan-marker", { httpMetadata: { contentType: "application/pdf" } });

    await expect(
      createPresentationVersion(
        env.DB,
        proposalId,
        {
          r2Key,
          fileName: "orphan.pdf",
          fileSize: 4,
          mimeType: "application/pdf",
          // A syntactically valid but non-existent user id — violates
          // presentation_versions.uploaded_by_user_id's FK, forcing the D1
          // batch to fail after the R2 put has already succeeded.
          uploadedByUserId: "00000000-0000-4000-8000-000000000000",
        },
        bucket as unknown as R2Bucket,
      ),
    ).rejects.toThrow();

    const versions = await queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId);
    expect(versions).toHaveLength(0);
    await expect(bucket.get(r2Key)).resolves.toBeNull();
  });

  it("upload atomicity is wired through recordPresentationUpload (the function the routes actually call)", async () => {
    const { proposalId } = await seed();
    const bucket = new FakePresentationBucket();
    const r2Key = "presentations/orphan-wired/orphan.pdf";
    await bucket.put(r2Key, "%PDF orphan-marker", { httpMetadata: { contentType: "application/pdf" } });

    await expect(
      recordPresentationUpload(
        env.DB,
        bucket as unknown as R2Bucket,
        proposalId,
        r2Key,
        "00000000-0000-4000-8000-000000000000",
        { fileName: "orphan.pdf", fileSize: 4, mimeType: "application/pdf" },
      ),
    ).rejects.toThrow();

    await expect(bucket.get(r2Key)).resolves.toBeNull();
    const versions = await queryAll(env.DB, "SELECT id FROM presentation_versions WHERE proposal_id = ?", proposalId);
    expect(versions).toHaveLength(0);
  });

  it("admin can list versions, download, and submit a review", async () => {
    const { proposalId, speakerToken, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest(),
      }),
      envWithBucket,
      execCtx,
    );

    // List versions
    const listRes = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/presentation/versions`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { versions: Array<{ id: string; versionNumber: number }> };
    expect(listBody.versions).toHaveLength(1);
    const versionId = listBody.versions[0].id;
    expect(listBody.versions[0].versionNumber).toBe(1);

    // Download
    const dlRes = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/presentation/versions/${versionId}/download`, {
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
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/presentation/versions/${versionId}/review`, {
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

  it("admin cannot delete the only approved version — returns 409", async () => {
    const { proposalId, speakerToken, adminToken } = await seed();
    const bucket = new FakePresentationBucket();
    const envWithBucket = { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket };
    const execCtx = { passThroughOnException: () => {}, waitUntil: () => {} } as any;

    await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest(),
      }),
      envWithBucket,
      execCtx,
    );

    const listRes = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/presentation/versions`, {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      envWithBucket,
      execCtx,
    );
    const { versions } = (await listRes.json()) as { versions: Array<{ id: string }> };
    const versionId = versions[0].id;

    // Approve the version
    await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/presentation/versions/${versionId}/review`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      }),
      envWithBucket,
      execCtx,
    );

    // Attempt to delete — must be blocked
    const deleteRes = await app.fetch(
      new Request(`https://app.test/api/v1/admin/proposals/${proposalId}/presentation/versions/${versionId}`, {
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
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}`),
      { ...(env as any), SPEAKER_UPLOADS_BUCKET: bucket },
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(res.status).toBe(200);
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
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
        method: "PUT",
        ...presentationRequest("quantum-talk.pdf"),
      }),
      envWithBucket,
      execCtx,
    );

    // Download
    const dlRes = await app.fetch(
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation/download`),
      envWithBucket,
      execCtx,
    );

    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("content-type")).toBe("application/pdf");
    expect(dlRes.headers.get("content-disposition")).toMatch(/quantum-talk\.pdf/);
    const buf = await dlRes.arrayBuffer();
    expect(new Uint8Array(buf).slice(0, 4)).toEqual(FAKE_PDF);
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
      new Request(`https://app.test/api/v1/proposals/speaker/${speakerToken}/presentation`, {
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
