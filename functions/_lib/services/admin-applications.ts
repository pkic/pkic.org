/**
 * Admin listing/detail queries for member_applications (PRD §4.2). Parallel
 * to admin-members.ts's split between the public directory query and a
 * dedicated, unfiltered admin query — the admin view needs every stage/
 * status (not just active ones) plus the staff-only communications/notes/
 * concerns/EC-decision timelines the applicant-facing status endpoint never
 * returns.
 */
import { all, first } from "../db/queries";
import { AppError } from "../errors";
import {
  getMemberApplicationById,
  listApplicationCommunications,
  listApplicationConcerns,
  listApplicationDocuments,
  parseApplicationAnswers,
  type MemberApplicationRow,
} from "./member-applications";
import { listEcDecisions } from "./ec-review";
import type { DatabaseLike } from "../types";

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

export async function listAdminApplications(
  db: DatabaseLike,
  params: { limit: number; offset: number; stage?: string; status?: string },
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

  const [rows, totalRow] = await Promise.all([
    all<MemberApplicationRow>(
      db,
      `SELECT * FROM member_applications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...values, params.limit, params.offset],
    ),
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
    answers: parseApplicationAnswers(application.answers_json),
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
