import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { proposalCreateSchema } from "../assets/shared/schemas/proposal-management";
import type { DatabaseLike } from "../functions/_lib/types";
import { prepareValidatedAttendeeRegistration } from "../functions/_lib/services/attendee-registration";
import { getEventById } from "../functions/_lib/services/events";
import { toEventFormResolutionEvent, validateCustomAnswersForSubmission } from "../functions/_lib/services/forms";
import { saveProposalAccessChanges } from "../functions/_lib/services/proposal-self-service";
import { submitProposal } from "../functions/_lib/services/proposal-submission";
import { commitRegistrationSubmission } from "../functions/_lib/services/registration-submission";
import { updateManagedRegistration } from "../functions/_lib/services/registrations/manage-update";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const SIGNING_SECRET = "test-form-revision-guard-secret-32-bytes";

async function insertPlacedForm(
  eventId: string,
  purpose: "event_registration" | "proposal_submission",
): Promise<string> {
  const formId = crypto.randomUUID();
  const key = `${purpose}-${formId}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forms
         (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
       VALUES (?, ?, 'event', ?, ?, 'active', ?, NULL, datetime('now'), datetime('now'))`,
    ).bind(formId, key, eventId, purpose, `${purpose} form`),
    env.DB.prepare(
      `INSERT INTO form_fields
         (id, form_id, key, label, field_type, required, options_json, validation_json,
          sort_order, created_at, updated_at, archived_at)
       VALUES (?, ?, 'answer', 'Answer', 'text', 1, NULL, NULL, 10,
               datetime('now'), datetime('now'), NULL)`,
    ).bind(crypto.randomUUID(), formId),
    env.DB.prepare(
      `INSERT INTO form_placements
         (id, form_id, owner_group_id, context_type, context_ref, audience, active,
          opens_at, closes_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'event', ?, ?, 1, NULL, NULL, datetime('now'), datetime('now'))`,
    ).bind(crypto.randomUUID(), formId, eventId, purpose === "event_registration" ? "attendee" : "speaker"),
  ]);
  return formId;
}

async function advanceFormRevision(formId: string): Promise<void> {
  await env.DB.prepare("UPDATE forms SET updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").bind(formId).run();
}

function editFormBeforeFirstBatch(formId: string): DatabaseLike {
  const database = env.DB as unknown as DatabaseLike;
  let edited = false;
  return {
    prepare: (query) => database.prepare(query),
    async batch(statements) {
      if (!edited) {
        edited = true;
        await advanceFormRevision(formId);
      }
      return database.batch(statements);
    },
  };
}

async function prepareRegistration(eventId: string, answer: string) {
  const event = await getEventById(env.DB as unknown as DatabaseLike, eventId);
  return prepareValidatedAttendeeRegistration(
    env.DB as unknown as DatabaseLike,
    {
      firstName: "Form",
      lastName: "Attendee",
      email: "form-attendee@example.test",
      attendanceType: "virtual",
      customAnswers: { answer },
      consents: [
        { termKey: "privacy-policy", version: "v1" },
        { termKey: "code-of-conduct", version: "v1" },
      ],
    },
    {
      event: { id: event.id, source_mode: event.source_mode },
      invite: null,
      sourceType: "direct",
      ip: null,
      userAgent: null,
      signingSecret: SIGNING_SECRET,
      pendingConfirmationDeadlineHours: 72,
      confirmationTtlHours: 24,
      referralCodeLength: 8,
    },
  );
}

async function submitCurrentProposal(eventId: string, answer: string) {
  const database = env.DB as unknown as DatabaseLike;
  const event = await getEventById(database, eventId);
  const validated = await validateCustomAnswersForSubmission(database, {
    event: toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
    purpose: "proposal_submission",
    customAnswers: { answer },
  });
  const body = proposalCreateSchema.parse({
    sourceType: "direct",
    proposer: {
      firstName: "Form",
      lastName: "Speaker",
      email: "form-speaker@example.test",
      role: "proposer",
      links: [],
    },
    proposal: {
      type: "talk",
      title: "A proposal guarded against stale live form definitions",
      abstract:
        "This proposal abstract is intentionally long enough to satisfy the public schema while testing atomic form revision behavior.",
      details: { answer },
    },
    speakers: [],
    consents: [{ termKey: "speaker-terms", version: "v1" }],
  });
  return submitProposal(database, {
    event,
    body,
    appBaseUrl: "https://app.test",
    signingSecret: SIGNING_SECRET,
    referralCodeLength: 8,
    proposalDetails: validated.answers,
    ip: null,
    userAgent: null,
    formDefinition: validated.form,
  });
}

describe("form revision guards on registration and proposal commands", () => {
  beforeEach(resetDb);

  it("rolls back a new registration when its validated form changes before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const formId = await insertPlacedForm(eventId, "event_registration");
    const { prepared } = await prepareRegistration(eventId, "before edit");

    await advanceFormRevision(formId);

    await expect(commitRegistrationSubmission(env.DB, prepared)).rejects.toMatchObject({
      status: 409,
      code: "FORM_CHANGED",
    });
    expect(await queryAll(env.DB, "SELECT id FROM registrations WHERE id = ?", [prepared.registration.id])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE email = 'form-attendee@example.test'")).toEqual([]);
  });

  it("rolls back a new proposal when its validated form changes before commit", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const formId = await insertPlacedForm(eventId, "proposal_submission");
    const database = env.DB as unknown as DatabaseLike;
    const event = await getEventById(database, eventId);
    const validated = await validateCustomAnswersForSubmission(database, {
      event: toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
      purpose: "proposal_submission",
      customAnswers: { answer: "before edit" },
    });
    const body = proposalCreateSchema.parse({
      sourceType: "direct",
      proposer: { firstName: "Stale", lastName: "Speaker", email: "stale-speaker@example.test", links: [] },
      proposal: {
        type: "talk",
        title: "A stale proposal submission that must be rejected",
        abstract:
          "This proposal abstract is intentionally long enough to satisfy validation and prove that a stale command is rolled back.",
        details: { answer: "before edit" },
      },
      consents: [{ termKey: "speaker-terms", version: "v1" }],
    });
    await advanceFormRevision(formId);

    await expect(
      submitProposal(database, {
        event,
        body,
        appBaseUrl: "https://app.test",
        signingSecret: SIGNING_SECRET,
        referralCodeLength: 8,
        proposalDetails: validated.answers,
        ip: null,
        userAgent: null,
        formDefinition: validated.form,
      }),
    ).rejects.toMatchObject({ status: 409, code: "FORM_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM session_proposals")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE email = 'stale-speaker@example.test'")).toEqual([]);
  });

  it("rolls back registration and proposal edits when their live definitions change during the command", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const registrationFormId = await insertPlacedForm(eventId, "event_registration");
    const proposalFormId = await insertPlacedForm(eventId, "proposal_submission");
    const { prepared } = await prepareRegistration(eventId, "original registration answer");
    await commitRegistrationSubmission(env.DB, prepared);
    const proposal = await submitCurrentProposal(eventId, "original proposal answer");

    await expect(
      updateManagedRegistration(editFormBeforeFirstBatch(registrationFormId), {
        registration: prepared.registration,
        manageToken: prepared.manageToken,
        isAdminManageJwt: false,
        authenticatedActor: null,
        actorUserId: prepared.user.id,
        body: {
          action: "update",
          attendanceType: "virtual",
          customAnswers: { answer: "stale registration answer" },
        },
        appBaseUrl: "https://app.test",
        signingSecret: SIGNING_SECRET,
        confirmationLinkTtlHours: 24,
        waitlistClaimWindowHours: 24,
      }),
    ).rejects.toMatchObject({ status: 409, code: "FORM_CHANGED" });

    await expect(
      saveProposalAccessChanges(editFormBeforeFirstBatch(proposalFormId), {
        token: proposal.manageToken!,
        signingSecret: SIGNING_SECRET,
        body: { details: { answer: "stale proposal answer" } },
      }),
    ).rejects.toMatchObject({ status: 409, code: "FORM_CHANGED" });

    const [registration] = await queryAll<{ custom_answers_json: string }>(
      env.DB,
      "SELECT custom_answers_json FROM registrations WHERE id = ?",
      [prepared.registration.id],
    );
    const [savedProposal] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM session_proposals WHERE id = ?",
      [proposal.proposalId],
    );
    expect(JSON.parse(registration.custom_answers_json)).toEqual({ answer: "original registration answer" });
    expect(JSON.parse(savedProposal.details_json)).toEqual({ answer: "original proposal answer" });

    await updateManagedRegistration(env.DB, {
      registration: prepared.registration,
      manageToken: prepared.manageToken,
      isAdminManageJwt: false,
      authenticatedActor: null,
      actorUserId: prepared.user.id,
      body: {
        action: "update",
        attendanceType: "virtual",
        customAnswers: { answer: "current registration answer" },
      },
      appBaseUrl: "https://app.test",
      signingSecret: SIGNING_SECRET,
      confirmationLinkTtlHours: 24,
      waitlistClaimWindowHours: 24,
    });
    await saveProposalAccessChanges(env.DB, {
      token: proposal.manageToken!,
      signingSecret: SIGNING_SECRET,
      body: { details: { answer: "current proposal answer" } },
    });

    expect(
      await queryAll<{ context_type: string; answer: string }>(
        env.DB,
        `SELECT fs.context_type, json_extract(a.data_json, '$') AS answer
         FROM form_submissions fs
         JOIN form_submission_answers a ON a.submission_id = fs.id
         WHERE fs.context_ref IN (?, ?)
         ORDER BY fs.context_type`,
        [prepared.registration.id, proposal.proposalId],
      ),
    ).toEqual([
      { context_type: "proposal", answer: "current proposal answer" },
      { context_type: "registration", answer: "current registration answer" },
    ]);
    const [placementAttribution] = await queryAll<{
      registration_placement_id: string | null;
      proposal_placement_id: string | null;
    }>(
      env.DB,
      `SELECT r.form_placement_id AS registration_placement_id,
              sp.form_placement_id AS proposal_placement_id
       FROM registrations r
       JOIN session_proposals sp ON sp.id = ?
       WHERE r.id = ?`,
      [proposal.proposalId, prepared.registration.id],
    );
    expect(placementAttribution).toEqual({
      registration_placement_id: expect.any(String),
      proposal_placement_id: expect.any(String),
    });
    expect(
      await queryAll<{ context_type: string; field_id: string | null }>(
        env.DB,
        `SELECT fs.context_type, a.field_id
         FROM form_submissions fs
         JOIN form_submission_answers a ON a.submission_id = fs.id
         WHERE fs.context_ref IN (?, ?)
         ORDER BY fs.context_type`,
        [prepared.registration.id, proposal.proposalId],
      ),
    ).toEqual([
      { context_type: "proposal", field_id: expect.any(String) },
      { context_type: "registration", field_id: expect.any(String) },
    ]);
    await env.DB.batch([
      env.DB.prepare("UPDATE form_fields SET key = 'registration_answer' WHERE form_id = ?").bind(registrationFormId),
      env.DB.prepare("UPDATE form_fields SET key = 'proposal_answer' WHERE form_id = ?").bind(proposalFormId),
    ]);
    expect(
      await queryAll<{ context_type: string; current_key: string; submitted_key: string }>(
        env.DB,
        `SELECT fs.context_type, ff.key AS current_key, a.field_key AS submitted_key
         FROM form_submissions fs
         JOIN form_submission_answers a ON a.submission_id = fs.id
         JOIN form_fields ff ON ff.id = a.field_id
         WHERE fs.context_ref IN (?, ?)
         ORDER BY fs.context_type`,
        [prepared.registration.id, proposal.proposalId],
      ),
    ).toEqual([
      { context_type: "proposal", current_key: "proposal_answer", submitted_key: "answer" },
      { context_type: "registration", current_key: "registration_answer", submitted_key: "answer" },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM form_submission_guards")).toEqual([]);
  });
});
