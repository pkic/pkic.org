import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { nowIso } from "../functions/_lib/utils/time";

const ADMIN_TOKEN = "forms-admin-token";

type FormFieldSeed = {
  key: string;
  label: string;
  fieldType: "text" | "textarea" | "select" | "multi_select" | "boolean" | "number" | "date" | "email" | "url";
  required?: boolean;
  sortOrder?: number;
  options?: string[];
  validation?: Record<string, unknown>;
};

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(`https://app.test${path}`, {
    ...init,
    headers,
  });
}

async function callAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    adminRequest(path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function setupAdmin(): Promise<{ eventId: string }> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];
  await createAdminSession(env.DB, adminRow.id, ADMIN_TOKEN);
  return { eventId };
}

async function insertForm(opts: {
  key: string;
  scopeType: "event" | "global";
  scopeRef: string | null;
  purpose: "event_registration" | "proposal_submission" | "survey" | "feedback" | "application";
  title: string;
  description?: string | null;
  status?: "active" | "inactive" | "archived";
  fields: FormFieldSeed[];
  submission?: {
    status?: "submitted" | "draft" | "withdrawn";
    contextType?: "registration" | "proposal" | "membership" | "survey" | "feedback";
    contextRef?: string | null;
    submittedByUserId?: string | null;
    answers?: Record<string, unknown>;
  };
}): Promise<{ formId: string }> {
  const formId = crypto.randomUUID();
  const timestamp = nowIso();

  await env.DB.prepare(
    `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      formId,
      opts.key,
      opts.scopeType,
      opts.scopeRef,
      opts.purpose,
      opts.status ?? "active",
      opts.title,
      opts.description ?? null,
      timestamp,
      timestamp,
    )
    .run();

  for (const field of opts.fields) {
    await env.DB.prepare(
      `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        formId,
        field.key,
        field.label,
        field.fieldType,
        field.required ? 1 : 0,
        field.options ? JSON.stringify(field.options) : null,
        field.validation ? JSON.stringify(field.validation) : null,
        field.sortOrder ?? 0,
        timestamp,
      )
      .run();
  }

  if (opts.submission) {
    const submissionId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO form_submissions (id, form_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        submissionId,
        formId,
        opts.submission.submittedByUserId ?? null,
        opts.submission.contextType ?? null,
        opts.submission.contextRef ?? null,
        opts.submission.status ?? "submitted",
        timestamp,
      )
      .run();

    for (const [fieldKey, value] of Object.entries(opts.submission.answers ?? {})) {
      await env.DB.prepare(
        `INSERT INTO form_submission_answers (id, submission_id, field_key, data_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), submissionId, fieldKey, JSON.stringify(value), timestamp)
        .run();
    }
  }

  return { formId };
}

describe("admin forms endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists event-scoped and global forms through the router", async () => {
    const { eventId } = await setupAdmin();

    await insertForm({
      key: "pqc-registration-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "event_registration",
      title: "Registration form",
      fields: [
        {
          key: "speaker_bio",
          label: "Speaker bio",
          fieldType: "textarea",
          required: true,
          sortOrder: 10,
        },
      ],
    });

    await insertForm({
      key: "global-feedback-form",
      scopeType: "global",
      scopeRef: null,
      purpose: "feedback",
      title: "Global feedback form",
      fields: [
        {
          key: "feedback",
          label: "Feedback",
          fieldType: "textarea",
          required: false,
          sortOrder: 10,
        },
      ],
    });

    const response = await callAdmin("/api/v1/admin/events/pqc-2026/forms");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      forms: Array<{ key: string; field_count: number; submission_count: number }>;
    };
    expect(payload.forms.map((form) => form.key)).toEqual(
      expect.arrayContaining(["pqc-registration-form", "global-feedback-form"]),
    );
    const eventForm = payload.forms.find((form) => form.key === "pqc-registration-form");
    expect(eventForm?.field_count).toBe(1);
    expect(eventForm?.submission_count).toBe(0);
  });

  it("creates and reads a form, including submissions and answers", async () => {
    await setupAdmin();

    const createResponse = await callAdmin("/api/v1/admin/events/pqc-2026/forms", {
      method: "POST",
      body: JSON.stringify({
        key: "event-workshop-form",
        purpose: "event_registration",
        title: "Workshop registration",
        description: "Collect attendee preferences",
        status: "active",
        fields: [
          {
            key: "company",
            label: "Company",
            fieldType: "text",
            required: true,
            sortOrder: 10,
          },
          {
            key: "tracks",
            label: "Tracks",
            fieldType: "multi_select",
            required: false,
            sortOrder: 20,
            options: ["PKI", "PQC"],
          },
        ],
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { formId: string; key: string };
    expect(created.key).toBe("event-workshop-form");

    const [detailRow] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM forms WHERE key = ?", [
      "event-workshop-form",
    ]);
    await env.DB.prepare(
      `INSERT INTO form_submissions (id, form_id, status, submitted_at)
       VALUES (?, ?, 'submitted', ?)`,
    )
      .bind(crypto.randomUUID(), detailRow.id, nowIso())
      .run();

    const [submission] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM form_submissions WHERE form_id = ? ORDER BY submitted_at DESC LIMIT 1",
      [detailRow.id],
    );
    await env.DB.prepare(
      `INSERT INTO form_submission_answers (id, submission_id, field_key, data_json, created_at)
       VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        submission.id,
        "company",
        JSON.stringify("Example Org"),
        nowIso(),
        crypto.randomUUID(),
        submission.id,
        "tracks",
        JSON.stringify(["PKI", "PQC"]),
        nowIso(),
      )
      .run();

    const detailResponse = await callAdmin("/api/v1/admin/forms/event-workshop-form");
    expect(detailResponse.status).toBe(200);
    const detailPayload = (await detailResponse.json()) as {
      form: { key: string; title: string };
      fields: Array<{ key: string }>;
    };
    expect(detailPayload.form.key).toBe("event-workshop-form");
    expect(detailPayload.fields.map((field) => field.key)).toEqual(["company", "tracks"]);

    const submissionsResponse = await callAdmin("/api/v1/admin/forms/event-workshop-form/submissions");
    expect(submissionsResponse.status).toBe(200);
    const submissionsPayload = (await submissionsResponse.json()) as {
      total: number;
      submissions: Array<{ answers: Record<string, unknown> }>;
    };
    expect(submissionsPayload.total).toBe(1);
    expect(submissionsPayload.submissions[0]?.answers.company).toBe("Example Org");
    expect(submissionsPayload.submissions[0]?.answers.tracks).toEqual(["PKI", "PQC"]);
  });

  it("replaces fields on patch and archives submitted forms on delete", async () => {
    const { eventId } = await setupAdmin();
    await insertForm({
      key: "mutable-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "survey",
      title: "Mutable form",
      description: "Before",
      fields: [
        {
          key: "old_field",
          label: "Old field",
          fieldType: "text",
          required: false,
          sortOrder: 10,
        },
      ],
      submission: {
        contextType: "survey",
        answers: { old_field: "answer" },
      },
    });

    const patchResponse = await callAdmin("/api/v1/admin/forms/mutable-form", {
      method: "PATCH",
      body: JSON.stringify({
        title: "Updated form",
        description: null,
        fields: [
          {
            key: "new_field",
            label: "New field",
            fieldType: "email",
            required: true,
            sortOrder: 5,
          },
          {
            key: "topics",
            label: "Topics",
            fieldType: "multi_select",
            required: false,
            sortOrder: 10,
            options: ["PKI", "PQC"],
          },
        ],
      }),
    });

    expect(patchResponse.status).toBe(200);
    const patchPayload = (await patchResponse.json()) as { success: boolean; fields: Array<{ key: string }> };
    expect(patchPayload.success).toBe(true);
    expect(patchPayload.fields.map((field) => field.key)).toEqual(["new_field", "topics"]);

    const deleteResponse = await callAdmin("/api/v1/admin/forms/mutable-form", { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    const deletePayload = (await deleteResponse.json()) as { action: string; message?: string };
    expect(deletePayload.action).toBe("archived");

    const archived = await queryAll<{ status: string }>(env.DB, "SELECT status FROM forms WHERE key = ?", [
      "mutable-form",
    ]);
    expect(archived[0]?.status).toBe("archived");
  });

  it("deletes an empty form and returns 404 for missing forms", async () => {
    await setupAdmin();
    await insertForm({
      key: "empty-form",
      scopeType: "global",
      scopeRef: null,
      purpose: "feedback",
      title: "Empty form",
      fields: [],
    });

    const deleteResponse = await callAdmin("/api/v1/admin/forms/empty-form", { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    const deletePayload = (await deleteResponse.json()) as { action: string };
    expect(deletePayload.action).toBe("deleted");

    const missingResponse = await callAdmin("/api/v1/admin/forms/does-not-exist");
    expect(missingResponse.status).toBe(404);
    const missingPayload = (await missingResponse.json()) as { error?: { code?: string } };
    expect(missingPayload.error?.code).toBe("FORM_NOT_FOUND");
  });
});
