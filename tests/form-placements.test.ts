import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { adminFormCreateResponseSchema } from "../assets/shared/schemas/admin-forms";
import { formPlacementCreateResponseSchema } from "../assets/shared/schemas/forms";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import {
  getActiveFormByPurpose,
  prepareCreateFormSubmission,
  validateCustomAnswersAgainstForm,
} from "../functions/_lib/services/forms";
import {
  resolveFormSubmissionPopulation,
  selectFromSubmissionPopulation,
} from "../functions/_lib/services/form-submissions/population-query";

let adminToken: string;

function adminRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${adminToken}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
}

async function insertEvent(slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events
       (id, slug, name, timezone, registration_mode, invite_limit_attendee,
        settings_json, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
  )
    .bind(id, slug, `${slug} event`)
    .run();
  return id;
}

async function placeForm(formKey: string, eventId: string, audience: string) {
  const response = await adminRequest(`/api/v1/admin/forms/${formKey}/placements`, {
    method: "POST",
    body: JSON.stringify({
      contextType: "event",
      contextRef: eventId,
      audience,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return formPlacementCreateResponseSchema.parse(await response.json()).placement;
}

async function submit(
  form: NonNullable<Awaited<ReturnType<typeof getActiveFormByPurpose>>>,
  answers: Record<string, unknown>,
) {
  const normalized = validateCustomAnswersAgainstForm(form, { customAnswers: answers, errorStatus: 422 });
  const prepared = prepareCreateFormSubmission(
    env.DB,
    form,
    { submittedByUserId: null, contextType: "survey", contextRef: null },
    normalized,
    new Date().toISOString(),
  );
  await env.DB.batch(prepared.statements);
  return prepared.id;
}

describe("reusable live-editable form placements", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    adminToken = await createAdminSession(env.DB, admin.id, "form-placement-admin");
  });

  it("reuses one live definition while keeping placement responses and statistics isolated in D1", async () => {
    const firstEventId = await insertEvent("placement-one");
    const secondEventId = await insertEvent("placement-two");
    const createResponse = await adminRequest("/api/v1/admin/forms", {
      method: "POST",
      body: JSON.stringify({
        key: "shared-survey",
        purpose: "survey",
        title: "Shared survey",
        fields: [
          {
            key: "topic",
            label: "Topic",
            fieldType: "select",
            required: true,
            sortOrder: 10,
            options: ["Alpha", "Beta", "Legacy"],
          },
          { key: "notes", label: "Notes", fieldType: "textarea", sortOrder: 20 },
        ],
      }),
    });
    expect(createResponse.status, await createResponse.clone().text()).toBe(201);
    const created = adminFormCreateResponseSchema.parse(await createResponse.json());
    const firstPlacement = await placeForm("shared-survey", firstEventId, "group_member");
    let secondPlacement = await placeForm("shared-survey", secondEventId, "group_member");

    const placementsResponse = await adminRequest(
      `/api/v1/admin/forms/shared-survey/placements?contextType=event&q=group&sort=created_at&limit=10`,
    );
    expect(placementsResponse.status).toBe(200);
    const placements = (await placementsResponse.json()) as {
      placements: Array<{ id: string }>;
      page: { total: number };
    };
    expect(placements.page.total).toBe(2);
    expect(placements.placements.map((placement) => placement.id)).toEqual(
      expect.arrayContaining([firstPlacement.id, secondPlacement.id]),
    );

    const placementPatch = await adminRequest(`/api/v1/admin/forms/shared-survey/placements/${secondPlacement.id}`, {
      method: "PATCH",
      body: JSON.stringify({ audience: "reviewer" }),
    });
    expect(placementPatch.status, await placementPatch.clone().text()).toBe(200);
    secondPlacement = formPlacementCreateResponseSchema.parse(await placementPatch.json()).placement;
    expect(secondPlacement.audience).toBe("reviewer");

    const firstDefinition = await getActiveFormByPurpose(env.DB, firstEventId, "survey");
    const secondDefinition = await getActiveFormByPurpose(env.DB, secondEventId, "survey");
    expect(firstDefinition?.id).toBe(created.formId);
    expect(secondDefinition?.id).toBe(created.formId);
    expect(firstDefinition?.placement?.id).toBe(firstPlacement.id);
    expect(secondDefinition?.placement?.id).toBe(secondPlacement.id);

    await submit(firstDefinition!, { topic: "Alpha", notes: "Archive this field" });
    await submit(secondDefinition!, { topic: "Beta", notes: "Second response set" });

    const detailResponse = await adminRequest("/api/v1/admin/forms/shared-survey");
    const detail = (await detailResponse.json()) as {
      fields: Array<{ id: string; key: string }>;
    };
    const topicId = detail.fields.find((field) => field.key === "topic")?.id;
    expect(topicId).toBeTruthy();

    const patchResponse = await adminRequest("/api/v1/admin/forms/shared-survey", {
      method: "PATCH",
      body: JSON.stringify({
        fields: [
          {
            id: topicId,
            key: "subject",
            label: "Subject",
            fieldType: "multi_select",
            required: true,
            sortOrder: 20,
            options: ["Alpha", "Gamma"],
            validation: {
              helpText: "Choose the most relevant subject.",
              maxItems: 3,
              adminVisualization: "bar",
            },
          },
          { key: "follow_up", label: "Follow up", fieldType: "boolean", sortOrder: 10 },
        ],
      }),
    });
    expect(patchResponse.status, await patchResponse.clone().text()).toBe(200);
    const updated = (await patchResponse.json()) as {
      fields: Array<{
        id: string;
        key: string;
        validation?: { helpText?: string } | null;
        options?: Array<{ value: string; active: boolean }> | null;
        archivedAt: string | null;
      }>;
    };
    expect(updated.fields.find((field) => field.id === topicId)).toMatchObject({
      key: "subject",
      validation: { helpText: "Choose the most relevant subject." },
      archivedAt: null,
    });
    expect(updated.fields.find((field) => field.id === topicId)?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "Alpha", active: true }),
        expect.objectContaining({ value: "Beta", active: false }),
        expect.objectContaining({ value: "Legacy", active: false }),
      ]),
    );
    expect(updated.fields.find((field) => field.key === "notes")?.archivedAt).toBeTruthy();

    for (const [placement, expected] of [
      [firstPlacement, "Alpha"],
      [secondPlacement, "Beta"],
    ] as const) {
      const listResponse = await adminRequest(
        `/api/v1/admin/forms/shared-survey/submissions?placementId=${placement.id}`,
      );
      expect(listResponse.status).toBe(200);
      const list = (await listResponse.json()) as {
        page: { total: number };
        submissions: Array<{ answers: Record<string, unknown> }>;
      };
      expect(list.page.total).toBe(1);
      expect(list.submissions[0]?.answers.subject).toBe(expected);
      expect(list.submissions[0]?.answers.topic).toBeUndefined();

      const statsResponse = await adminRequest(
        `/api/v1/admin/forms/shared-survey/submissions/stats?placementId=${placement.id}`,
      );
      const stats = (await statsResponse.json()) as {
        total: number;
        stats: Array<{ fieldKey: string; entries: Array<{ label: string; count: number }> }>;
      };
      expect(stats.total).toBe(1);
      expect(stats.stats.find((field) => field.fieldKey === "subject")?.entries).toEqual([
        { label: expected, count: 1, percent: 100, weight: 1 },
      ]);
    }

    const firstAfterEdit = await getActiveFormByPurpose(env.DB, firstEventId, "survey");
    const secondAfterEdit = await getActiveFormByPurpose(env.DB, secondEventId, "survey");
    expect(firstAfterEdit?.fields.map((field) => field.key)).toEqual(["follow_up", "subject"]);
    expect(secondAfterEdit?.fields).toEqual(firstAfterEdit?.fields);

    const population = await resolveFormSubmissionPopulation(env.DB, {
      formKey: "shared-survey",
      placementId: firstPlacement.id,
    });
    const query = selectFromSubmissionPopulation(population, "SELECT id FROM merged ORDER BY submitted_at DESC");
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .bind(...query.bindings)
      .all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join("\n")).toContain("idx_form_submissions_placement_status");

    const deactivateResponse = await adminRequest(`/api/v1/admin/forms/shared-survey/placements/${firstPlacement.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });
    expect(deactivateResponse.status).toBe(200);
    const historicalResponse = await adminRequest(
      `/api/v1/admin/forms/shared-survey/submissions?placementId=${firstPlacement.id}`,
    );
    expect(historicalResponse.status).toBe(200);
    expect(((await historicalResponse.json()) as { page: { total: number } }).page.total).toBe(1);
  });

  it("atomically rejects a submission validated against a stale form definition", async () => {
    const eventId = await insertEvent("stale-form");
    await adminRequest("/api/v1/admin/forms", {
      method: "POST",
      body: JSON.stringify({
        key: "stale-survey",
        purpose: "survey",
        title: "Stale survey",
        fields: [{ key: "answer", label: "Answer", fieldType: "text", required: true }],
      }),
    });
    await placeForm("stale-survey", eventId, "group_member");
    const staleDefinition = await getActiveFormByPurpose(env.DB, eventId, "survey");
    const prepared = prepareCreateFormSubmission(
      env.DB,
      staleDefinition!,
      { submittedByUserId: null, contextType: "survey", contextRef: null },
      { answer: "Validated before edit" },
      new Date().toISOString(),
    );

    await env.DB.prepare("UPDATE forms SET updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(staleDefinition!.id)
      .run();

    await expect(env.DB.batch(prepared.statements)).rejects.toThrow("FORM_SUBMISSION_CONTEXT_CHANGED");
    expect(await queryAll(env.DB, "SELECT id FROM form_submissions WHERE id = ?", [prepared.id])).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM form_submission_guards")).toHaveLength(0);
  });

  it("atomically rejects a response when its placement changes before commit", async () => {
    const eventId = await insertEvent("stale-placement");
    await adminRequest("/api/v1/admin/forms", {
      method: "POST",
      body: JSON.stringify({
        key: "placement-guard-survey",
        purpose: "survey",
        title: "Placement guard survey",
        fields: [{ key: "answer", label: "Answer", fieldType: "text", required: true }],
      }),
    });
    const placement = await placeForm("placement-guard-survey", eventId, "group_member");
    const definition = await getActiveFormByPurpose(env.DB, eventId, "survey");
    const prepared = prepareCreateFormSubmission(
      env.DB,
      definition!,
      { submittedByUserId: null, contextType: "survey", contextRef: null },
      { answer: "Validated before placement edit" },
      new Date().toISOString(),
    );

    await env.DB.prepare(
      "UPDATE form_placements SET audience = 'reviewer', updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?",
    )
      .bind(placement.id)
      .run();

    await expect(env.DB.batch(prepared.statements)).rejects.toThrow("FORM_SUBMISSION_CONTEXT_CHANGED");
    expect(await queryAll(env.DB, "SELECT id FROM form_submissions WHERE id = ?", [prepared.id])).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM form_submission_guards")).toHaveLength(0);
  });
});
