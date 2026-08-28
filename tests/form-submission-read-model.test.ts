import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  adminFormSubmissionStatsResponseSchema,
  adminFormSubmissionsResponseSchema,
} from "../assets/shared/schemas/admin-forms";
import {
  resolveFormSubmissionPopulation,
  selectFromSubmissionPopulation,
} from "../functions/_lib/services/form-submissions/population-query";
import { buildFormSubmissionsPageQuery } from "../functions/_lib/services/form-submissions/submission-page";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

let adminToken: string;
let eventId: string;

async function adminGet(path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${adminToken}` } });
}

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

async function insertForm(
  key: string,
  purpose: "event_registration" | "proposal_submission",
  fieldKey: string,
  scopeRef: string | null = null,
): Promise<string> {
  const formId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`,
    ).bind(formId, key, scopeRef ? "event" : "global", scopeRef, purpose, `${key} title`),
    env.DB.prepare(
      `INSERT INTO form_fields
         (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
       VALUES (?, ?, ?, ?, 'text', 0, NULL, NULL, 10, datetime('now'))`,
    ).bind(crypto.randomUUID(), formId, fieldKey, `${fieldKey} label`),
  ]);
  return formId;
}

async function insertEvent(slug: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
  )
    .bind(id, slug, `${slug} event`)
    .run();
  return id;
}

async function insertRegistration(options: {
  eventId: string;
  userId: string;
  status: "registered" | "cancelled";
  attendanceType: "virtual" | "in_person";
  answer: unknown;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO registrations
       (id, event_id, user_id, status, attendance_type, source_type, custom_answers_json,
        manage_link_secret, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      options.eventId,
      options.userId,
      options.status,
      options.attendanceType,
      JSON.stringify({ food: options.answer }),
      crypto.randomUUID(),
    )
    .run();
  return id;
}

async function insertProposal(options: {
  userId: string;
  status: "accepted" | "rejected";
  title: string;
  answer: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO session_proposals
       (id, event_id, proposer_user_id, status, proposal_type, title, abstract, details_json,
        manage_link_secret, submitted_at, updated_at)
     VALUES (?, ?, ?, ?, 'talk', ?, 'Abstract', ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      eventId,
      options.userId,
      options.status,
      options.title,
      JSON.stringify({ audience: options.answer }),
      crypto.randomUUID(),
    )
    .run();
  return id;
}

async function backfillSourceAnswer(options: {
  formId: string;
  contextType: "registration" | "proposal";
  contextRef: string;
  fieldKey: string;
  answer: unknown;
}): Promise<void> {
  const submissionId = crypto.randomUUID();
  const [field] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM form_fields WHERE form_id = ? AND key = ? LIMIT 1",
    [options.formId, options.fieldKey],
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO form_submissions
         (id, form_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
       VALUES (?, ?, NULL, ?, ?, 'submitted', datetime('now'))`,
    ).bind(submissionId, options.formId, options.contextType, options.contextRef),
    env.DB.prepare(
      `INSERT INTO form_submission_answers (id, submission_id, field_id, field_key, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(crypto.randomUUID(), submissionId, field.id, options.fieldKey, JSON.stringify(options.answer)),
  ]);
}

async function readPopulation(formKey: string, filters: Record<string, string>) {
  const query = new URLSearchParams({ ...filters, limit: "1" });
  const statsQuery = new URLSearchParams(filters);
  const [listResponse, statsResponse] = await Promise.all([
    adminGet(`/api/v1/admin/forms/${formKey}/submissions?${query}`),
    adminGet(`/api/v1/admin/forms/${formKey}/submissions/stats?${statsQuery}`),
  ]);
  expect(listResponse.status).toBe(200);
  expect(statsResponse.status).toBe(200);
  return {
    list: adminFormSubmissionsResponseSchema.parse(await listResponse.json()),
    stats: adminFormSubmissionStatsResponseSchema.parse(await statsResponse.json()),
  };
}

async function expectIndexedSubmissionPage(
  formKey: string,
  filters: Record<string, string>,
  sourceIndex: RegExp,
): Promise<void> {
  const population = await resolveFormSubmissionPopulation(env.DB, {
    formKey,
    status: filters.status ?? "",
    attendanceType: filters.attendanceType ?? "",
    eventSlug: filters.eventSlug ?? "",
    q: filters.q,
  });
  const query = buildFormSubmissionsPageQuery(population, { limit: 1, offset: 0, sort: "-submittedAt" });
  const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
  const [pagePlan, countPlan] = await Promise.all([
    queryAll<{ detail: string }>(env.DB, `EXPLAIN QUERY PLAN ${pageSql}`, [...bindings, 1, 0]),
    queryAll<{ detail: string }>(env.DB, `EXPLAIN QUERY PLAN ${countSql}`, [...countBindings]),
  ]);
  for (const plan of [pagePlan, countPlan]) {
    const detail = plan.map((row) => row.detail).join("\n");
    expect(detail).toContain("idx_form_submissions_form_context");
    expect(detail).toMatch(/idx_form_submissions_(?:placement_status|form)/);
    expect(detail).toMatch(sourceIndex);
    expect(detail).not.toMatch(/(?:^|\n)SCAN fs2(?:$|\s)/);
    expect(detail).not.toMatch(/(?:^|\n)SCAN answer_search(?:$|\s)/);
  }
}

describe("form-submission read-model population", () => {
  beforeEach(async () => {
    await resetDb();
    ({ eventId } = await seedEventAndAdmin(env.DB));
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    adminToken = await createAdminSession(env.DB, admin.id, "form-read-model-admin");
  });

  it("keeps registration filters, page totals, and statistics identical before and after backfill", async () => {
    const formId = await insertForm("registration-population", "event_registration", "food");
    const legacyUser = await insertUser("needle-legacy@example.test");
    const backfilledUser = await insertUser("needle-backfilled@example.test");
    const cancelledUser = await insertUser("needle-cancelled@example.test");
    const inPersonUser = await insertUser("needle-in-person@example.test");
    const otherUser = await insertUser("other@example.test");
    const elsewhereUser = await insertUser("needle-elsewhere@example.test");
    const otherEventId = await insertEvent("other-event");

    await insertRegistration({
      eventId,
      userId: legacyUser,
      status: "registered",
      attendanceType: "virtual",
      answer: "Legacy",
    });
    const backfilledRegistration = await insertRegistration({
      eventId,
      userId: backfilledUser,
      status: "registered",
      attendanceType: "virtual",
      answer: "Replaced by normalized answer",
    });
    await backfillSourceAnswer({
      formId,
      contextType: "registration",
      contextRef: backfilledRegistration,
      fieldKey: "food",
      answer: "Backfilled",
    });
    await insertRegistration({
      eventId,
      userId: cancelledUser,
      status: "cancelled",
      attendanceType: "virtual",
      answer: "Cancelled",
    });
    await insertRegistration({
      eventId,
      userId: inPersonUser,
      status: "registered",
      attendanceType: "in_person",
      answer: "In person",
    });
    await insertRegistration({
      eventId,
      userId: otherUser,
      status: "registered",
      attendanceType: "virtual",
      answer: "Other",
    });
    const elsewhereRegistration = await insertRegistration({
      eventId: otherEventId,
      userId: elsewhereUser,
      status: "registered",
      attendanceType: "virtual",
      answer: "Elsewhere",
    });
    await backfillSourceAnswer({
      formId,
      contextType: "registration",
      contextRef: elsewhereRegistration,
      fieldKey: "food",
      answer: "Elsewhere",
    });

    const result = await readPopulation("registration-population", {
      eventSlug: "pqc-2026",
      status: "registered",
      attendanceType: "virtual",
      q: "needle",
    });
    expect(result.list.page).toMatchObject({ total: 2, hasMore: true });
    expect(result.list.submissions).toHaveLength(1);
    expect(result.list.submissions[0]?.status).toBe("registered");
    expect(result.stats.total).toBe(2);
    expect(result.stats.stats).toEqual([
      expect.objectContaining({
        fieldKey: "food",
        totalAnswers: 2,
        entries: [
          { label: "Backfilled", count: 1, percent: 50, weight: 1 },
          { label: "Legacy", count: 1, percent: 50, weight: 1 },
        ],
      }),
    ]);
    await expectIndexedSubmissionPage(
      "registration-population",
      {
        eventSlug: "pqc-2026",
        status: "registered",
        attendanceType: "virtual",
        q: "needle",
      },
      /idx_registrations_(?:form_placement|event_status)/,
    );
  });

  it("keeps proposal status and title search stable after answers are backfilled", async () => {
    const formId = await insertForm("proposal-population", "proposal_submission", "audience");
    const legacyUser = await insertUser("legacy-speaker@example.test");
    const backfilledUser = await insertUser("backfilled-speaker@example.test");
    const unrelatedUser = await insertUser("unrelated-speaker@example.test");
    await insertProposal({ userId: legacyUser, status: "accepted", title: "Needle legacy", answer: "Legacy" });
    const backfilledProposal = await insertProposal({
      userId: backfilledUser,
      status: "accepted",
      title: "Needle backfilled",
      answer: "Replaced by normalized answer",
    });
    await backfillSourceAnswer({
      formId,
      contextType: "proposal",
      contextRef: backfilledProposal,
      fieldKey: "audience",
      answer: "Backfilled",
    });
    await insertProposal({ userId: unrelatedUser, status: "accepted", title: "Unrelated title", answer: "Other" });

    const result = await readPopulation("proposal-population", {
      eventSlug: "pqc-2026",
      status: "accepted",
      q: "needle",
    });
    expect(result.list.page).toMatchObject({ total: 2, hasMore: true });
    expect(result.list.submissions[0]?.status).toBe("accepted");
    expect(result.stats.total).toBe(2);
    expect(result.stats.stats[0]).toMatchObject({ fieldKey: "audience", totalAnswers: 2 });
    expect(result.stats.stats[0]?.entries.map((entry) => entry.label)).toEqual(["Backfilled", "Legacy"]);
    await expectIndexedSubmissionPage(
      "proposal-population",
      {
        eventSlug: "pqc-2026",
        status: "accepted",
        q: "needle",
      },
      /idx_(?:session_proposals_form_placement|proposals_event_status|session_proposals_event_live_submitted)/,
    );
  });

  it("preserves boolean labels and skips malformed legacy answer JSON", async () => {
    const formId = await insertForm("boolean-population", "event_registration", "food");
    const trueUser = await insertUser("boolean-true@example.test");
    const falseUser = await insertUser("boolean-false@example.test");
    const backfilledUser = await insertUser("boolean-backfilled@example.test");
    const malformedUser = await insertUser("boolean-malformed@example.test");

    await insertRegistration({
      eventId,
      userId: trueUser,
      status: "registered",
      attendanceType: "virtual",
      answer: true,
    });
    await insertRegistration({
      eventId,
      userId: falseUser,
      status: "registered",
      attendanceType: "virtual",
      answer: false,
    });
    const backfilledRegistration = await insertRegistration({
      eventId,
      userId: backfilledUser,
      status: "registered",
      attendanceType: "virtual",
      answer: "replaced",
    });
    await backfillSourceAnswer({
      formId,
      contextType: "registration",
      contextRef: backfilledRegistration,
      fieldKey: "food",
      answer: true,
    });
    const malformedRegistration = await insertRegistration({
      eventId,
      userId: malformedUser,
      status: "registered",
      attendanceType: "virtual",
      answer: true,
    });
    await env.DB.prepare("UPDATE registrations SET custom_answers_json = ? WHERE id = ?")
      .bind("{malformed-json", malformedRegistration)
      .run();

    const response = await adminGet(
      "/api/v1/admin/forms/boolean-population/submissions/stats?eventSlug=pqc-2026&status=registered",
    );
    expect(response.status).toBe(200);
    const result = adminFormSubmissionStatsResponseSchema.parse(await response.json());
    expect(result.total).toBe(4);
    expect(result.stats).toEqual([
      expect.objectContaining({
        fieldKey: "food",
        totalAnswers: 3,
        entries: [
          { label: "Yes", count: 2, percent: 67, weight: 1 },
          { label: "No", count: 1, percent: 33, weight: 0.5 },
        ],
      }),
    ]);
  });

  it("rejects an event slug that conflicts with an event-scoped form", async () => {
    await insertForm("event-scoped-population", "event_registration", "food", eventId);
    await insertEvent("unrelated-event");

    const response = await adminGet(
      "/api/v1/admin/forms/event-scoped-population/submissions?eventSlug=unrelated-event",
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "FORM_EVENT_SCOPE_MISMATCH" } });
  });

  it("keeps unattributed legacy submissions scoped to their own form when a sole placement is inferred", async () => {
    const formId = await insertForm("placed-population", "event_registration", "food");
    const unrelatedFormId = await insertForm("unrelated-population", "event_registration", "food");
    const placementId = crypto.randomUUID();
    const placedSubmissionId = crypto.randomUUID();
    const legacySubmissionId = crypto.randomUUID();
    const unrelatedSubmissionId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO form_placements
           (id, form_id, owner_group_id, context_type, context_ref, audience, active,
            opens_at, closes_at, created_at, updated_at)
         VALUES (?, ?, NULL, 'installation', NULL, 'attendee', 1,
                 NULL, NULL, datetime('now'), datetime('now'))`,
      ).bind(placementId, formId),
      env.DB.prepare(
        `INSERT INTO form_submissions
           (id, form_id, placement_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
         VALUES (?, ?, ?, NULL, 'survey', NULL, 'submitted', datetime('now'))`,
      ).bind(placedSubmissionId, formId, placementId),
      env.DB.prepare(
        `INSERT INTO form_submissions
           (id, form_id, placement_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
         VALUES (?, ?, NULL, NULL, 'survey', NULL, 'submitted', datetime('now'))`,
      ).bind(legacySubmissionId, formId),
      env.DB.prepare(
        `INSERT INTO form_submissions
           (id, form_id, placement_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
         VALUES (?, ?, NULL, NULL, 'survey', NULL, 'submitted', datetime('now'))`,
      ).bind(unrelatedSubmissionId, unrelatedFormId),
    ]);

    const population = await resolveFormSubmissionPopulation(env.DB, { formKey: "placed-population" });
    const query = selectFromSubmissionPopulation(population, "SELECT id FROM merged ORDER BY id ASC");
    const rows = await queryAll<{ id: string }>(env.DB, query.sql, query.bindings);
    expect(rows.map((row) => row.id)).toEqual([legacySubmissionId, placedSubmissionId].sort());
  });
});
