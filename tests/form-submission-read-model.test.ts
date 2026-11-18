import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  formSubmissionStatsResponseSchema,
  formSubmissionsResponseSchema,
} from "../assets/shared/schemas/form-management";
import {
  resolveFormSubmissionPopulation,
  selectFromSubmissionPopulation,
} from "../functions/_lib/services/form-submissions/population-query";
import {
  buildFormSubmissionsPageQuery,
  readFormSubmissionSnapshot,
} from "../functions/_lib/services/form-submissions/submission-page";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { getManagedFormWithFields } from "../functions/_lib/services/forms/read";
import { exportEventFormResponses } from "../functions/_lib/services/form-submissions/export";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { resetDb } from "./helpers/reset-db";

let adminToken: string;
let eventId: string;

async function adminGet(path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${adminToken}` } });
}

async function insertUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, active, created_at, updated_at)
     VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`,
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
  placeOnDefaultEvent = false,
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
    ...(scopeRef || !placeOnDefaultEvent
      ? []
      : [
          env.DB.prepare(
            `INSERT INTO form_placements
               (id, form_id, owner_group_id, context_type, context_ref, audience, active,
                opens_at, closes_at, created_at, updated_at)
             VALUES (?, ?, NULL, 'event', ?, ?, 1, NULL, NULL, datetime('now'), datetime('now'))`,
          ).bind(crypto.randomUUID(), formId, eventId, purpose),
        ]),
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
       (id, event_id, user_id, status, source_type, custom_answers_json,
        manage_link_secret, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'admin', ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      options.eventId,
      options.userId,
      options.status,
      JSON.stringify({ food: options.answer }),
      crypto.randomUUID(),
    )
    .run();
  const at = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,'2026-12-01',?,?) ON CONFLICT(event_id,day_date) DO NOTHING",
  )
    .bind(crypto.randomUUID(), options.eventId, at, at)
    .run();
  await env.DB.prepare(
    "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) SELECT ?,?,id,?,?,? FROM event_days WHERE event_id=? AND day_date='2026-12-01'",
  )
    .bind(crypto.randomUUID(), id, options.attendanceType, at, at, options.eventId)
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
  const { eventSlug = "pqc-2026", ...responseFilters } = filters;
  const query = new URLSearchParams({ ...responseFilters, limit: "1" });
  const statsQuery = new URLSearchParams(responseFilters);
  const [listResponse, statsResponse] = await Promise.all([
    adminGet(`/api/v1/events/${eventSlug}/forms/${formKey}/submissions?${query}`),
    adminGet(`/api/v1/events/${eventSlug}/forms/${formKey}/submissions/stats?${statsQuery}`),
  ]);
  expect(listResponse.status).toBe(200);
  expect(statsResponse.status).toBe(200);
  return {
    list: formSubmissionsResponseSchema.parse(await listResponse.json()),
    stats: formSubmissionStatsResponseSchema.parse(await statsResponse.json()),
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

  it("searches and displays the selected identity's organization before and after form backfill", async () => {
    const formId = await insertForm("identity-population", "event_registration", "food", null, true);
    const userId = await insertUser("identity-population@example.test");
    const accountOrganization = await insertOrganization(env.DB, "Account organization");
    const accountIdentity = await addRepresentative(
      env.DB,
      await seedOrganizationAggregate(env.DB, accountOrganization, "A"),
      userId,
    );
    await env.DB.prepare("UPDATE identities SET is_default = 1 WHERE id = ?").bind(accountIdentity).run();
    const organizationId = await insertOrganization(env.DB, "Confirmed organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const identityId = await addRepresentative(env.DB, memberId, userId);
    const registrationId = await insertRegistration({
      eventId,
      userId,
      status: "registered",
      attendanceType: "virtual",
      answer: "Vegetarian",
    });
    await env.DB.prepare("UPDATE registrations SET registration_identity_id = ? WHERE id = ?")
      .bind(identityId, registrationId)
      .run();
    const before = await readPopulation("identity-population", { q: "Confirmed organization" });
    expect(before.list.page.total).toBe(1);
    expect(before.list.submissions[0]?.submitter?.organization).toBe("Confirmed organization");
    expect(before.stats.total).toBe(1);
    expect((await readPopulation("identity-population", { q: "Account organization" })).list.page.total).toBe(0);
    await backfillSourceAnswer({
      formId,
      contextType: "registration",
      contextRef: registrationId,
      fieldKey: "food",
      answer: "Vegetarian",
    });
    const after = await readPopulation("identity-population", { q: "Confirmed organization" });
    expect(after.list.page.total).toBe(1);
    expect(after.list.submissions[0]?.submitter?.organization).toBe("Confirmed organization");
    expect(after.stats).toEqual(before.stats);
    expect((await readPopulation("identity-population", { q: "Account organization" })).list.page.total).toBe(0);
  });

  it("filters form submissions using any selected attendance day before and after backfill", async () => {
    const formId = await insertForm("mixed-attendance-population", "event_registration", "food", null, true);
    const userId = await insertUser("mixed-attendance@example.test");
    const registrationId = await insertRegistration({
      eventId,
      userId,
      status: "registered",
      attendanceType: "in_person",
      answer: "Vegetarian",
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, sort_order, created_at, updated_at)
        VALUES ('mixed-form-day', ?, '2026-12-02', 1, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      env.DB.prepare(
        `INSERT INTO registration_day_attendance (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
        VALUES ('mixed-form-attendance', ?, 'mixed-form-day', 'virtual', datetime('now'), datetime('now'))`,
      ).bind(registrationId),
    ]);
    const filters = { attendanceType: "virtual" };
    const before = await readPopulation("mixed-attendance-population", filters);
    expect(before.list.page.total).toBe(1);
    expect(before.stats.total).toBe(1);
    expect((await readPopulation("mixed-attendance-population", { attendanceType: "in_person" })).list.page.total).toBe(
      1,
    );
    await backfillSourceAnswer({
      formId,
      contextType: "registration",
      contextRef: registrationId,
      fieldKey: "food",
      answer: "Vegetarian",
    });
    const after = await readPopulation("mixed-attendance-population", filters);
    expect(after.list.page.total).toBe(1);
    expect(after.stats.total).toBe(1);
  });

  it("keeps registration filters, page totals, and statistics identical before and after backfill", async () => {
    const formId = await insertForm("registration-population", "event_registration", "food", null, true);
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
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, sort_order, created_at, updated_at)
        VALUES ('population-day', ?, '2027-01-01', 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, sort_order, created_at, updated_at)
        VALUES ('population-other-day', ?, '2027-01-01', 0, datetime('now'), datetime('now'))`,
      ).bind(otherEventId),
      env.DB.prepare(
        `INSERT INTO registration_day_attendance
        (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
        SELECT 'selection-' || id, id, CASE WHEN event_id = ? THEN 'population-day' ELSE 'population-other-day' END,
          CASE WHEN user_id = ? THEN 'in_person' ELSE 'virtual' END,
          datetime('now'), datetime('now') FROM registrations WHERE event_id IN (?, ?)`,
      ).bind(eventId, inPersonUser, eventId, otherEventId),
    ]);

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
    const formId = await insertForm("proposal-population", "proposal_submission", "audience", null, true);
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
    const formId = await insertForm("boolean-population", "event_registration", "food", null, true);
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
      "/api/v1/events/pqc-2026/forms/boolean-population/submissions/stats?status=registered",
    );
    expect(response.status).toBe(200);
    const result = formSubmissionStatsResponseSchema.parse(await response.json());
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

  it("keeps a native answer stored as bare text in statistics, filters, and exports", async () => {
    const formId = await insertForm("bare-text-answer", "event_registration", "food", null, true);
    const registrationId = await insertRegistration({
      eventId,
      userId: await insertUser("bare-text@example.test"),
      status: "registered",
      attendanceType: "in_person",
      answer: "replaced",
    });
    await backfillSourceAnswer({
      formId,
      contextType: "registration",
      contextRef: registrationId,
      fieldKey: "food",
      answer: "placeholder",
    });
    await env.DB.prepare("UPDATE form_submission_answers SET data_json = 'Vegan' WHERE field_key = 'food'").run();

    const population = await readPopulation("bare-text-answer", { answerField: "food", answerValue: "Vegan" });
    expect(population.list.page.total).toBe(1);
    expect(population.list.submissions[0].answers.food).toBe("Vegan");
    expect(population.stats.stats).toEqual([
      expect.objectContaining({
        fieldKey: "food",
        totalAnswers: 1,
        entries: [expect.objectContaining({ label: "Vegan" })],
      }),
    ]);
    const csv = await adminGet(
      "/api/v1/events/pqc-2026/forms/bare-text-answer/submissions/exports?columns=answer:food,status",
    );
    expect((await csv.text()).split("\r\n")).toEqual(["food label,Status", "Vegan,Registered"]);
  });

  it("rejects an event slug that conflicts with an event-scoped form", async () => {
    await insertForm("event-scoped-population", "event_registration", "food", eventId);
    await insertEvent("unrelated-event");

    const response = await adminGet("/api/v1/events/unrelated-event/forms/event-scoped-population/submissions");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "FORM_NOT_FOUND" } });
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

  it("uses the installation response set for global management and excludes grouped placements", async () => {
    const formId = await insertForm("global-unowned-population", "event_registration", "food");
    await env.DB.prepare(
      `INSERT INTO form_placements
         (id, form_id, owner_group_id, context_type, context_ref, audience, active,
          opens_at, closes_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'installation', NULL, 'attendee', 1, NULL, NULL, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), formId)
      .run();

    const population = await resolveFormSubmissionPopulation(env.DB, {
      formKey: "global-unowned-population",
      unownedOnly: true,
    });
    expect(population.placement?.contextType).toBe("installation");
    expect(population.cte).toContain("fs.placement_id IS NULL");
    expect(population.cte).toContain("restricted_placement.owner_group_id IS NOT NULL");
  });

  it("keeps the global default population pinned to the installation placement", async () => {
    const formId = await insertForm("global-installation-default", "event_registration", "answer");
    await env.DB.prepare(
      `INSERT INTO form_placements
         (id, form_id, owner_group_id, context_type, context_ref, audience, active,
          opens_at, closes_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'installation', NULL, 'survey', 1, NULL, NULL, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), formId)
      .run();
    const population = await resolveFormSubmissionPopulation(env.DB, {
      formKey: "global-installation-default",
      installationOnly: true,
    });
    expect(population.placement).toMatchObject({ contextType: "installation", ownerGroupId: null });
  });
  it("filters individual dietary selections and sorts the same legacy and normalized population before paging", async () => {
    const formId = await insertForm("dietary-responses", "event_registration", "food", null, true);
    await env.DB.prepare("UPDATE form_fields SET field_type = 'multi_select', options_json = ? WHERE form_id = ?")
      .bind(
        JSON.stringify([
          { value: "vegan", label: "Vegan" },
          { value: "nut_allergy", label: "Nut allergy" },
        ]),
        formId,
      )
      .run();
    for (const [index, answer] of [["vegan", "nut_allergy"], ["vegan"], "vegetarian"].entries()) {
      const userId = await insertUser(`dietary-${index}@example.test`);
      await env.DB.prepare("UPDATE users SET first_name = 'Dietary', last_name = ? WHERE id = ?")
        .bind(`Example ${index}`, userId)
        .run();
      const registrationId = await insertRegistration({
        eventId,
        userId,
        status: "registered",
        attendanceType: "in_person",
        answer,
      });
      if (index === 1)
        await backfillSourceAnswer({
          formId,
          contextType: "registration",
          contextRef: registrationId,
          fieldKey: "food",
          answer,
        });
    }
    const filters = { answerField: "food", answerValue: "vegan", sort: "answer:food" };
    const first = await readPopulation("dietary-responses", filters);
    expect(first.list.page.total).toBe(2);
    expect(first.stats.total).toBe(2);
    const second = await adminGet(
      "/api/v1/events/pqc-2026/forms/dietary-responses/submissions?" +
        new URLSearchParams({ ...filters, limit: "1", offset: "1" }).toString(),
    );
    const page = formSubmissionsResponseSchema.parse(await second.json());
    expect(page.page.total).toBe(2);
    expect(page.submissions[0].id).not.toBe(first.list.submissions[0].id);
    const reverse = await readPopulation("dietary-responses", { ...filters, sort: "-answer:food" });
    expect(reverse.list.submissions[0].id).toBe(page.submissions[0].id);
    expect((await readPopulation("dietary-responses", { ...filters, answerValue: "nut" })).list.page.total).toBe(0);
    const csv = await adminGet(
      "/api/v1/events/pqc-2026/forms/dietary-responses/submissions/exports?" +
        new URLSearchParams({ ...filters, field: "food" }).toString(),
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("cache-control")).toContain("no-store");
    const text = await csv.text();
    expect(text.split("\r\n")).toHaveLength(3);
    expect(text).toContain("Name,food label");
    expect(text).not.toContain("@example.test");
    expect(text).not.toContain("vegetarian");
    expect(text.split("\r\n")[1]).toBe("Dietary Example 1,Vegan");
    expect(text).toContain('"Vegan, Nut allergy"');
    const exportParams = {
      ...filters,
      definition: (await getManagedFormWithFields(env.DB, "dietary-responses"))!,
      eventSlug: "pqc-2026",
      eventId,
      actorUserId: "test",
    };
    const profile = profileD1Flow(env.DB);
    await expect(
      exportEventFormResponses(profile.db, exportParams, { maxRows: 1, maxBytes: 10000 }),
    ).rejects.toMatchObject({ code: "CSV_EXPORT_ROW_LIMIT_EXCEEDED" });
    expect(profile.summary().queries.some((query) => query.sql.includes("LIMIT ? OFFSET ?"))).toBe(false);
    expect(profile.summary().queries.some((query) => query.sql.startsWith("SELECT a.submission_id"))).toBe(false);
    // A response added between the count and the read refuses the export instead of dropping a row.
    const staleCount = new Proxy(env.DB, {
      get(target, property, receiver) {
        if (property !== "prepare") return Reflect.get(target, property, receiver);
        return (sql: string) =>
          sql.includes("SELECT COUNT(*) AS total FROM merged")
            ? target.prepare(`SELECT MIN(total, 1) AS total FROM (${sql})`)
            : target.prepare(sql);
      },
    });
    await expect(
      exportEventFormResponses(staleCount, exportParams, { maxRows: 1, maxBytes: 10000 }),
    ).rejects.toMatchObject({ code: "CSV_EXPORT_ROW_LIMIT_EXCEEDED" });
    const visible = await adminGet(
      "/api/v1/events/pqc-2026/forms/dietary-responses/submissions/exports?columns=submitter,status",
    );
    expect(visible.status).toBe(200);
    const visibleRows = (await visible.text()).split("\r\n");
    expect(visibleRows[0]).toBe("Name,Status");
    expect(visibleRows.slice(1).every((row) => row.endsWith(",Registered"))).toBe(true);
    const projected = profileD1Flow(env.DB);
    await exportEventFormResponses(projected.db, { ...exportParams, field: "food" }, { maxRows: 10, maxBytes: 10000 });
    expect(projected.summary().queries.some((query) => query.sql.startsWith("SELECT a.submission_id"))).toBe(false);
    expect(projected.summary().queries.find((query) => query.sql.includes("LIMIT ? OFFSET ?"))?.sql).toContain(
      "COALESCE(ff.key, a.field_key) IN (SELECT value FROM json_each(?))",
    );
    await expect(exportEventFormResponses(env.DB, exportParams, { maxRows: 10, maxBytes: 1 })).rejects.toMatchObject({
      code: "CSV_EXPORT_TOO_LARGE",
    });
    const missing = await adminGet("/api/v1/events/pqc-2026/forms/dietary-responses/submissions/exports?field=missing");
    expect(missing.status).toBe(400);
    const empty = await adminGet(
      "/api/v1/events/pqc-2026/forms/dietary-responses/submissions/exports?answerField=food&answerValue=missing&field=food",
    );
    expect(await empty.text()).toBe("Name,food label");
  });

  it.each([
    { name: "numbers", answers: [10, 2, 3, null, ""], options: null, expected: [2, 3, 10, null, ""] },
    {
      name: "choice labels",
      answers: ["a", "z", null, ""],
      options: [
        { value: "a", label: "Zulu" },
        { value: "z", label: "Alpha" },
      ],
      expected: ["z", "a", null, ""],
    },
  ])("sorts $name before paging with blanks last in either direction", async ({ answers, options, expected }) => {
    const key = "answer-order";
    const formId = await insertForm(key, "event_registration", "food", null, true);
    await env.DB.prepare("UPDATE form_fields SET options_json = ? WHERE form_id = ?")
      .bind(JSON.stringify(options), formId)
      .run();
    for (const [index, answer] of answers.entries()) {
      const registrationId = await insertRegistration({
        eventId,
        userId: await insertUser(`order-${index}@example.test`),
        status: "registered",
        attendanceType: "in_person",
        answer,
      });
      if (index % 2 === 1)
        await backfillSourceAnswer({
          formId,
          contextType: "registration",
          contextRef: registrationId,
          fieldKey: "food",
          answer,
        });
    }
    for (const descending of [false, true]) {
      const response = await adminGet(
        `/api/v1/events/pqc-2026/forms/${key}/submissions?sort=${descending ? "-" : ""}answer:food&limit=10`,
      );
      expect(response.status).toBe(200);
      const result = formSubmissionsResponseSchema.parse(await response.json());
      const values = result.submissions.map((submission) => submission.answers.food);
      const nonblank = expected.filter((value) => value !== null && value !== "");
      expect(values.slice(0, nonblank.length)).toEqual(descending ? nonblank.reverse() : nonblank);
      expect(values.slice(nonblank.length)).toEqual(expect.arrayContaining([null, ""]));
      const csv = await adminGet(
        `/api/v1/events/pqc-2026/forms/${key}/submissions/exports?columns=answer:food&sort=${descending ? "-" : ""}answer:food`,
      );
      expect(csv.status).toBe(200);
      const rows = (await csv.text()).split("\r\n").slice(1, 1 + nonblank.length);
      expect(rows).toEqual(
        nonblank.map((value) => options?.find((option) => option.value === value)?.label ?? String(value)),
      );
    }
  });

  it.each([true, false])(
    "matches boolean %s across legacy and normalized answers, counts, statistics, and exports",
    async (answer) => {
      const formId = await insertForm("boolean-filter", "event_registration", "food", null, true);
      for (const [index, value] of [answer, answer, !answer].entries()) {
        const registrationId = await insertRegistration({
          eventId,
          userId: await insertUser(`boolean-${index}@example.test`),
          status: "registered",
          attendanceType: "in_person",
          answer: value,
        });
        if (index === 1)
          await backfillSourceAnswer({
            formId,
            contextType: "registration",
            contextRef: registrationId,
            fieldKey: "food",
            answer: value,
          });
      }
      const filters = { answerField: "food", answerValue: String(answer) };
      const result = await readPopulation("boolean-filter", filters);
      expect(result.list.page.total).toBe(2);
      expect(result.stats.total).toBe(2);
      expect(result.stats.stats[0].entries).toEqual([
        expect.objectContaining({ label: answer ? "Yes" : "No", count: 2 }),
      ]);
      const csv = await adminGet(
        `/api/v1/events/pqc-2026/forms/boolean-filter/submissions/exports?${new URLSearchParams(filters)}&columns=answer:food`,
      );
      expect(csv.status).toBe(200);
      expect((await csv.text()).split("\r\n")).toEqual(["food label", answer ? "Yes" : "No", answer ? "Yes" : "No"]);
    },
  );

  it("reads export rows and their selected native answers in one statement", async () => {
    const formKey = "projected-response";
    const formId = await insertForm(formKey, "event_registration", "food", null, true);
    const registrationId = await insertRegistration({
      eventId,
      userId: await insertUser("projected@example.test"),
      status: "registered",
      attendanceType: "in_person",
      answer: "vegan",
    });
    await backfillSourceAnswer({
      formId,
      contextType: "registration",
      contextRef: registrationId,
      fieldKey: "food",
      answer: "vegan",
    });
    const params = {
      formKey,
      eventSlug: "pqc-2026",
      answerField: "food",
      answerValue: "vegan",
      sort: "answer:food",
      limit: 10,
      offset: 0,
    };
    const population = await resolveFormSubmissionPopulation(env.DB, params);
    const profile = profileD1Flow(env.DB);
    const submissions = await readFormSubmissionSnapshot(profile.db, population, params, ["food"], []);
    expect(submissions).toHaveLength(1);
    expect(submissions[0].answers).toEqual({ food: "vegan" });
    // Rows and their answers come from one statement, so no later read can see a newer answer.
    expect(profile.summary().queries).toHaveLength(1);
    expect(profile.summary().queries[0].sql).toContain("json_group_object");
  });

  it("sorts and exports inactive catalog choices by their historical labels", async () => {
    const formId = await insertForm("historical-choices", "event_registration", "food", null, true);
    await env.DB.prepare(
      "UPDATE form_fields SET field_type = 'select', option_source = 'active_working_groups' WHERE form_id = ?",
    )
      .bind(formId)
      .run();
    const choices = [
      { id: "00000000-0000-4000-8000-000000000001", label: "Zulu retired", active: 0 },
      { id: "00000000-0000-4000-8000-000000000002", label: "Alpha active", active: 1 },
    ];
    const at = new Date().toISOString();
    for (const [index, choice] of choices.entries()) {
      await env.DB.prepare(
        "INSERT INTO groups (id, type_key, name, slug, active, public_roster, created_at, updated_at) VALUES (?, 'working_group', ?, ?, ?, 0, ?, ?)",
      )
        .bind(choice.id, choice.label, `historical-choice-${index}`, choice.active, at, at)
        .run();
      const registrationId = await insertRegistration({
        eventId,
        userId: await insertUser(`historical-choice-${index}@example.test`),
        status: "registered",
        attendanceType: "in_person",
        answer: choice.id,
      });
      if (index === 1)
        await backfillSourceAnswer({
          formId,
          contextType: "registration",
          contextRef: registrationId,
          fieldKey: "food",
          answer: choice.id,
        });
    }
    const response = await adminGet(
      "/api/v1/events/pqc-2026/forms/historical-choices/submissions?sort=answer:food&limit=10",
    );
    expect(response.status).toBe(200);
    const result = formSubmissionsResponseSchema.parse(await response.json());
    expect(result.submissions.map((submission) => submission.answers.food)).toEqual([choices[1].id, choices[0].id]);
    const csv = await adminGet(
      "/api/v1/events/pqc-2026/forms/historical-choices/submissions/exports?sort=answer:food&columns=answer:food",
    );
    expect(csv.status).toBe(200);
    expect((await csv.text()).split("\r\n")).toEqual(["food label", "Alpha active", "Zulu retired"]);
  });

  it("rejects unsafe answer keys and unauthorized exports", async () => {
    for (const query of ["sort=answer:food%27", "answerField=food%27&answerValue=vegan"]) {
      expect((await adminGet(`/api/v1/events/pqc-2026/forms/missing/submissions?${query}`)).status).toBe(400);
    }
    expect((await callApi(env, "/api/v1/events/pqc-2026/forms/missing/submissions/exports")).status).toBe(401);
    expect((await adminGet("/api/v1/events/pqc-2026/forms/missing/submissions/exports")).status).toBe(404);
  });
});
