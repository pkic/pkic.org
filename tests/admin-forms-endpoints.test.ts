import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { nowIso } from "../functions/_lib/utils/time";
import { createManagedForm, updateManagedForm } from "../functions/_lib/services/forms";
import {
  adminFormCreateResponseSchema,
  adminFormCreateSchema,
  adminFormsListQuerySchema,
} from "../assets/shared/schemas/admin-forms";
import {
  FORM_FIELD_TYPES,
  FORM_PURPOSES,
  FORM_STATUSES,
  type FormFieldType,
  type FormPurpose,
  type FormStatus,
} from "../assets/shared/schemas/forms";

let ADMIN_TOKEN = "forms-admin-token";

type FormFieldSeed = {
  key: string;
  label: string;
  fieldType: FormFieldType;
  required?: boolean;
  sortOrder?: number;
  options?: string[];
  optionSource?: "active_working_groups";
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
  ADMIN_TOKEN = await createAdminSession(env.DB, adminRow.id, ADMIN_TOKEN);
  return { eventId };
}

async function insertForm(opts: {
  key: string;
  scopeType: "event" | "global";
  scopeRef: string | null;
  purpose: FormPurpose;
  title: string;
  description?: string | null;
  status?: FormStatus;
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
      `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, option_source, validation_json, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        formId,
        field.key,
        field.label,
        field.fieldType,
        field.required ? 1 : 0,
        field.options ? JSON.stringify(field.options) : null,
        field.optionSource ?? null,
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
      const [field] = await queryAll<{ id: string }>(
        env.DB,
        "SELECT id FROM form_fields WHERE form_id = ? AND key = ? LIMIT 1",
        [formId, fieldKey],
      );
      await env.DB.prepare(
        `INSERT INTO form_submission_answers (id, submission_id, field_id, field_key, data_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), submissionId, field.id, fieldKey, JSON.stringify(value), timestamp)
        .run();
    }
  }

  return { formId };
}

describe("admin forms endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("uses one canonical form vocabulary for create and list contracts", () => {
    for (const purpose of FORM_PURPOSES) {
      expect(
        adminFormCreateSchema.safeParse({
          key: `form-${purpose.replace(/_/g, "-")}`,
          purpose,
          title: "Canonical form",
        }).success,
      ).toBe(true);
      expect(adminFormsListQuerySchema.safeParse({ purpose }).success).toBe(true);
    }
    for (const status of FORM_STATUSES) {
      expect(adminFormsListQuerySchema.safeParse({ status }).success).toBe(true);
    }
    for (const fieldType of FORM_FIELD_TYPES) {
      expect(
        adminFormCreateSchema.safeParse({
          key: `form-${fieldType.replace(/_/g, "-")}`,
          purpose: "survey",
          title: "Canonical field",
          fields: [{ key: "field", label: "Field", fieldType }],
        }).success,
      ).toBe(true);
    }
    expect(adminFormCreateSchema.safeParse({ key: "invalid", purpose: "future", title: "Invalid" }).success).toBe(
      false,
    );
    expect(adminFormsListQuerySchema.safeParse({ status: "deleted" }).success).toBe(false);
  });

  it("lists event-scoped and global forms through the router", async () => {
    const { eventId } = await setupAdmin();
    const adminUserId = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0]?.id;

    await insertForm({
      key: "pqc-registration-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "survey",
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

    const doubleCountRegistrationContextRef = crypto.randomUUID();
    await insertForm({
      key: "pqc-registration-double-count-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "event_registration",
      title: "Registration form with linked row",
      fields: [{ key: "company", label: "Company", fieldType: "text" }],
      submission: {
        contextType: "registration",
        contextRef: doubleCountRegistrationContextRef,
        answers: { company: "PKI Org" },
      },
    });
    await env.DB.prepare(
      `INSERT INTO registrations (
         id, event_id, user_id, status, attendance_type, source_type, custom_answers_json,
         manage_link_secret, created_at, updated_at
       ) VALUES (?, ?, ?, 'registered', 'virtual', 'admin', ?, ?, ?, ?)`,
    )
      .bind(
        doubleCountRegistrationContextRef,
        eventId,
        adminUserId,
        JSON.stringify({ company: "PKI Org" }),
        crypto.randomUUID(),
        nowIso(),
        nowIso(),
      )
      .run();

    const doubleCountProposalContextRef = crypto.randomUUID();
    await insertForm({
      key: "pqc-proposal-double-count-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "proposal_submission",
      title: "Proposal form with linked row",
      fields: [{ key: "abstract", label: "Abstract", fieldType: "textarea" }],
      submission: {
        contextType: "proposal",
        contextRef: doubleCountProposalContextRef,
        answers: { abstract: "Talk abstract" },
      },
    });
    await env.DB.prepare(
      `INSERT INTO session_proposals (
         id, event_id, proposer_user_id, status, proposal_type, title, abstract, details_json,
         manage_link_secret, submitted_at, updated_at
       ) VALUES (?, ?, ?, 'submitted', 'talk', 'Talk title', 'Talk abstract', ?, ?, ?, ?)`,
    )
      .bind(
        doubleCountProposalContextRef,
        eventId,
        adminUserId,
        JSON.stringify({ abstract: "Talk abstract" }),
        crypto.randomUUID(),
        nowIso(),
        nowIso(),
      )
      .run();

    const response = await callAdmin("/api/v1/admin/events/pqc-2026/forms");

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      forms: Array<{ key: string; field_count: number; submission_count: number }>;
    };
    expect(payload.forms.map((form) => form.key)).toEqual(
      expect.arrayContaining([
        "pqc-registration-form",
        "global-feedback-form",
        "pqc-registration-double-count-form",
        "pqc-proposal-double-count-form",
      ]),
    );
    const eventForm = payload.forms.find((form) => form.key === "pqc-registration-form");
    expect(eventForm?.field_count).toBe(1);
    expect(eventForm?.submission_count).toBe(0);
    expect(payload.forms.find((form) => form.key === "pqc-registration-double-count-form")?.submission_count).toBe(1);
    expect(payload.forms.find((form) => form.key === "pqc-proposal-double-count-form")?.submission_count).toBe(1);

    const filteredResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/forms?purpose=feedback&q=global&sort=-title&limit=10",
    );
    expect(filteredResponse.status).toBe(200);
    const filtered = (await filteredResponse.json()) as { forms: Array<{ key: string }>; page: { total: number } };
    expect(filtered.forms.map((form) => form.key)).toEqual(["global-feedback-form"]);
    expect(filtered.page.total).toBe(1);

    await insertForm({
      key: "inactive-feedback-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "feedback",
      status: "inactive",
      title: "Inactive feedback",
      fields: [],
    });
    const inactiveResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/forms?purpose=feedback&status=inactive&limit=10",
    );
    const inactive = (await inactiveResponse.json()) as { forms: Array<{ key: string; status: string }> };
    expect(inactive.forms).toEqual([expect.objectContaining({ key: "inactive-feedback-form", status: "inactive" })]);
  });

  it("lists and creates global forms through the admin forms root", async () => {
    const { eventId } = await setupAdmin();

    await insertForm({
      key: "event-linked-survey",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "survey",
      title: "Event linked survey",
      fields: [],
    });

    const createResponse = await callAdmin("/api/v1/admin/forms", {
      method: "POST",
      body: JSON.stringify({
        key: "community-survey",
        purpose: "survey",
        title: "Community survey",
        description: "Questions not linked to a single event",
        status: "active",
        fields: [
          {
            key: "topic",
            label: "Topic",
            fieldType: "text",
            required: true,
            sortOrder: 10,
          },
        ],
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = adminFormCreateResponseSchema.parse(await createResponse.json());
    expect(created.key).toBe("community-survey");
    expect(created.success).toBe(true);
    expect(created.formId).toBeTruthy();

    const rootResponse = await callAdmin("/api/v1/admin/forms");
    expect(rootResponse.status).toBe(200);
    const rootPayload = (await rootResponse.json()) as {
      forms: Array<{
        key: string;
        scope_type: string;
        scope_ref: string | null;
        event_slug: string | null;
        event_name: string | null;
        field_count: number;
      }>;
    };
    const form = rootPayload.forms.find((entry) => entry.key === "community-survey");
    expect(form).toMatchObject({ scope_type: "global", scope_ref: null, field_count: 1 });
    const eventForm = rootPayload.forms.find((entry) => entry.key === "event-linked-survey");
    expect(eventForm).toMatchObject({ event_slug: "pqc-2026", event_name: "PQC Conference 2026" });
  });

  it("rolls back form aggregate writes when a field statement fails", async () => {
    await setupAdmin();
    const admin = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0];
    const duplicateFields = [
      { key: "duplicate", label: "One", fieldType: "text" as const, required: false, sortOrder: 1 },
      { key: "duplicate", label: "Two", fieldType: "text" as const, required: false, sortOrder: 2 },
    ];

    await expect(
      createManagedForm(
        env.DB,
        admin.id,
        { type: "global", ref: null },
        {
          key: "must-rollback",
          purpose: "survey",
          title: "Must roll back",
          status: "active",
          fields: duplicateFields,
        },
      ),
    ).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM forms WHERE key = 'must-rollback'")).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_type = 'form' AND action = 'global_form_created'"),
    ).toHaveLength(0);

    const { formId } = await insertForm({
      key: "must-preserve",
      scopeType: "global",
      scopeRef: null,
      purpose: "survey",
      title: "Original title",
      fields: [{ key: "original", label: "Original", fieldType: "text" }],
    });
    const [formIdentity] = await queryAll<{ updated_at: string }>(
      env.DB,
      "SELECT updated_at FROM forms WHERE id = ? LIMIT 1",
      [formId],
    );
    await expect(
      updateManagedForm(
        env.DB,
        admin.id,
        { id: formId, key: "must-preserve", updated_at: formIdentity.updated_at },
        {
          title: "Should not persist",
          fields: duplicateFields,
        },
      ),
    ).rejects.toThrow();
    expect(await queryAll<{ title: string }>(env.DB, "SELECT title FROM forms WHERE id = ?", [formId])).toEqual([
      { title: "Original title" },
    ]);
    expect(
      await queryAll<{ key: string }>(env.DB, "SELECT key FROM form_fields WHERE form_id = ? ORDER BY key", [formId]),
    ).toEqual([{ key: "original" }]);
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
    const created = adminFormCreateResponseSchema.parse(await createResponse.json());
    expect(created.key).toBe("event-workshop-form");

    const [detailRow] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM forms WHERE key = ?", [
      "event-workshop-form",
    ]);
    await env.DB.prepare(
      `INSERT INTO form_submissions (id, form_id, status, submitted_at)
       VALUES (?, ?, 'submitted', ?), (?, ?, 'submitted', ?)`,
    )
      .bind(
        crypto.randomUUID(),
        detailRow.id,
        nowIso(),
        crypto.randomUUID(),
        detailRow.id,
        new Date(Date.now() - 1000).toISOString(),
      )
      .run();

    const submissions = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM form_submissions WHERE form_id = ? ORDER BY submitted_at DESC",
      [detailRow.id],
    );
    const fields = await queryAll<{ id: string; key: string }>(
      env.DB,
      "SELECT id, key FROM form_fields WHERE form_id = ?",
      [detailRow.id],
    );
    const fieldId = new Map(fields.map((field) => [field.key, field.id]));
    await env.DB.prepare(
      `INSERT INTO form_submission_answers (id, submission_id, field_id, field_key, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        submissions[0].id,
        fieldId.get("company"),
        "company",
        JSON.stringify("Example Org"),
        nowIso(),
        crypto.randomUUID(),
        submissions[0].id,
        fieldId.get("tracks"),
        "tracks",
        JSON.stringify(["PKI", "PQC"]),
        nowIso(),
        crypto.randomUUID(),
        submissions[1].id,
        fieldId.get("company"),
        "company",
        JSON.stringify("Other Org"),
        nowIso(),
        crypto.randomUUID(),
        submissions[1].id,
        fieldId.get("tracks"),
        "tracks",
        JSON.stringify(["PKI"]),
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

    const submissionsResponse = await callAdmin("/api/v1/admin/forms/event-workshop-form/submissions?limit=1");
    expect(submissionsResponse.status).toBe(200);
    const submissionsPayload = (await submissionsResponse.json()) as {
      page: { total: number; hasMore: boolean };
      submissions: Array<{ answers: Record<string, unknown> }>;
    };
    expect(submissionsPayload.page).toMatchObject({ total: 2, hasMore: true });
    expect(submissionsPayload.submissions).toHaveLength(1);
    expect(submissionsPayload.submissions[0]?.answers.company).toBe("Example Org");
    expect(submissionsPayload.submissions[0]?.answers.tracks).toEqual(["PKI", "PQC"]);

    const statsOnlyResponse = await callAdmin("/api/v1/admin/forms/event-workshop-form/submissions/stats");
    expect(statsOnlyResponse.status).toBe(200);
    const statsOnlyPayload = (await statsOnlyResponse.json()) as {
      total: number;
      stats: Array<{ fieldKey: string; entries: Array<{ label: string; count: number }> }>;
    };
    expect(statsOnlyPayload.total).toBe(2);
    expect(statsOnlyPayload.stats.find((stat) => stat.fieldKey === "company")?.entries).toEqual([
      { label: "Example Org", count: 1, percent: 50, weight: 1 },
      { label: "Other Org", count: 1, percent: 50, weight: 1 },
    ]);
  });

  it("includes linked registration and proposal answers as form responses", async () => {
    const { eventId } = await setupAdmin();
    const [adminUser] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    const timestamp = nowIso();
    const secondUserId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'forms-attendee@example.test', 'forms-attendee@example.test', 'user', 1, ?, ?)`,
    )
      .bind(secondUserId, timestamp, timestamp)
      .run();

    await insertForm({
      key: "linked-registration-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "event_registration",
      title: "Registration questions",
      fields: [
        { key: "food", label: "Food", fieldType: "text", sortOrder: 10 },
        { key: "topics", label: "Topics", fieldType: "multi_select", sortOrder: 20, options: ["PKI", "PQC"] },
      ],
    });
    await insertForm({
      key: "linked-proposal-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "proposal_submission",
      title: "Proposal questions",
      fields: [{ key: "audience", label: "Audience", fieldType: "text", sortOrder: 10 }],
    });

    const registrationId = crypto.randomUUID();
    const inPersonRegistrationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO registrations (
         id, event_id, user_id, status, attendance_type, source_type, custom_answers_json,
         manage_link_secret, created_at, updated_at
       ) VALUES (?, ?, ?, 'registered', 'virtual', 'admin', ?, ?, ?, ?),
                (?, ?, ?, 'registered', 'in_person', 'admin', ?, ?, ?, ?)`,
    )
      .bind(
        registrationId,
        eventId,
        adminUser.id,
        JSON.stringify({ food: "No peanuts", topics: ["PKI", "PQC"] }),
        crypto.randomUUID(),
        timestamp,
        timestamp,
        inPersonRegistrationId,
        eventId,
        secondUserId,
        JSON.stringify({ food: "Vegetarian", topics: ["PKI"] }),
        crypto.randomUUID(),
        timestamp,
        timestamp,
      )
      .run();

    const proposalId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO session_proposals (
         id, event_id, proposer_user_id, status, proposal_type, title, abstract, details_json,
         manage_link_secret, submitted_at, updated_at
       ) VALUES (?, ?, ?, 'submitted', 'talk', 'Test proposal', 'Abstract', ?, ?, ?, ?)`,
    )
      .bind(
        proposalId,
        eventId,
        adminUser.id,
        JSON.stringify({ audience: "Operators" }),
        crypto.randomUUID(),
        timestamp,
        timestamp,
      )
      .run();

    const registrationResponse = await callAdmin(
      "/api/v1/admin/forms/linked-registration-form/submissions?eventSlug=pqc-2026",
    );
    expect(registrationResponse.status).toBe(200);
    const registrationPayload = (await registrationResponse.json()) as {
      page: { total: number };
      submissions: Array<{ contextType: string; contextRef: string; answers: Record<string, unknown> }>;
    };
    expect(registrationPayload.page.total).toBe(2);
    expect(registrationPayload.submissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contextType: "registration",
          contextRef: registrationId,
          answers: { food: "No peanuts", topics: ["PKI", "PQC"] },
        }),
      ]),
    );

    const filteredRegistrationResponse = await callAdmin(
      "/api/v1/admin/forms/linked-registration-form/submissions?eventSlug=pqc-2026&attendanceType=virtual",
    );
    expect(filteredRegistrationResponse.status).toBe(200);
    const filteredRegistrationPayload = (await filteredRegistrationResponse.json()) as {
      page: { total: number };
      submissions: Array<{ contextRef: string }>;
    };
    expect(filteredRegistrationPayload.page.total).toBe(1);
    expect(filteredRegistrationPayload.submissions[0]?.contextRef).toBe(registrationId);
    const statsOnlyResponse = await callAdmin(
      "/api/v1/admin/forms/linked-registration-form/submissions/stats?eventSlug=pqc-2026&attendanceType=virtual",
    );
    expect(statsOnlyResponse.status).toBe(200);
    const statsOnlyPayload = (await statsOnlyResponse.json()) as {
      total: number;
      stats: Array<{ fieldKey: string; entries: Array<{ label: string; count: number }> }>;
    };
    expect(statsOnlyPayload.total).toBe(1);
    expect(statsOnlyPayload.stats.find((stat) => stat.fieldKey === "food")?.entries).toEqual([
      { label: "No peanuts", count: 1, percent: 100, weight: 1 },
    ]);

    const proposalResponse = await callAdmin("/api/v1/admin/forms/linked-proposal-form/submissions?eventSlug=pqc-2026");
    expect(proposalResponse.status).toBe(200);
    const proposalPayload = (await proposalResponse.json()) as {
      page: { total: number };
      submissions: Array<{ contextType: string; contextRef: string; answers: Record<string, unknown> }>;
    };
    expect(proposalPayload.page.total).toBe(1);
    expect(proposalPayload.submissions[0]).toMatchObject({
      contextType: "proposal",
      contextRef: proposalId,
      answers: { audience: "Operators" },
    });

    const registrationFieldPatch = await callAdmin("/api/v1/admin/forms/linked-registration-form", {
      method: "PATCH",
      body: JSON.stringify({
        fields: [
          {
            key: "topics",
            label: "Topics",
            fieldType: "multi_select",
            required: false,
            sortOrder: 20,
            options: ["PKI", "PQC"],
          },
        ],
      }),
    });
    expect(registrationFieldPatch.status, await registrationFieldPatch.clone().text()).toBe(200);
    const registrationFieldPayload = (await registrationFieldPatch.json()) as {
      fields: Array<{ key: string; archivedAt: string | null }>;
    };
    expect(registrationFieldPayload.fields.find((field) => field.key === "food")?.archivedAt).toBeTruthy();

    const proposalFieldPatch = await callAdmin("/api/v1/admin/forms/linked-proposal-form", {
      method: "PATCH",
      body: JSON.stringify({ fields: [] }),
    });
    expect(proposalFieldPatch.status, await proposalFieldPatch.clone().text()).toBe(200);
    const proposalFieldPayload = (await proposalFieldPatch.json()) as {
      fields: Array<{ key: string; archivedAt: string | null }>;
    };
    expect(proposalFieldPayload.fields.find((field) => field.key === "audience")?.archivedAt).toBeTruthy();

    const deleteRegistrationForm = await callAdmin("/api/v1/admin/forms/linked-registration-form", {
      method: "DELETE",
    });
    expect(deleteRegistrationForm.status).toBe(200);
    await expect(deleteRegistrationForm.json()).resolves.toMatchObject({ action: "archived" });
    expect(
      await queryAll<{ status: string }>(env.DB, "SELECT status FROM forms WHERE key = 'linked-registration-form'"),
    ).toEqual([{ status: "archived" }]);
  });

  it("replaces fields on patch and archives submitted forms on delete", async () => {
    const { eventId } = await setupAdmin();
    const { formId } = await insertForm({
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

    expect(patchResponse.status, await patchResponse.clone().text()).toBe(200);
    const patchPayload = (await patchResponse.json()) as {
      success: boolean;
      fields: Array<{ key: string; archivedAt: string | null }>;
    };
    expect(patchPayload.success).toBe(true);
    expect(patchPayload.fields.map((field) => field.key)).toEqual(["new_field", "old_field", "topics"]);
    expect(patchPayload.fields.find((field) => field.key === "old_field")?.archivedAt).toBeTruthy();

    const deleteResponse = await callAdmin("/api/v1/admin/forms/mutable-form", { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);
    const deletePayload = (await deleteResponse.json()) as { action: string; message?: string };
    expect(deletePayload.action).toBe("archived");

    const archived = await queryAll<{ status: string }>(env.DB, "SELECT status FROM forms WHERE key = ?", [
      "mutable-form",
    ]);
    expect(archived[0]?.status).toBe("archived");
    expect(
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_type = 'form' AND entity_id = ? AND action = 'form_archived'",
        [formId],
      ),
    ).toHaveLength(1);
  });

  it("preserves a server-owned option catalog through the management API", async () => {
    const { eventId } = await setupAdmin();
    await insertForm({
      key: "catalog-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "survey",
      title: "Catalog form",
      fields: [
        {
          key: "working_groups",
          label: "Working Groups",
          fieldType: "multi_select",
          optionSource: "active_working_groups",
        },
      ],
    });

    const getResponse = await callAdmin("/api/v1/admin/forms/catalog-form");
    expect(getResponse.status).toBe(200);
    const getPayload = (await getResponse.json()) as {
      fields: Array<{ key: string; optionSource?: string | null; options: unknown[] | null }>;
    };
    expect(getPayload.fields[0]).toMatchObject({
      key: "working_groups",
      optionSource: "active_working_groups",
      options: null,
    });

    const patchResponse = await callAdmin("/api/v1/admin/forms/catalog-form", {
      method: "PATCH",
      body: JSON.stringify({
        fields: [
          {
            key: "working_groups",
            label: "Updated Working Groups",
            fieldType: "multi_select",
            optionSource: "active_working_groups",
          },
        ],
      }),
    });
    expect(patchResponse.status, await patchResponse.clone().text()).toBe(200);
    expect(
      await queryAll<{ options_json: string | null; option_source: string | null }>(
        env.DB,
        `SELECT options_json, option_source
           FROM form_fields
          WHERE form_id = (SELECT id FROM forms WHERE key = 'catalog-form')`,
      ),
    ).toEqual([{ options_json: null, option_source: "active_working_groups" }]);
  });

  it("uses the same option catalog when labeling submission statistics", async () => {
    const { eventId } = await setupAdmin();
    const groupId = "20000000-0000-4000-8000-000000000003";
    await insertForm({
      key: "catalog-stats-form",
      scopeType: "event",
      scopeRef: eventId,
      purpose: "survey",
      title: "Catalog statistics",
      fields: [
        {
          key: "working_groups",
          label: "Working Groups",
          fieldType: "multi_select",
          optionSource: "active_working_groups",
        },
      ],
      submission: {
        contextType: "survey",
        answers: { working_groups: [groupId] },
      },
    });
    await env.DB.prepare("UPDATE groups SET active = 0 WHERE id = ?").bind(groupId).run();

    const response = await callAdmin("/api/v1/admin/forms/catalog-stats-form/submissions/stats?eventSlug=pqc-2026");
    expect(response.status, await response.clone().text()).toBe(200);
    const payload = (await response.json()) as {
      stats: Array<{ fieldKey: string; entries: Array<{ label: string; count: number }> }>;
    };
    expect(payload.stats.find((stat) => stat.fieldKey === "working_groups")?.entries).toEqual([
      { label: "Post-Quantum Cryptography Working Group", count: 1, percent: 100, weight: 1 },
    ]);
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
    expect(await queryAll(env.DB, "SELECT id FROM forms WHERE key = 'empty-form'")).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_type = 'form' AND action = 'form_deleted'"),
    ).toHaveLength(1);

    const missingResponse = await callAdmin("/api/v1/admin/forms/does-not-exist");
    expect(missingResponse.status).toBe(404);
    const missingPayload = (await missingResponse.json()) as { error?: { code?: string } };
    expect(missingPayload.error?.code).toBe("FORM_NOT_FOUND");
  });
});
