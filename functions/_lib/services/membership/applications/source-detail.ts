import { applicationSourceSchema } from "../../../../../assets/shared/schemas/membership-application-source";
import { membershipApplicationDetailSchema } from "../../../../../assets/shared/schemas/membership-application-management";
import { first } from "../../../db/queries";
import type { DatabaseLike } from "../../../types";

export async function getApplicationSource(db: DatabaseLike, id: string, by: "application" | "source") {
  const row = await first<{
    repository: string;
    issue_id: string;
    issue_number: number;
    issue_url: string;
    imported_at: string;
    activated_at: string | null;
    application_id: string | null;
    snapshot_json: string;
  }>(
    db,
    `SELECT repository, issue_id, issue_number, issue_url, imported_at, activated_at, application_id, snapshot_json
    FROM membership_application_sources WHERE ${by === "source" ? "id = ? AND application_id IS NULL" : "application_id = ?"}`,
    [id],
  );
  return row
    ? applicationSourceSchema.parse({
        repository: row.repository,
        issueId: row.issue_id,
        issueNumber: row.issue_number,
        issueUrl: row.issue_url,
        importedAt: row.imported_at,
        activatedAt: row.activated_at,
        historical: row.application_id === null,
        snapshot: JSON.parse(row.snapshot_json),
      })
    : null;
}

export async function getHistoricalApplicationDetail(db: DatabaseLike, id: string) {
  const row = await first<{
    id: string;
    applicant_name: string | null;
    applicant_email: string | null;
    organization_name: string | null;
    category_code: string | null;
    category_label: string | null;
    outcome: string;
    closed_at: string | null;
    source_created_at: string;
    source_updated_at: string;
  }>(
    db,
    `SELECT source.id, source.applicant_name, source.applicant_email, source.organization_name,
    source.category_code, category.label AS category_label, source.outcome, source.closed_at,
    source.source_created_at, source.source_updated_at
    FROM membership_application_sources source LEFT JOIN membership_categories category ON category.code = source.category_code
    WHERE source.id = ? AND source.application_id IS NULL`,
    [id],
  );
  if (!row) return null;
  return membershipApplicationDetailSchema.parse({
    id: row.id,
    applicantName: row.applicant_name ?? "Unknown applicant",
    applicantEmail: row.applicant_email ?? "",
    organizationName: row.organization_name,
    membershipCategory: row.category_code ?? "",
    membershipCategoryLabel: row.category_label ?? "Unknown category",
    stage: row.outcome,
    stageEnteredAt: null,
    closedAt: row.closed_at,
    onHoldSubtype: null,
    assignedToUserId: null,
    createdAt: row.source_created_at,
    updatedAt: row.source_updated_at,
    answers: {},
    answerFields: [],
    requestedWorkingGroups: [],
    events: [],
    communications: [],
    source: await getApplicationSource(db, id, "source"),
  });
}
