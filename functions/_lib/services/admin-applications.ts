/**
 * Admin listing/detail queries for member_applications. Parallel
 * to admin-members.ts's split between the public directory query and a
 * dedicated, unfiltered admin query — the admin view needs every stage/
 * status (not just active ones) plus the staff-only communications/notes/
 * concerns/EC-decision timelines the applicant-facing status endpoint never
 * returns.
 */
import { all, first } from "../db/queries";
import { AppError } from "../errors";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import {
  emailDomain,
  getApplicationAnswers,
  getMemberApplicationById,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  listApplicationCommunications,
  listApplicationConcerns,
  listApplicationDocuments,
  MEMBERSHIP_APPLICATION_FORM_KEY,
  type MemberApplicationRow,
} from "./member-applications";
import { getGlobalFormByKey } from "./forms";
import { listEcDecisions } from "./ec-review";
import { ADMIN_APPLICATIONS_SORT_COLUMNS } from "../../../assets/shared/schemas/admin-applications";
import type { DatabaseLike, StatementLike } from "../types";

export interface AdminApplicationSummary {
  id: string;
  applicantEmail: string;
  applicantName: string;
  organizationName: string | null;
  membershipCategory: string;
  status: string;
  stage: string;
  onHoldSubtype: string | null;
  assignedToUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toSummary(row: MemberApplicationRow): AdminApplicationSummary {
  return {
    id: row.id,
    applicantEmail: row.applicant_email,
    applicantName: row.applicant_name,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
    status: row.status,
    stage: row.stage,
    onHoldSubtype: row.on_hold_subtype,
    assignedToUserId: row.assigned_to_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SORT_COLUMN_SET = new Set<string>(ADMIN_APPLICATIONS_SORT_COLUMNS);

/**
 * Resolves a `sort` query value (e.g. "created_at" or "-created_at", the
 * leading "-" meaning descending — see Table.tsx's ColumnSort convention)
 * into a safe `ORDER BY` clause. Only columns in ADMIN_APPLICATIONS_SORT_COLUMNS
 * are ever interpolated — anything else (including attempted SQL injection
 * via the query param) falls back to the default `created_at DESC`, matching
 * today's behavior exactly when no/invalid `sort` is supplied.
 */
function resolveApplicationsOrderBy(sort?: string): string {
  if (!sort) return "ORDER BY created_at DESC";
  const desc = sort.startsWith("-");
  const column = desc ? sort.slice(1) : sort;
  if (!SORT_COLUMN_SET.has(column)) return "ORDER BY created_at DESC";
  return `ORDER BY ${column} ${desc ? "DESC" : "ASC"}`;
}

export async function listAdminApplications(
  db: DatabaseLike,
  params: { limit: number; offset: number; stage?: string; status?: string; sort?: string },
): Promise<{ applications: AdminApplicationSummary[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.stage) {
    conditions.push("stage = ?");
    values.push(params.stage);
  }
  if (params.status) {
    conditions.push("status = ?");
    values.push(params.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveApplicationsOrderBy(params.sort);

  const [rows, totalRow] = await Promise.all([
    all<MemberApplicationRow>(db, `SELECT * FROM member_applications ${where} ${orderBy} LIMIT ? OFFSET ?`, [
      ...values,
      params.limit,
      params.offset,
    ]),
    first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM member_applications ${where}`, values),
  ]);

  return { applications: rows.map(toSummary), total: totalRow?.total ?? 0 };
}

export interface AdminApplicationDetail extends AdminApplicationSummary {
  stageEnteredAt: string;
  answers: Record<string, unknown>;
  events: Array<{
    fromStage: string | null;
    toStage: string;
    actorUserId: string | null;
    note: string | null;
    createdAt: string;
  }>;
  communications: Awaited<ReturnType<typeof listApplicationCommunications>>;
  concerns: Awaited<ReturnType<typeof listApplicationConcerns>>;
  ecDecisions: Awaited<ReturnType<typeof listEcDecisions>>;
  documents: Awaited<ReturnType<typeof listApplicationDocuments>>;
}

interface ApplicationEventRow {
  from_stage: string | null;
  to_stage: string;
  actor_user_id: string | null;
  note: string | null;
  created_at: string;
}

export async function getAdminApplicationDetail(
  db: DatabaseLike,
  applicationId: string,
): Promise<AdminApplicationDetail> {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  const [eventRows, communications, concerns, ecDecisions, documents] = await Promise.all([
    all<ApplicationEventRow>(
      db,
      `SELECT from_stage, to_stage, actor_user_id, note, created_at FROM member_application_events WHERE application_id = ? ORDER BY created_at ASC`,
      [applicationId],
    ),
    listApplicationCommunications(db, applicationId),
    listApplicationConcerns(db, applicationId),
    listEcDecisions(db, applicationId),
    listApplicationDocuments(db, applicationId),
  ]);

  return {
    ...toSummary(application),
    stageEnteredAt: application.stage_entered_at,
    answers: await getApplicationAnswers(db, application.form_submission_id),
    events: eventRows.map((row) => ({
      fromStage: row.from_stage,
      toStage: row.to_stage,
      actorUserId: row.actor_user_id,
      note: row.note,
      createdAt: row.created_at,
    })),
    communications,
    concerns,
    ecDecisions,
    documents,
  };
}

// ── Edit application fields ─────────────────────────────────────────────
//
// Corrects applicant-submitted data (e.g. a mistyped email domain) without
// moving the application through the stage machine — a distinct
// operation from transitionApplicationStage. Route layer
// (functions/api/v1/admin/applications/[id]/index.ts) writes the audit_log
// entry; this function only touches member_applications and records a
// member_application_events row so the correction shows up in the
// application's timeline. Per migration 0038's own note, member_application_events
// has no "kind" column to tag this as non-transition, so the marker event
// uses from_stage === to_stage (the application's current stage, unchanged)
// with a note explaining what changed — the timeline UI already renders
// `fromStage -> toStage`, so an identical pair reads as "nothing moved" while
// the note carries the actual detail, keeping it visually distinct from a
// real transition (which always has fromStage !== toStage).
const EDITABLE_ANSWER_KEYS = [
  "job_title",
  "linkedin",
  "organization_website",
  "about_yourself",
  "about_organization",
  "reason",
] as const;

export interface ApplicationEditInput {
  applicantName?: string;
  applicantEmail?: string;
  organizationName?: string | null;
  membershipCategory?: string;
  answers?: Partial<Record<(typeof EDITABLE_ANSWER_KEYS)[number], string | null>>;
}

export async function updateAdminApplication(
  db: DatabaseLike,
  applicationId: string,
  actorUserId: string,
  input: ApplicationEditInput,
): Promise<AdminApplicationDetail> {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) {
    throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  }

  const now = nowIso();
  const changedFields: string[] = [];
  const setClauses: string[] = [];
  const values: unknown[] = [];
  const preStatements: StatementLike[] = [];

  if (input.applicantName !== undefined && input.applicantName !== application.applicant_name) {
    setClauses.push("applicant_name = ?");
    values.push(input.applicantName);
    changedFields.push("applicantName");
  }

  const nextMembershipCategory = input.membershipCategory ?? application.membership_category;
  const nextIsIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(nextMembershipCategory);
  if (input.membershipCategory !== undefined && input.membershipCategory !== application.membership_category) {
    setClauses.push("membership_category = ?");
    values.push(input.membershipCategory);
    changedFields.push("membershipCategory");
  }

  const nextApplicantEmail = input.applicantEmail ?? application.applicant_email;
  if (input.applicantEmail !== undefined && input.applicantEmail !== application.applicant_email) {
    setClauses.push("applicant_email = ?");
    values.push(input.applicantEmail);
    changedFields.push("applicantEmail");
  }

  // organization_domain drives duplicate-application detection
  // (member-applications.ts's hasActiveApplicationForDomain) — keep it in
  // lockstep with applicantEmail/membershipCategory the same way
  // createMemberApplication derives it at submission time, so an edited
  // email or an individual<->org-tied category change doesn't silently
  // desync it from what the applicant actually submitted.
  const nextOrganizationDomain = nextIsIndividual ? null : emailDomain(nextApplicantEmail);
  if (nextOrganizationDomain !== application.organization_domain) {
    setClauses.push("organization_domain = ?");
    values.push(nextOrganizationDomain);
  }

  if (input.organizationName !== undefined && input.organizationName !== application.organization_name) {
    setClauses.push("organization_name = ?");
    values.push(nextIsIndividual ? null : input.organizationName);
    changedFields.push("organizationName");
  } else if (
    nextIsIndividual !== INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(application.membership_category) &&
    nextIsIndividual &&
    application.organization_name !== null
  ) {
    // Category flipped to an individual (org-less) category and the caller
    // didn't also clear organizationName — clear it so the record stays
    // consistent with createMemberApplication's own invariant (individual
    // categories never carry an organization_name).
    setClauses.push("organization_name = ?");
    values.push(null);
  }

  if (input.answers) {
    const currentAnswers = await getApplicationAnswers(db, application.form_submission_id);
    const editedEntries: Array<[string, string | null]> = [];
    for (const key of EDITABLE_ANSWER_KEYS) {
      if (input.answers[key] === undefined) continue;
      const nextValue = input.answers[key] ?? null;
      if (nextValue !== (currentAnswers[key] ?? null)) {
        changedFields.push(`answers.${key}`);
        editedEntries.push([key, nextValue]);
      }
    }

    if (editedEntries.length > 0) {
      let formSubmissionId = application.form_submission_id;
      if (!formSubmissionId) {
        // No prior submission (e.g. an application created with no answers
        // at all) — create one on the fly so the edit has somewhere to land,
        // mirroring createMemberApplication's own write path.
        const form = await getGlobalFormByKey(db, MEMBERSHIP_APPLICATION_FORM_KEY);
        if (!form) {
          throw new AppError(500, "APPLICATION_FORM_MISSING", "No active membership application form is configured");
        }
        formSubmissionId = uuid();
        preStatements.push(
          db
            .prepare(
              `INSERT INTO form_submissions (id, form_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
               VALUES (?, ?, NULL, 'membership', ?, 'submitted', ?)`,
            )
            .bind(formSubmissionId, form.id, applicationId, now),
        );
        setClauses.push("form_submission_id = ?");
        values.push(formSubmissionId);
      }

      for (const [key, value] of editedEntries) {
        preStatements.push(
          db
            .prepare(
              `INSERT INTO form_submission_answers (id, submission_id, field_key, data_json, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(submission_id, field_key) DO UPDATE SET data_json = excluded.data_json`,
            )
            .bind(uuid(), formSubmissionId, key, JSON.stringify(value), now),
        );
      }
    }
  }

  if (changedFields.length === 0) {
    // Nothing actually changed (e.g. caller sent the same values back) — skip
    // the write and the timeline event entirely.
    return getAdminApplicationDetail(db, applicationId);
  }

  setClauses.push("updated_at = ?");
  values.push(now);
  values.push(applicationId);

  await db.batch([
    ...preStatements,
    db.prepare(`UPDATE member_applications SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values),
    db
      .prepare(
        `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uuid(),
        applicationId,
        application.stage,
        application.stage,
        actorUserId,
        `Application details edited: ${changedFields.join(", ")}`,
        now,
      ),
  ]);

  return getAdminApplicationDetail(db, applicationId);
}
