import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createContext, createTestRateLimiter, queryAll } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import { onRequestPost as createApplication } from "../functions/api/v1/members/applications";
import { onRequestGet as getApplicationStatus } from "../functions/api/v1/members/applications/[id]/status";
import {
  onRequestPost as uploadApplicationDocument,
  onRequestGet as listApplicationDocuments,
} from "../functions/api/v1/members/applications/[id]/documents";
import { processPendingStorageDeletions } from "../functions/_lib/services/storage-deletion-outbox";
import { seedMembershipApplicationForm } from "./helpers/member-applications";
import { callApi } from "./helpers/app";

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

  it("accepts a file upload and links it to the application, then lists it back", async () => {
    const testEnv = makeEnv({ ASSETS_BUCKET: makeFakeBucket() as any });
    const created = await (async () => {
      const response = await callEndpoint(
        createApplication,
        createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", validPayload), {}),
      );
      return (await response.json()) as { applicationId: string; manageToken: string };
    })();

    const formData = new FormData();
    formData.append("file", new File(["%PDF-1.4 fake"], "registration.pdf", { type: "application/pdf" }));
    const uploadRequest = new Request(
      `https://pkic.org/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`,
      { method: "POST", body: formData },
    );

    const uploadResponse = await callEndpoint(
      uploadApplicationDocument,
      createContext(testEnv, uploadRequest, { id: created.applicationId }),
    );
    expect(uploadResponse.status).toBe(201);
    const uploadBody = (await uploadResponse.json()) as { document: { filename: string } };
    expect(uploadBody.document.filename).toBe("registration.pdf");

    const listResponse = await callEndpoint(
      listApplicationDocuments,
      createContext(
        testEnv,
        new Request(
          `https://pkic.org/api/v1/members/applications/${created.applicationId}/documents?token=${created.manageToken}`,
        ),
        { id: created.applicationId },
      ),
    );
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { documents: Array<{ filename: string }> };
    expect(listBody.documents).toHaveLength(1);
    expect(listBody.documents[0].filename).toBe("registration.pdf");
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
        { method: "POST", body: documentFormData() },
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
        { method: "POST", body: documentFormData() },
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

async function createApplicationForDocumentTest(testEnv: typeof env) {
  const response = await callEndpoint(
    createApplication,
    createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", validPayload), {}),
  );
  return (await response.json()) as { applicationId: string; manageToken: string };
}

function documentFormData() {
  const formData = new FormData();
  formData.append("file", new File(["%PDF-1.4 forced-failure"], "registration.pdf", { type: "application/pdf" }));
  return formData;
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
  return {
    async put(key: string, value: ArrayBuffer) {
      store.set(key, value);
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
    keys() {
      return [...store.keys()].sort();
    },
  };
}
