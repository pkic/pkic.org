import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext, createTestRateLimiter, queryAll } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestPost as createApplication } from "../functions/api/v1/members/applications";
import { onRequestGet as getApplicationStatus } from "../functions/api/v1/members/applications/[id]/status";
import { processPendingStorageDeletions } from "../functions/_lib/services/storage-deletion-outbox";
import { seedMembershipApplicationForm } from "./helpers/member-applications";
import { callApi } from "./helpers/app";
import {
  applicationDocumentUploadResponseSchema,
  applicationDocumentsListResponseSchema,
} from "../assets/shared/schemas/application-documents";

function makeEnv(overrides: Partial<typeof env> = {}) {
  return { ...env, IP_RATE_LIMITER: createTestRateLimiter(100), ...overrides } as typeof env;
}

function postRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callEndpoint(handler: (c: any) => Promise<Response>, ctx: any): Promise<Response> {
  try {
    return await handler(ctx);
  } catch (error) {
    return handleError(error);
  }
}

const validPayload = {
  applicantEmail: "alice@example-corp.test",
  applicantName: "Alice Example",
  membershipCategory: "A",
  organizationName: "Example Corp",
  answers: { reason: "We want to contribute to the PKI community." },
};

describe("POST /api/v1/members/applications", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  it("creates a member_applications record with stage=pending", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      createApplication,
      createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", validPayload), {}),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { applicationId: string; stage: string; manageToken: string };
    expect(body.stage).toBe("pending");
    expect(body.manageToken).toBeTruthy();

    const rows = await queryAll<{ stage: string; applicant_email: string }>(
      testEnv.DB,
      "SELECT stage, applicant_email FROM member_applications WHERE id = ?",
      [body.applicationId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe("pending");
    expect(rows[0].applicant_email).toBe("alice@example-corp.test");
  });

  it("enforces H5 university-email eligibility through the mounted route", async () => {
    const testEnv = makeEnv();
    const response = await callApi(testEnv, "/api/v1/members/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        applicantEmail: "student@gmail.com",
        applicantName: "Student Example",
        membershipCategory: "H5",
      }),
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { details?: { fieldErrors?: Record<string, string[]> } } };
    expect(body.error.details?.fieldErrors?.applicantEmail).toEqual([
      "Category H5 requires a university email address; personal email providers are not accepted",
    ]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });

  it("does not apply the H5 university-email rule to other individual categories", async () => {
    const testEnv = makeEnv();
    const response = await callApi(testEnv, "/api/v1/members/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        applicantEmail: "individual@gmail.com",
        applicantName: "Individual Example",
        membershipCategory: "H6",
        answers: { reason: "I want to contribute to the PKI community." },
      }),
    });

    expect(response.status).toBe(201);
  });

  it("returns 409 when an active application already exists for the same organization domain", async () => {
    const testEnv = makeEnv();
    const first = await callEndpoint(
      createApplication,
      createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", validPayload), {}),
    );
    expect(first.status).toBe(201);

    const second = await callEndpoint(
      createApplication,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/members/applications", {
          ...validPayload,
          applicantEmail: "bob@example-corp.test",
          applicantName: "Bob Example",
        }),
        {},
      ),
    );

    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DUPLICATE_APPLICATION");
  });

  it("does not 409 when the applicant changes the email domain before submitting", async () => {
    // Regression test for a reported bug: a user filling out the join form
    // changes the email's domain before submitting and (allegedly) still
    // gets DUPLICATE_APPLICATION even though no organization or application
    // exists yet for the new domain. Investigation (manual reproduction via
    // `npm run dev` against both a fresh D1 instance and a production-backup
    // snapshot) found no code defect: emailDomain() is derived fresh from
    // the request body on every call, hasActiveApplicationForDomain only
    // matches an *exact* domain already present in member_applications, and
    // hasConflictingOrganizationDomain only matches organizations that
    // actually have that domain in organization_domains. Two
    // submissions for two different, never-before-seen domains — even from
    // the same applicant/organization name — must both succeed.
    const testEnv = makeEnv();
    const first = await callEndpoint(
      createApplication,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/members/applications", {
          ...validPayload,
          applicantEmail: "dana@first-domain.test",
        }),
        {},
      ),
    );
    expect(first.status).toBe(201);

    const second = await callEndpoint(
      createApplication,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/members/applications", {
          ...validPayload,
          applicantEmail: "dana@second-domain.test",
        }),
        {},
      ),
    );
    expect(second.status).toBe(201);
  });

  it("does not duplicate-check individual (org-less) categories", async () => {
    const testEnv = makeEnv();
    const payload = {
      applicantEmail: "solo@example-corp.test",
      applicantName: "Solo Person",
      membershipCategory: "H6",
      answers: { reason: "I want to contribute to the PKI community." },
    };
    const first = await callEndpoint(
      createApplication,
      createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", payload), {}),
    );
    expect(first.status).toBe(201);

    const second = await callEndpoint(
      createApplication,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/members/applications", {
          ...payload,
          applicantEmail: "solo2@example-corp.test",
        }),
        {},
      ),
    );
    expect(second.status).toBe(201);
  });

  it("returns 422 with field-level validation errors for missing required fields", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      createApplication,
      createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", {}), {}),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeTruthy();
  });

  it("returns 422 when organizationName is missing for an org-tied category", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      createApplication,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/members/applications", {
          applicantEmail: "carol@example-corp.test",
          applicantName: "Carol Example",
          membershipCategory: "B",
        }),
        {},
      ),
    );
    expect(response.status).toBe(422);
  });

  it("validates answers against the active form, including required and unknown fields", async () => {
    const testEnv = makeEnv();
    const missingRequired = await callEndpoint(
      createApplication,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/members/applications", {
          ...validPayload,
          answers: {},
        }),
        {},
      ),
    );
    expect(missingRequired.status).toBe(422);

    const unknownField = await callEndpoint(
      createApplication,
      createContext(
        testEnv,
        postRequest("https://pkic.org/api/v1/members/applications", {
          ...validPayload,
          answers: { reason: "Valid reason", invented_field: "must not persist" },
        }),
        {},
      ),
    );
    expect(unknownField.status).toBe(422);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });

  it("allows exactly one of two concurrent submissions to claim an organization domain", async () => {
    const testEnv = makeEnv();
    const responses = await Promise.all(
      ["alice", "bob"].map((name) =>
        callEndpoint(
          createApplication,
          createContext(
            testEnv,
            postRequest("https://pkic.org/api/v1/members/applications", {
              ...validPayload,
              applicantEmail: `${name}@concurrent-domain.test`,
              applicantName: name,
            }),
            {},
          ),
        ),
      ),
    );

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(
      await queryAll(testEnv.DB, "SELECT id FROM organization_domain_claims WHERE domain = 'concurrent-domain.test'"),
    ).toHaveLength(1);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(1);
    expect(
      await queryAll(testEnv.DB, "SELECT id FROM email_outbox WHERE template_key = 'application-received'"),
    ).toHaveLength(1);
  });

  it("rolls back application, answers, domain claim, event, and outbox when the atomic audit insert fails", async () => {
    const testEnv = makeEnv();
    await testEnv.DB.prepare(
      `CREATE TRIGGER fail_application_submission_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'member_application_submitted'
       BEGIN
         SELECT RAISE(ABORT, 'forced application audit failure');
       END`,
    ).run();

    try {
      const response = await callEndpoint(
        createApplication,
        createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", validPayload), {}),
      );
      expect(response.status).toBe(500);
      expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
      expect(
        await queryAll(testEnv.DB, "SELECT id FROM form_submissions WHERE context_type = 'membership'"),
      ).toHaveLength(0);
      expect(await queryAll(testEnv.DB, "SELECT id FROM organization_domain_claims")).toHaveLength(0);
      expect(await queryAll(testEnv.DB, "SELECT id FROM member_application_events")).toHaveLength(0);
      expect(
        await queryAll(testEnv.DB, "SELECT id FROM email_outbox WHERE template_key = 'application-received'"),
      ).toHaveLength(0);
    } finally {
      await testEnv.DB.prepare("DROP TRIGGER fail_application_submission_audit").run();
    }
  });

  it("queues the application-received confirmation email in email_outbox", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      createApplication,
      createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", validPayload), {}),
    );
    expect(response.status).toBe(201);

    const outbox = await queryAll<{ recipient_email: string; template_key: string }>(
      testEnv.DB,
      "SELECT recipient_email, template_key FROM email_outbox WHERE template_key = 'application-received' ORDER BY created_at DESC LIMIT 1",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].recipient_email).toBe("alice@example-corp.test");
  });
});

describe("GET /api/v1/members/applications/:id/status", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  async function createTestApplication(testEnv: typeof env) {
    const response = await callEndpoint(
      createApplication,
      createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", validPayload), {}),
    );
    return (await response.json()) as { applicationId: string; manageToken: string };
  }

  it("returns current stage for a valid token", async () => {
    const testEnv = makeEnv();
    const created = await createTestApplication(testEnv);

    const response = await callEndpoint(
      getApplicationStatus,
      createContext(
        testEnv,
        new Request(
          `https://pkic.org/api/v1/members/applications/${created.applicationId}/status?token=${created.manageToken}`,
        ),
        { id: created.applicationId },
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { stage: string };
    expect(body.stage).toBe("pending");
  });

  it("returns 401 for an invalid token", async () => {
    const testEnv = makeEnv();
    const created = await createTestApplication(testEnv);

    const response = await callEndpoint(
      getApplicationStatus,
      createContext(
        testEnv,
        new Request(
          `https://pkic.org/api/v1/members/applications/${created.applicationId}/status?token=wrong-token-value`,
        ),
        { id: created.applicationId },
      ),
    );

    expect(response.status).toBe(401);
  });

  it("returns 401 for a missing token", async () => {
    const testEnv = makeEnv();
    const created = await createTestApplication(testEnv);

    const response = await callEndpoint(
      getApplicationStatus,
      createContext(
        testEnv,
        new Request(`https://pkic.org/api/v1/members/applications/${created.applicationId}/status`),
        {
          id: created.applicationId,
        },
      ),
    );

    expect(response.status).toBe(401);
  });
});

describe("POST/GET /api/v1/members/applications/:id/documents", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  it("accepts a mounted, idempotent upload and returns a canonical paginated list", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);

    const uploadResponse = await uploadDocument(testEnv, created, { idempotencyKey: "document-upload-0001" });
    expect(uploadResponse.status).toBe(201);
    const uploadBody = applicationDocumentUploadResponseSchema.parse(await uploadResponse.json());
    expect(uploadBody.document.filename).toBe("registration.pdf");

    const retryResponse = await uploadDocument(testEnv, created, { idempotencyKey: "document-upload-0001" });
    expect(retryResponse.status).toBe(201);

    const listResponse = await callApi(
      testEnv,
      `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`,
    );
    expect(listResponse.status).toBe(200);
    const listBody = applicationDocumentsListResponseSchema.parse(await listResponse.json());
    expect(listBody.documents).toHaveLength(1);
    expect(listBody.documents[0].filename).toBe("registration.pdf");
    expect(listBody.page).toEqual({ limit: 25, offset: 0, total: 1, hasMore: false });
    expect(bucket.keys()).toHaveLength(1);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toHaveLength(1);
    const auditRows = await queryAll<{ entity_id: string; details_json: string }>(
      testEnv.DB,
      "SELECT entity_id, details_json FROM audit_log WHERE action = 'application_document_uploaded'",
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entity_id).toBe(created.applicationId);
    expect(JSON.parse(auditRows[0].details_json).documentId.to).toBe(uploadBody.document.id);

    await testEnv.DB.prepare("UPDATE member_applications SET stage = 'approved' WHERE id = ?")
      .bind(created.applicationId)
      .run();
    expect((await uploadDocument(testEnv, created, { idempotencyKey: "document-upload-0001" })).status).toBe(201);
    expect(bucket.keys()).toHaveLength(1);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key for different same-size document content", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);
    expect(
      (
        await uploadDocument(testEnv, created, {
          idempotencyKey: "document-upload-0002",
          bytes: "%PDF-1.4 AAAA",
        })
      ).status,
    ).toBe(201);

    const response = await uploadDocument(testEnv, created, {
      idempotencyKey: "document-upload-0002",
      bytes: "%PDF-1.4 BBBB",
    });
    expect(response.status).toBe(409);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toHaveLength(1);
    expect(bucket.keys()).toHaveLength(1);
    expect(
      await queryAll(testEnv.DB, "SELECT id FROM audit_log WHERE action = 'application_document_uploaded'"),
    ).toHaveLength(1);
  });

  it("commits exactly one concurrent upload when the same key carries different content", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);
    const responses = await Promise.all([
      uploadDocument(testEnv, created, {
        idempotencyKey: "document-upload-concurrent-content",
        bytes: "%PDF-1.4 AAAA",
      }),
      uploadDocument(testEnv, created, {
        idempotencyKey: "document-upload-concurrent-content",
        bytes: "%PDF-1.4 BBBB",
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toHaveLength(1);
    expect(bucket.keys()).toHaveLength(1);
    expect(
      await queryAll(testEnv.DB, "SELECT id FROM audit_log WHERE action = 'application_document_uploaded'"),
    ).toHaveLength(1);
  });

  it("requires a bounded idempotency key before accepting an upload", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);
    const response = await callApi(
      testEnv,
      `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`,
      { method: "POST", body: documentFormData() },
    );

    expect(response.status).toBe(400);
    expect(bucket.keys()).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toEqual([]);
  });

  it("binds a capability token to one application for both upload and list", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const first = await createApplicationForDocumentTest(testEnv);
    const second = await createApplicationForDocumentTest(testEnv, {
      applicantEmail: "bob@second-corp.test",
      applicantName: "Bob Example",
      organizationName: "Second Corp",
    });

    const uploadResponse = await callApi(
      testEnv,
      `/api/v1/members/applications/${second.applicationId}/documents?token=${first.manageToken}`,
      {
        method: "POST",
        headers: { "idempotency-key": "document-upload-0003" },
        body: documentFormData(),
      },
    );
    expect(uploadResponse.status).toBe(401);
    expect(
      (
        await callApi(
          testEnv,
          `/api/v1/members/applications/${second.applicationId}/documents?token=${first.manageToken}`,
        )
      ).status,
    ).toBe(401);
    expect(bucket.keys()).toEqual([]);
  });

  it("rate-limits upload and list before token verification or body processing", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);
    const limitedEnv = { ...testEnv, IP_RATE_LIMITER: createTestRateLimiter(0) } as typeof env;

    expect(
      (
        await uploadDocument(limitedEnv, created, {
          idempotencyKey: "document-upload-rate-limited",
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await callApi(
          limitedEnv,
          `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`,
        )
      ).status,
    ).toBe(429);
    expect(bucket.keys()).toEqual([]);
  });

  it("rate-limits one application even when callers rotate edge addresses", async () => {
    const testEnv = makeEnv({
      ASSETS_BUCKET: makeFakeBucket() as any,
      IP_RATE_LIMITER: createTestRateLimiter(1),
    });
    const created = await createApplicationForDocumentTest(testEnv);
    const path = `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`;

    expect((await callApi(testEnv, path, { headers: { "cf-connecting-ip": "192.0.2.1" } })).status).toBe(200);
    expect((await callApi(testEnv, path, { headers: { "cf-connecting-ip": "192.0.2.2" } })).status).toBe(429);
  });

  it("paginates, searches, and sorts documents in D1 and rejects an invalid sort", async () => {
    const testEnv = makeEnv({ ASSETS_BUCKET: makeFakeBucket() as any });
    const created = await createApplicationForDocumentTest(testEnv);
    await seedDocument(
      testEnv,
      created.applicationId,
      "00000000-0000-4000-8000-000000000003",
      "zeta.pdf",
      "application/pdf",
      300,
      "2026-01-03T00:00:00.000Z",
    );
    await seedDocument(
      testEnv,
      created.applicationId,
      "00000000-0000-4000-8000-000000000001",
      "alpha.pdf",
      "application/pdf",
      100,
      "2026-01-01T00:00:00.000Z",
    );
    await seedDocument(
      testEnv,
      created.applicationId,
      "00000000-0000-4000-8000-000000000002",
      "beta.png",
      "image/png",
      200,
      "2026-01-02T00:00:00.000Z",
    );

    const pageResponse = await callApi(
      testEnv,
      `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}&limit=1&offset=1&sort=filename`,
    );
    const page = applicationDocumentsListResponseSchema.parse(await pageResponse.json());
    expect(page.documents.map((document) => document.filename)).toEqual(["beta.png"]);
    expect(page.page).toEqual({ limit: 1, offset: 1, total: 3, hasMore: true });

    const searchResponse = await callApi(
      testEnv,
      `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}&q=png&sort=-fileSizeBytes`,
    );
    const search = applicationDocumentsListResponseSchema.parse(await searchResponse.json());
    expect(search.documents.map((document) => document.filename)).toEqual(["beta.png"]);
    expect(search.page.total).toBe(1);

    const invalid = await callApi(
      testEnv,
      `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}&sort=r2Key`,
    );
    expect(invalid.status).toBe(400);
  });

  it("rejects declared and streamed multipart bodies before unbounded parsing", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any, APPLICATION_DOCUMENT_MAX_BYTES: "16" });
    const created = await createApplicationForDocumentTest(testEnv);
    const url = `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`;

    const declared = await callApi(testEnv, url, {
      method: "POST",
      headers: { "idempotency-key": "document-upload-0004", "content-length": "300000" },
      body: documentFormData(),
    });
    expect(declared.status).toBe(413);

    const streamed = await callApi(testEnv, url, {
      method: "POST",
      headers: {
        "idempotency-key": "document-upload-0005",
        "content-type": "multipart/form-data; boundary=bounded-test",
      },
      body: new Uint8Array(300_000),
    });
    expect(streamed.status).toBe(413);
    expect(bucket.keys()).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toEqual([]);
  });

  it("rejects spoofed file contents and terminal applications before R2 storage", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);

    const spoofed = await uploadDocument(testEnv, created, {
      idempotencyKey: "document-upload-0006",
      bytes: "<script>alert(1)</script>",
    });
    expect(spoofed.status).toBe(415);

    await testEnv.DB.prepare("UPDATE member_applications SET stage = 'withdrawn' WHERE id = ?")
      .bind(created.applicationId)
      .run();
    const closed = await uploadDocument(testEnv, created, { idempotencyKey: "document-upload-0007" });
    expect(closed.status).toBe(409);
    expect(bucket.keys()).toEqual([]);
  });

  it("rejects a document if the application closes while R2 is accepting the upload", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);
    bucket.beforeNextPut(async () => {
      await testEnv.DB.prepare("UPDATE member_applications SET stage = 'withdrawn' WHERE id = ?")
        .bind(created.applicationId)
        .run();
    });

    const response = await uploadDocument(testEnv, created, { idempotencyKey: "document-upload-stage-race" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "APPLICATION_CLOSED" } });
    expect(bucket.keys()).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toEqual([]);
    expect(
      await queryAll(
        testEnv.DB,
        "SELECT id FROM audit_log WHERE action = 'application_document_uploaded' AND entity_id = ?",
        [created.applicationId],
      ),
    ).toEqual([]);
  });

  it("enforces count and aggregate-byte quotas without residual R2 or D1 state", async () => {
    const countBucket = makeFakeBucket();
    const countEnv = makeEnv({
      ASSETS_BUCKET: countBucket as any,
      APPLICATION_DOCUMENT_MAX_COUNT: "1",
      APPLICATION_DOCUMENT_MAX_BYTES: "1024",
    });
    const countApplication = await createApplicationForDocumentTest(countEnv);
    expect((await uploadDocument(countEnv, countApplication, { idempotencyKey: "document-upload-0008" })).status).toBe(
      201,
    );
    expect(
      (
        await uploadDocument(countEnv, countApplication, {
          idempotencyKey: "document-upload-0009",
          filename: "second.pdf",
        })
      ).status,
    ).toBe(409);
    expect(countBucket.keys()).toHaveLength(1);

    await resetDb();
    await seedMembershipApplicationForm();
    const byteBucket = makeFakeBucket();
    const byteEnv = makeEnv({
      ASSETS_BUCKET: byteBucket as any,
      APPLICATION_DOCUMENT_MAX_BYTES: "1024",
      APPLICATION_DOCUMENT_TOTAL_MAX_BYTES: "30",
    });
    const byteApplication = await createApplicationForDocumentTest(byteEnv);
    expect((await uploadDocument(byteEnv, byteApplication, { idempotencyKey: "document-upload-0010" })).status).toBe(
      201,
    );
    expect(
      (
        await uploadDocument(byteEnv, byteApplication, {
          idempotencyKey: "document-upload-0011",
          filename: "second.pdf",
        })
      ).status,
    ).toBe(413);
    expect(byteBucket.keys()).toHaveLength(1);
    expect(await queryAll(byteEnv.DB, "SELECT id FROM application_documents")).toHaveLength(1);
  });

  it("retains and retries cleanup when a concurrent quota loss cannot delete R2 immediately", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({
      ASSETS_BUCKET: bucket as any,
      APPLICATION_DOCUMENT_MAX_COUNT: "1",
      APPLICATION_DOCUMENT_MAX_BYTES: "1024",
    });
    const created = await createApplicationForDocumentTest(testEnv);
    bucket.failNextDelete();
    bucket.beforeNextPut(async () => {
      await seedDocument(
        testEnv,
        created.applicationId,
        "00000000-0000-4000-8000-000000000099",
        "already-present.pdf",
        "application/pdf",
        1,
        "2026-08-22T00:00:00.000Z",
      );
    });

    const response = await uploadDocument(testEnv, created, {
      idempotencyKey: "document-upload-concurrent-quota-cleanup",
    });
    expect(response.status).toBe(409);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toHaveLength(1);
    expect(bucket.keys()).toHaveLength(1);
    expect(
      await queryAll<{ object_key: string; status: string }>(
        testEnv.DB,
        "SELECT object_key, status FROM storage_deletion_outbox WHERE bucket = 'assets'",
      ),
    ).toEqual([{ object_key: bucket.keys()[0], status: "queued" }]);

    await testEnv.DB.prepare("UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now')").run();
    await expect(
      processPendingStorageDeletions(testEnv.DB, { ASSETS_BUCKET: bucket as unknown as R2Bucket }, 10),
    ).resolves.toEqual({ processed: 1, failed: 0 });
    expect(bucket.keys()).toEqual([]);
  });

  it("lets exactly one concurrent upload commit at the count boundary", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({
      ASSETS_BUCKET: bucket as any,
      APPLICATION_DOCUMENT_MAX_COUNT: "1",
      APPLICATION_DOCUMENT_MAX_BYTES: "1024",
    });
    const created = await createApplicationForDocumentTest(testEnv);
    const responses = await Promise.all([
      uploadDocument(testEnv, created, { idempotencyKey: "document-upload-0012", filename: "first.pdf" }),
      uploadDocument(testEnv, created, { idempotencyKey: "document-upload-0013", filename: "second.pdf" }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM application_documents")).toHaveLength(1);
    expect(bucket.keys()).toHaveLength(1);
    expect(await queryAll(testEnv.DB, "SELECT id FROM storage_deletion_outbox")).toEqual([]);
  });

  it("cleans up the R2 object when the mounted document-record commit fails", async () => {
    const bucket = makeFakeBucket();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);
    await installDocumentAuditFailure(testEnv);

    try {
      const response = await callApi(
        testEnv,
        `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`,
        { method: "POST", headers: { "idempotency-key": "document-upload-0014" }, body: documentFormData() },
      );

      expect(response.status).toBe(500);
      expect(
        await queryAll(
          testEnv.DB,
          "SELECT id FROM application_documents WHERE application_id = ?",
          created.applicationId,
        ),
      ).toHaveLength(0);
      expect(bucket.keys()).toEqual([]);
      expect(await queryAll(testEnv.DB, "SELECT id FROM storage_deletion_outbox WHERE bucket = 'assets'")).toHaveLength(
        0,
      );
    } finally {
      await testEnv.DB.prepare("DROP TRIGGER fail_application_document_audit").run();
    }
  });

  it("retains exactly one durable cleanup intent when immediate R2 cleanup fails", async () => {
    const bucket = makeFakeBucket();
    bucket.failNextDelete();
    const testEnv = makeEnv({ ASSETS_BUCKET: bucket as any });
    const created = await createApplicationForDocumentTest(testEnv);
    await installDocumentAuditFailure(testEnv);

    try {
      const response = await callApi(
        testEnv,
        `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`,
        { method: "POST", headers: { "idempotency-key": "document-upload-0015" }, body: documentFormData() },
      );

      expect(response.status).toBe(500);
      expect(
        await queryAll(
          testEnv.DB,
          "SELECT id FROM application_documents WHERE application_id = ?",
          created.applicationId,
        ),
      ).toHaveLength(0);
      expect(bucket.keys()).toHaveLength(1);

      const intents = await queryAll<{ object_key: string; status: string }>(
        testEnv.DB,
        "SELECT object_key, status FROM storage_deletion_outbox WHERE bucket = 'assets'",
      );
      expect(intents).toHaveLength(1);
      expect(intents[0].status).toBe("queued");

      await testEnv.DB.prepare(
        "UPDATE storage_deletion_outbox SET next_attempt_at = datetime('now', '-1 second') WHERE bucket = 'assets'",
      ).run();
      await expect(
        processPendingStorageDeletions(testEnv.DB, { ASSETS_BUCKET: bucket as unknown as R2Bucket }, 10),
      ).resolves.toEqual({ processed: 1, failed: 0 });
      expect(bucket.keys()).toEqual([]);
      expect(
        await queryAll<{ status: string }>(
          testEnv.DB,
          "SELECT status FROM storage_deletion_outbox WHERE bucket = 'assets'",
        ),
      ).toEqual([{ status: "deleted" }]);
    } finally {
      await testEnv.DB.prepare("DROP TRIGGER fail_application_document_audit").run();
    }
  });
});

async function createApplicationForDocumentTest(testEnv: typeof env, overrides: Partial<typeof validPayload> = {}) {
  const response = await callEndpoint(
    createApplication,
    createContext(
      testEnv,
      postRequest("https://pkic.org/api/v1/members/applications", { ...validPayload, ...overrides }),
      {},
    ),
  );
  return (await response.json()) as { applicationId: string; manageToken: string };
}

function documentFormData(
  filename = "registration.pdf",
  bytes: string | Uint8Array = "%PDF-1.4 supporting document",
  mimeType = "application/pdf",
) {
  const formData = new FormData();
  const contents = typeof bytes === "string" ? bytes : new Uint8Array(bytes).buffer;
  formData.append("file", new File([contents], filename, { type: mimeType }));
  return formData;
}

async function uploadDocument(
  testEnv: typeof env,
  created: { applicationId: string; manageToken: string },
  options: { idempotencyKey: string; filename?: string; bytes?: string | Uint8Array; mimeType?: string },
) {
  return callApi(
    testEnv,
    `/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`,
    {
      method: "POST",
      headers: { "idempotency-key": options.idempotencyKey },
      body: documentFormData(options.filename, options.bytes, options.mimeType),
    },
  );
}

async function seedDocument(
  testEnv: typeof env,
  applicationId: string,
  id: string,
  filename: string,
  mimeType: string,
  fileSizeBytes: number,
  uploadedAt: string,
) {
  await testEnv.DB.prepare(
    `INSERT INTO application_documents
       (id, application_id, uploaded_by_email, r2_key, filename, mime_type,
        file_size_bytes, content_sha256, uploaded_at)
     VALUES (?, ?, 'alice@example-corp.test', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      applicationId,
      `application-docs/${applicationId}/${id}`,
      filename,
      mimeType,
      fileSizeBytes,
      "0".repeat(64),
      uploadedAt,
    )
    .run();
}

async function installDocumentAuditFailure(testEnv: typeof env) {
  await testEnv.DB.prepare(
    `CREATE TRIGGER fail_application_document_audit
     BEFORE INSERT ON audit_log
     WHEN NEW.action = 'application_document_uploaded'
     BEGIN
       SELECT RAISE(ABORT, 'forced application document audit failure');
     END`,
  ).run();
}

function makeFakeBucket() {
  const store = new Map<string, ArrayBuffer>();
  let deleteFailuresRemaining = 0;
  let beforePut: (() => Promise<void>) | undefined;
  return {
    async put(key: string, value: BodyInit) {
      const callback = beforePut;
      beforePut = undefined;
      await callback?.();
      store.set(key, await new Response(value).arrayBuffer());
      return {};
    },
    async delete(key: string) {
      if (deleteFailuresRemaining > 0) {
        deleteFailuresRemaining -= 1;
        throw new Error("simulated R2 delete failure");
      }
      store.delete(key);
    },
    async get(key: string) {
      const value = store.get(key);
      if (!value) return null;
      return { arrayBuffer: async () => value };
    },
    failNextDelete() {
      deleteFailuresRemaining += 1;
    },
    beforeNextPut(callback: () => Promise<void>) {
      beforePut = callback;
    },
    keys() {
      return [...store.keys()].sort();
    },
  };
}
