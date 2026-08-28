import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { listCampaignRecipients } from "../functions/_lib/services/admin-email-campaign";
import { getEventBySlug } from "../functions/_lib/services/events";
import { resolveEventFormResponse } from "../functions/_lib/services/forms";
import { getProposalDetailData } from "../functions/_lib/services/proposal-detail";
import { buildAdminRegistrationCsv } from "../functions/_lib/services/registrations/admin-export";
import { getAdminRegistrationDetail } from "../functions/_lib/services/registrations/admin-detail";
import { getCustomAnswerRows } from "../functions/_lib/utils/registration-email";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

type EventFormPurpose = "event_registration" | "proposal_submission";

interface SeededForm {
  formId: string;
  placementId: string;
  fieldId: string;
}

async function seedEventForm(
  eventId: string,
  purpose: EventFormPurpose,
  label: string,
  key: string,
): Promise<SeededForm> {
  const formId = crypto.randomUUID();
  const placementId = crypto.randomUUID();
  const fieldId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forms
         (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
       VALUES (?, ?, 'event', ?, ?, 'active', ?, NULL, datetime('now'), datetime('now'))`,
    ).bind(formId, `${key}-${formId}`, eventId, purpose, `${label} form`),
    env.DB.prepare(
      `INSERT INTO form_fields
         (id, form_id, key, label, field_type, required, options_json, option_source, validation_json,
          sort_order, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, 'text', 0, NULL, NULL, NULL, 10, datetime('now'), datetime('now'), NULL)`,
    ).bind(fieldId, formId, key, label),
    env.DB.prepare(
      `INSERT INTO form_placements
         (id, form_id, owner_group_id, context_type, context_ref, audience, active,
          opens_at, closes_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'event', ?, ?, 1, NULL, NULL, datetime('now'), datetime('now'))`,
    ).bind(placementId, formId, eventId, purpose === "event_registration" ? "attendee" : "speaker"),
  ]);
  return { formId, placementId, fieldId };
}

async function seedRegistrationResponse(input: {
  eventId: string;
  id: string;
  email: string;
  form: SeededForm;
  fieldKey: string;
  value: string;
  formPlacementId: string | null;
  submissionPlacementId: string | null;
  jsonAnswer?: Record<string, unknown>;
}): Promise<void> {
  const userId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Historical', 'Attendee', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, input.email, input.email),
    env.DB.prepare(
      `INSERT INTO registrations
         (id, event_id, user_id, status, attendance_type, source_type, custom_answers_json,
          form_placement_id, manage_link_secret, created_at, updated_at)
       VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, ?, ?, datetime('now'), datetime('now'))`,
    ).bind(
      input.id,
      input.eventId,
      userId,
      JSON.stringify(input.jsonAnswer ?? { [input.fieldKey]: "stale projection" }),
      input.formPlacementId,
      `manage-${input.id}`,
    ),
    env.DB.prepare(
      `INSERT INTO form_submissions
         (id, form_id, placement_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
       VALUES (?, ?, ?, ?, 'registration', ?, 'submitted', datetime('now'))`,
    ).bind(submissionId, input.form.formId, input.submissionPlacementId, userId, input.id),
    env.DB.prepare(
      `INSERT INTO form_submission_answers (id, submission_id, field_id, field_key, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(crypto.randomUUID(), submissionId, input.form.fieldId, input.fieldKey, JSON.stringify(input.value)),
  ]);
}

async function seedProposalResponse(eventId: string, form: SeededForm): Promise<string> {
  const userId = crypto.randomUUID();
  const proposalId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, active, created_at, updated_at)
       VALUES (?, 'historical-speaker@example.test', 'historical-speaker@example.test', 'Historical', 'Speaker', 1,
               datetime('now'), datetime('now'))`,
    ).bind(userId),
    env.DB.prepare(
      `INSERT INTO session_proposals
         (id, event_id, proposer_user_id, status, proposal_type, title, abstract, details_json,
          form_placement_id, manage_link_secret, review_round, submitted_at, updated_at)
       VALUES (?, ?, ?, 'submitted', 'talk', 'Historical proposal',
               'This historical proposal has a sufficiently descriptive abstract for a read-model regression test.',
               '{"proposal_answer":"stale projection"}', ?, ?, 1, datetime('now'), datetime('now'))`,
    ).bind(proposalId, eventId, userId, form.placementId, `proposal-manage-${proposalId}`),
    env.DB.prepare(
      `INSERT INTO form_submissions
         (id, form_id, placement_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
       VALUES (?, ?, ?, ?, 'proposal', ?, 'submitted', datetime('now'))`,
    ).bind(submissionId, form.formId, form.placementId, userId, proposalId),
    env.DB.prepare(
      `INSERT INTO form_submission_answers (id, submission_id, field_id, field_key, data_json, created_at)
       VALUES (?, ?, ?, 'proposal_answer', '"saved proposal"', datetime('now'))`,
    ).bind(crypto.randomUUID(), submissionId, form.fieldId),
  ]);
  return proposalId;
}

describe("historical event form response attribution", () => {
  beforeEach(resetDb);

  it("preserves the submitted form, archived fields, and normalized answers after switching from form A to B", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const registrationA = await seedEventForm(eventId, "event_registration", "Archived question", "archived_answer");
    const registrationB = await seedEventForm(eventId, "event_registration", "Unique question", "current_answer");
    const proposalA = await seedEventForm(eventId, "proposal_submission", "Proposal archive", "proposal_answer");
    const registrationAId = "10000000-0000-4000-8000-000000000001";
    const registrationBId = "10000000-0000-4000-8000-000000000002";
    await seedRegistrationResponse({
      eventId,
      id: registrationAId,
      email: "historical-a@example.test",
      form: registrationA,
      fieldKey: "archived_answer",
      value: "saved A",
      formPlacementId: registrationA.placementId,
      submissionPlacementId: registrationA.placementId,
    });
    await seedRegistrationResponse({
      eventId,
      id: registrationBId,
      email: "historical-b@example.test",
      form: registrationB,
      fieldKey: "current_answer",
      value: "saved B",
      formPlacementId: registrationB.placementId,
      submissionPlacementId: registrationB.placementId,
    });
    const proposalId = await seedProposalResponse(eventId, proposalA);
    await env.DB.prepare(
      `INSERT INTO form_fields
         (id, form_id, key, label, field_type, required, options_json, option_source, validation_json,
          sort_order, created_at, updated_at, archived_at)
       VALUES (?, ?, 'current_duplicate', 'Archived question', 'text', 0, NULL, NULL, NULL, 20,
               datetime('now'), datetime('now'), NULL)`,
    )
      .bind(crypto.randomUUID(), registrationB.formId)
      .run();
    await env.DB.prepare(
      `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, option_source, validation_json,
            sort_order, created_at, updated_at, archived_at)
         VALUES (?, ?, 'current_unique', 'Other question', 'text', 0, NULL, NULL, NULL, 30,
                 datetime('now'), datetime('now'), NULL)`,
    )
      .bind(crypto.randomUUID(), registrationB.formId)
      .run();
    await env.DB.batch([
      env.DB.prepare("UPDATE form_placements SET active = 0 WHERE id = ?").bind(registrationA.placementId),
      env.DB.prepare("UPDATE form_placements SET active = 0 WHERE id = ?").bind(proposalA.placementId),
      env.DB.prepare("UPDATE form_fields SET archived_at = datetime('now') WHERE id = ?").bind(registrationA.fieldId),
      env.DB.prepare("UPDATE form_fields SET archived_at = datetime('now') WHERE id = ?").bind(proposalA.fieldId),
    ]);

    const registrationDetail = await getAdminRegistrationDetail(env.DB, eventId, registrationAId);
    expect(registrationDetail?.registration.customAnswers).toEqual({ archived_answer: "saved A" });
    expect(registrationDetail?.form).toMatchObject({ id: registrationA.formId });
    expect(registrationDetail?.form?.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: registrationA.fieldId, archivedAt: expect.any(String) })]),
    );
    const rows = await getCustomAnswerRows(env.DB, {
      sourceId: registrationAId,
      event: { id: eventId, source_mode: null },
      formPlacementId: registrationA.placementId,
      answersJson: '{"archived_answer":"stale projection"}',
    });
    expect(rows).toEqual([{ label: "Archived question", displayValue: "saved A" }]);

    const proposalDetail = await getProposalDetailData(env.DB, proposalId);
    expect(proposalDetail?.proposal.details).toEqual({ proposal_answer: "saved proposal" });
    expect(proposalDetail?.form).toMatchObject({ id: proposalA.formId });
    expect(proposalDetail?.form?.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: proposalA.fieldId, archivedAt: expect.any(String) })]),
    );

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const recipients = await listCampaignRecipients(env.DB, event, "https://app.test", {
      audience: "attendees",
      attendeeStatus: "registered",
    });
    expect(
      recipients.find((recipient) => recipient.email === "historical-a@example.test")?.templateData.customAnswerRows,
    ).toMatchObject([
      {
        label: { __pkicEmailPlainText: "Archived question" },
        displayValue: { __pkicEmailPlainText: "saved A" },
      },
    ]);

    const exported = await buildAdminRegistrationCsv(
      env.DB,
      { id: eventId, source_mode: null },
      { maxRows: 10, maxBytes: 100_000 },
    );
    expect(exported.csv).toContain("Archived question");
    expect(exported.csv).toContain("saved A");
    expect(exported.csv).toContain("saved B");
    expect(exported.csv).not.toContain("stale projection");
    const headers = exported.csv.split("\n")[0]!.split(",");
    expect(new Set(headers).size).toBe(headers.length);
    expect(headers).toContain("Unique question");
  });

  it("uses an unplaced normalized historical form before current fallback and fails closed for foreign or mismatched placements", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const formA = await seedEventForm(eventId, "event_registration", "Historical A", "historical_a");
    const formB = await seedEventForm(eventId, "event_registration", "Current B", "current_b");
    const legacyId = "10000000-0000-4000-8000-000000000003";
    await seedRegistrationResponse({
      eventId,
      id: legacyId,
      email: "legacy-normalized@example.test",
      form: formA,
      fieldKey: "historical_a",
      value: "persisted A",
      formPlacementId: null,
      submissionPlacementId: null,
    });
    await env.DB.prepare("UPDATE form_placements SET active = 0 WHERE id = ?").bind(formA.placementId).run();
    const legacy = await resolveEventFormResponse(env.DB, {
      source: "registration",
      sourceId: legacyId,
      event: { id: eventId, source_mode: null },
      formPlacementId: null,
      answersJson: '{"historical_a":"stale projection"}',
    });
    expect(legacy?.form?.id).toBe(formA.formId);
    expect(legacy?.answers).toEqual({ historical_a: "persisted A" });

    const foreignEventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
       VALUES (?, 'foreign-event', 'Foreign event', 'UTC', 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
    )
      .bind(foreignEventId)
      .run();
    const foreignForm = await seedEventForm(foreignEventId, "event_registration", "Foreign answer", "foreign_answer");
    const foreignId = "10000000-0000-4000-8000-000000000004";
    await seedRegistrationResponse({
      eventId,
      id: foreignId,
      email: "foreign-placement@example.test",
      form: foreignForm,
      fieldKey: "foreign_answer",
      value: "must not leak",
      formPlacementId: foreignForm.placementId,
      submissionPlacementId: foreignForm.placementId,
    });
    await expect(
      resolveEventFormResponse(env.DB, {
        source: "registration",
        sourceId: foreignId,
        event: { id: eventId, source_mode: null },
        formPlacementId: foreignForm.placementId,
        answersJson: '{"foreign_answer":"stale projection"}',
      }),
    ).resolves.toBeNull();

    const mismatchId = "10000000-0000-4000-8000-000000000005";
    await seedRegistrationResponse({
      eventId,
      id: mismatchId,
      email: "mismatched-placement@example.test",
      form: formA,
      fieldKey: "historical_a",
      value: "must not leak",
      formPlacementId: formB.placementId,
      submissionPlacementId: formB.placementId,
    });
    await expect(
      resolveEventFormResponse(env.DB, {
        source: "registration",
        sourceId: mismatchId,
        event: { id: eventId, source_mode: null },
        formPlacementId: formB.placementId,
        answersJson: '{"historical_a":"stale projection"}',
      }),
    ).resolves.toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM form_submissions WHERE context_ref = ?", [mismatchId])).toHaveLength(
      1,
    );
  });
});
