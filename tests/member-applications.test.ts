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
};

describe("POST /api/v1/members/applications", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a member_applications record with status=pending", async () => {
    const testEnv = makeEnv();
    const response = await callEndpoint(
      createApplication,
      createContext(testEnv, postRequest("https://pkic.org/api/v1/members/applications", validPayload), {}),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { applicationId: string; status: string; manageToken: string };
    expect(body.status).toBe("pending");
    expect(body.manageToken).toBeTruthy();

    const rows = await queryAll<{ status: string; stage: string; applicant_email: string }>(
      testEnv.DB,
      "SELECT status, stage, applicant_email FROM member_applications WHERE id = ?",
      [body.applicationId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].stage).toBe("pending");
    expect(rows[0].applicant_email).toBe("alice@example-corp.test");
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

  it("does not duplicate-check individual (org-less) categories", async () => {
    const testEnv = makeEnv();
    const payload = {
      applicantEmail: "solo@example-corp.test",
      applicantName: "Solo Person",
      membershipCategory: "H6",
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
        postRequest("https://pkic.org/api/v1/members/applications", { ...payload, applicantEmail: "solo2@example-corp.test" }),
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
    const body = (await response.json()) as { status: string; stage: string };
    expect(body.status).toBe("pending");
    expect(body.stage).toBe("pending");
  });

  it("returns 401 for an invalid token", async () => {
    const testEnv = makeEnv();
    const created = await createTestApplication(testEnv);

    const response = await callEndpoint(
      getApplicationStatus,
      createContext(
        testEnv,
        new Request(`https://pkic.org/api/v1/members/applications/${created.applicationId}/status?token=wrong-token-value`),
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
      createContext(testEnv, new Request(`https://pkic.org/api/v1/members/applications/${created.applicationId}/status`), {
        id: created.applicationId,
      }),
    );

    expect(response.status).toBe(401);
  });
});

describe("POST/GET /api/v1/members/applications/:id/documents", () => {
  beforeEach(async () => {
    await resetDb();
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
});

function makeFakeBucket() {
  const store = new Map<string, ArrayBuffer>();
  return {
    async put(key: string, value: ArrayBuffer) {
      store.set(key, value);
      return {};
    },
    async get(key: string) {
      const value = store.get(key);
      if (!value) return null;
      return { arrayBuffer: async () => value };
    },
  };
}
